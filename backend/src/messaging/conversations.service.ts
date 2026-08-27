import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ModerationService } from '../moderation/moderation.service';

const MAX_MESSAGE_LENGTH = 4000;
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

const PUBLIC_USER_SELECT = { id: true, username: true, avatarUrl: true, isPro: true } as const;

// Postgres's `contains` compares raw bytes — it won't match "cuong" against a username
// like "Cường Văn". Strips Vietnamese diacritics (NFD decomposition, plus đ/Đ which don't
// decompose that way) so search tolerates missing accents, same as the frontend's search.
function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
const PIN_PREVIEW_SELECT = {
  id: true,
  title: true,
  imageUrl: true,
  user: { select: PUBLIC_USER_SELECT },
} as const;
const REPLY_PREVIEW_SELECT = {
  id: true,
  type: true,
  content: true,
  imageUrl: true,
  gifUrl: true,
  senderId: true,
} as const;
const MESSAGE_INCLUDE = {
  pin: { select: PIN_PREVIEW_SELECT },
  replyTo: { select: REPLY_PREVIEW_SELECT },
  reactions: { select: { emoji: true, userId: true } },
} as const;

export interface SendMessageInput {
  content?: string;
  type?: string;
  imageUrl?: string;
  gifUrl?: string;
  pinId?: string;
  replyToId?: string;
}

/** Sorted-pair key so a conversation between two users can never be created twice. */
function buildParticipantKey(userAId: string, userBId: string): string {
  return [userAId, userBId].sort().join(':');
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly moderationService: ModerationService,
  ) {}

  async listConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { OR: [{ userOneId: userId }, { userTwoId: userId }] },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        userOne: { select: PUBLIC_USER_SELECT },
        userTwo: { select: PUBLIC_USER_SELECT },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (conversations.length === 0) return [];

    const unreadCounts = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        senderId: { not: userId },
        readAt: null,
      },
      _count: { id: true },
    });
    const unreadMap = new Map(unreadCounts.map((row) => [row.conversationId, row._count.id]));

    return conversations.map((conversation) => {
      const otherUser = conversation.userOneId === userId ? conversation.userTwo : conversation.userOne;
      const lastMessage = conversation.messages[0] ?? null;
      return {
        id: conversation.id,
        otherUser,
        lastMessage: lastMessage
          ? {
              type: lastMessage.type,
              content: lastMessage.content,
              createdAt: lastMessage.createdAt,
              senderId: lastMessage.senderId,
            }
          : null,
        unreadCount: unreadMap.get(conversation.id) ?? 0,
        updatedAt: conversation.lastMessageAt ?? conversation.createdAt,
      };
    });
  }

  async openDirectConversation(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException('Bạn không thể tự nhắn tin với chính mình');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    const participantKey = buildParticipantKey(userId, targetId);
    const existing = await this.prisma.conversation.findUnique({ where: { participantKey } });
    if (existing) return existing;

    const [userOneId, userTwoId] = [userId, targetId].sort();
    try {
      return await this.prisma.conversation.create({ data: { participantKey, userOneId, userTwoId } });
    } catch (error) {
      // Race: another request created it first — fall back to reading it.
      const created = await this.prisma.conversation.findUnique({ where: { participantKey } });
      if (created) return created;
      throw error;
    }
  }

  async searchUsers(query: string, excludeUserId: string, limit = 10) {
    const trimmed = (query || '').trim();
    if (!trimmed) return [];
    const needle = normalizeForSearch(trimmed);
    // The user table is small, so filtering in-memory after normalizing accents is
    // simpler and cheaper than reaching for a Postgres unaccent extension for this.
    const allUsers = await this.prisma.user.findMany({
      where: { id: { not: excludeUserId } },
      select: PUBLIC_USER_SELECT,
    });
    return allUsers
      .filter((u) => normalizeForSearch(u.username).includes(needle))
      .slice(0, Math.min(limit, 20));
  }

  async getMessages(conversationId: string, userId: string, rawPage?: string, rawLimit?: string) {
    const conversation = await this.getConversationForParticipant(conversationId, userId);
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);

    const [items, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where: { conversationId: conversation.id } }),
    ]);

    return {
      items: items.reverse(),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    };
  }

  async sendMessage(conversationId: string, userId: string, input: SendMessageInput) {
    const type = (input.type || 'TEXT').toUpperCase();
    if (!['TEXT', 'IMAGE', 'GIF', 'PIN'].includes(type)) {
      throw new BadRequestException('Loại tin nhắn không hợp lệ');
    }

    let content: string | undefined;
    let imageUrl: string | undefined;
    let gifUrl: string | undefined;
    let pinId: string | undefined;

    if (type === 'TEXT') {
      content = (input.content || '').trim();
      if (!content) {
        throw new BadRequestException('Nội dung tin nhắn không được để trống');
      }
      if (content.length > MAX_MESSAGE_LENGTH) {
        throw new BadRequestException(`Tin nhắn không được vượt quá ${MAX_MESSAGE_LENGTH} ký tự`);
      }
    } else if (type === 'IMAGE') {
      imageUrl = (input.imageUrl || '').trim();
      if (!imageUrl) throw new BadRequestException('Thiếu URL hình ảnh');
    } else if (type === 'GIF') {
      gifUrl = (input.gifUrl || '').trim();
      if (!gifUrl) throw new BadRequestException('Thiếu URL GIF');
    } else {
      pinId = (input.pinId || '').trim();
      if (!pinId) throw new BadRequestException('Thiếu pinId');
      const pin = await this.prisma.pin.findUnique({ where: { id: pinId }, select: { id: true } });
      if (!pin) throw new NotFoundException('Pin không tồn tại');
    }

    const conversation = await this.getConversationForParticipant(conversationId, userId);

    let replyToId: string | undefined;
    if (input.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({
        where: { id: input.replyToId },
        select: { id: true, conversationId: true },
      });
      if (!replyTarget || replyTarget.conversationId !== conversation.id) {
        throw new BadRequestException('Tin nhắn được trả lời không hợp lệ');
      }
      replyToId = replyTarget.id;
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          type: type as any,
          content,
          imageUrl,
          gifUrl,
          pinId,
          replyToId,
        },
        include: MESSAGE_INCLUDE,
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      return message;
    });
  }

  /** Messenger-style: one reaction per user per message. Same emoji again
   * removes it; a different emoji replaces it. */
  async toggleReaction(conversationId: string, messageId: string, userId: string, emoji: string) {
    const trimmedEmoji = (emoji || '').trim();
    if (!trimmedEmoji) {
      throw new BadRequestException('Thiếu emoji');
    }
    await this.getConversationForParticipant(conversationId, userId);

    const message = await this.prisma.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true } });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Tin nhắn không tồn tại');
    }

    const existing = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId: { messageId, userId } },
    });

    if (existing && existing.emoji === trimmedEmoji) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      return { emoji: null, reactions: await this.getReactions(messageId) };
    }

    await this.prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { emoji: trimmedEmoji },
      create: { messageId, userId, emoji: trimmedEmoji },
    });
    return { emoji: trimmedEmoji, reactions: await this.getReactions(messageId) };
  }

  private async getReactions(messageId: string) {
    return this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });
  }

  /** Messenger-style unsend: only the sender can do it, content is actually
   * cleared (not just hidden) so a recall really does remove the data. */
  async unsendMessage(conversationId: string, messageId: string, userId: string) {
    await this.getConversationForParticipant(conversationId, userId);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Tin nhắn không tồn tại');
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException('Bạn chỉ có thể thu hồi tin nhắn của chính mình');
    }
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: null,
        imageUrl: null,
        gifUrl: null,
        pinId: null,
        pinnedAt: null,
        deletedAt: new Date(),
      },
    });
  }

  /** Either participant can pin/unpin — only one message pinned at a time
   * per conversation (pinning a new one replaces the previous pin). */
  async togglePin(conversationId: string, messageId: string, userId: string) {
    await this.getConversationForParticipant(conversationId, userId);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Tin nhắn không tồn tại');
    }
    if (message.deletedAt) {
      throw new BadRequestException('Không thể ghim tin nhắn đã bị thu hồi');
    }

    if (message.pinnedAt) {
      return this.prisma.message.update({ where: { id: messageId }, data: { pinnedAt: null } });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.message.updateMany({ where: { conversationId, pinnedAt: { not: null } }, data: { pinnedAt: null } });
      return tx.message.update({ where: { id: messageId }, data: { pinnedAt: new Date() } });
    });
  }

  async getPinnedMessage(conversationId: string, userId: string) {
    await this.getConversationForParticipant(conversationId, userId);
    return this.prisma.message.findFirst({
      where: { conversationId, pinnedAt: { not: null } },
      orderBy: { pinnedAt: 'desc' },
      include: MESSAGE_INCLUDE,
    });
  }

  async markRead(conversationId: string, userId: string) {
    const conversation = await this.getConversationForParticipant(conversationId, userId);
    await this.prisma.message.updateMany({
      where: { conversationId: conversation.id, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async uploadChatImage(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn một tệp ảnh');
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Định dạng ảnh không được hỗ trợ');
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException('Kích thước ảnh không được vượt quá 8MB');
    }
    await this.moderationService.checkImageIsSafe(file.buffer, file.originalname, file.mimetype);

    const extension = file.originalname.split('.').pop() || 'png';
    const path = `chat/${userId}/msg_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const imageUrl = await this.supabaseService.uploadImage('pins', path, file.buffer, file.mimetype);
    return { imageUrl };
  }

  private async getConversationForParticipant(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Cuộc trò chuyện không tồn tại');
    if (conversation.userOneId !== userId && conversation.userTwoId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cuộc trò chuyện này');
    }
    return conversation;
  }

  private getPagination(rawPage?: string, rawLimit?: string) {
    const parsedPage = Number.parseInt(rawPage || '1', 10);
    const parsedLimit = Number.parseInt(rawLimit || '30', 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 30;
    return { page, limit, skip: (page - 1) * limit };
  }
}
