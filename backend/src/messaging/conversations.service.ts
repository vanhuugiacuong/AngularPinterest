import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import {
  PUBLIC_USER_SELECT,
  findOrCreateConversation,
  hasAcceptedMessageRequest,
  isMutualFollow,
} from '../common/relationship.util';

const MAX_MESSAGE_LENGTH = 4000;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
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
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Người dùng không tồn tại');

    if (await this.blocksService.isBlockedEitherWay(userId, targetId)) {
      throw new ForbiddenException('Không thể nhắn tin vì một trong hai người đã chặn người còn lại');
    }

    const permitted =
      (await isMutualFollow(this.prisma, userId, targetId)) ||
      (await hasAcceptedMessageRequest(this.prisma, userId, targetId));
    if (!permitted) {
      throw new ForbiddenException(
        'Bạn cần theo dõi lẫn nhau hoặc có yêu cầu nhắn tin được chấp nhận để mở cuộc trò chuyện',
      );
    }

    return this.prisma.$transaction((tx) => findOrCreateConversation(tx, userId, targetId));
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

  async sendMessage(conversationId: string, userId: string, rawContent: string) {
    const content = (rawContent || '').trim();
    if (!content) {
      throw new BadRequestException('Nội dung tin nhắn không được để trống');
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Tin nhắn không được vượt quá ${MAX_MESSAGE_LENGTH} ký tự`);
    }

    const conversation = await this.getConversationForParticipant(conversationId, userId);
    const otherUserId = conversation.userOneId === userId ? conversation.userTwoId : conversation.userOneId;

    if (await this.blocksService.isBlockedEitherWay(userId, otherUserId)) {
      throw new ForbiddenException('Không thể gửi tin nhắn vì một trong hai người đã chặn người còn lại');
    }

    const permitted =
      (await isMutualFollow(this.prisma, userId, otherUserId)) ||
      (await hasAcceptedMessageRequest(this.prisma, userId, otherUserId));
    if (!permitted) {
      throw new ForbiddenException('Bạn không còn quyền nhắn tin trong cuộc trò chuyện này');
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { conversationId: conversation.id, senderId: userId, content },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      return message;
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
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 30;
    return { page, limit, skip: (page - 1) * limit };
  }
}
