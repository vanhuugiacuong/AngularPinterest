import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { ReportsService } from '../reports/reports.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  PUBLIC_USER_SELECT,
  findOrCreateConversation,
  isMutualFollow,
  isUniqueConstraintError,
} from '../common/relationship.util';

@Injectable()
export class MessageRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly reportsService: ReportsService,
    private readonly supabase: SupabaseService,
  ) {}

  async sendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException('Bạn không thể gửi yêu cầu nhắn tin cho chính mình');
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true },
    });
    if (!receiver) {
      throw new NotFoundException('Người nhận không tồn tại');
    }

    if (await this.blocksService.isBlockedEitherWay(senderId, receiverId)) {
      throw new ForbiddenException(
        'Không thể gửi yêu cầu nhắn tin vì một trong hai người đã chặn người còn lại',
      );
    }

    if (await isMutualFollow(this.prisma, senderId, receiverId)) {
      throw new BadRequestException(
        'Hai bạn đã theo dõi lẫn nhau, có thể nhắn tin trực tiếp mà không cần gửi yêu cầu',
      );
    }

    const existing = await this.prisma.messageRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });
    if (existing && existing.status !== 'REJECTED') {
      throw new ConflictException(this.describeExistingRequestConflict(existing, senderId));
    }

    let request;
    if (existing?.status === 'REJECTED') {
      // A rejection resolves only that attempt. Reuse the pair's unique row
      // for a fresh request so either user can try again later.
      request = await this.prisma.messageRequest.update({
        where: { id: existing.id },
        data: {
          senderId,
          receiverId,
          status: 'PENDING',
          createdAt: new Date(),
          respondedAt: null,
        },
        include: {
          receiver: { select: PUBLIC_USER_SELECT },
          sender: { select: PUBLIC_USER_SELECT },
        },
      });
    } else {
      try {
        request = await this.prisma.messageRequest.create({
          data: { senderId, receiverId },
          include: {
            receiver: { select: PUBLIC_USER_SELECT },
            sender: { select: PUBLIC_USER_SELECT },
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new ConflictException('Bạn đã gửi yêu cầu nhắn tin cho người này rồi');
        }
        throw error;
      }
    }

    // Instant push for the receiver's incoming-requests queue — mirrors
    // ConversationsService.sendMessage's own broadcast for regular messages.
    // MessagesComponent's poll (every 5s) + focus/visibility refresh stay on
    // as a silent reconciliation fallback in case this broadcast is missed.
    void this.supabase.broadcast(`user:${receiverId}`, 'message_request', { request });

    return request;
  }

  async listIncoming(userId: string) {
    return this.prisma.messageRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: PUBLIC_USER_SELECT } },
    });
  }

  async listOutgoing(userId: string) {
    return this.prisma.messageRequest.findMany({
      where: { senderId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { receiver: { select: PUBLIC_USER_SELECT } },
    });
  }

  async accept(requestId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.messageRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Yêu cầu nhắn tin không tồn tại');
      if (request.receiverId !== userId) {
        throw new ForbiddenException('Bạn không có quyền xử lý yêu cầu này');
      }

      const result = await tx.messageRequest.updateMany({
        where: { id: requestId, receiverId: userId, status: 'PENDING' },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException('Yêu cầu này đã được xử lý');
      }

      const conversation = await findOrCreateConversation(tx, request.senderId, request.receiverId);
      const updated = await tx.messageRequest.findUniqueOrThrow({ where: { id: requestId } });
      return { request: updated, conversationId: conversation.id };
    });
  }

  async reject(requestId: string, userId: string) {
    const request = await this.prisma.messageRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Yêu cầu nhắn tin không tồn tại');
    if (request.receiverId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xử lý yêu cầu này');
    }

    const result = await this.prisma.messageRequest.updateMany({
      where: { id: requestId, receiverId: userId, status: 'PENDING' },
      data: { status: 'REJECTED', respondedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException('Yêu cầu này đã được xử lý');
    }

    return this.prisma.messageRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  async report(requestId: string, userId: string, reason: string, details?: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.messageRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Yêu cầu nhắn tin không tồn tại');
      if (request.receiverId !== userId) {
        throw new ForbiddenException('Bạn không có quyền xử lý yêu cầu này');
      }

      const result = await tx.messageRequest.updateMany({
        where: { id: requestId, receiverId: userId, status: 'PENDING' },
        data: { status: 'REPORTED', respondedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException('Yêu cầu này đã được xử lý');
      }

      const report = await this.reportsService.createMessageRequestReport(tx, {
        reporterId: userId,
        reportedId: request.senderId,
        reason,
        details,
        messageRequestId: requestId,
      });

      const updated = await tx.messageRequest.findUniqueOrThrow({ where: { id: requestId } });
      return { request: updated, report };
    });
  }

  private describeExistingRequestConflict(
    existing: { senderId: string; status: string },
    senderId: string,
  ): string {
    if (existing.senderId === senderId) {
      return 'Bạn đã gửi yêu cầu nhắn tin cho người này rồi';
    }
    if (existing.status === 'PENDING') {
      return 'Người này đã gửi cho bạn một yêu cầu nhắn tin, hãy phản hồi yêu cầu đó';
    }
    return 'Không thể gửi yêu cầu nhắn tin mới cho cặp người dùng này';
  }
}
