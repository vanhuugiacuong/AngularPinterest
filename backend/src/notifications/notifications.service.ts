import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type NotificationType = 'like' | 'comment' | 'follow';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    recipientId: string,
    actorId: string,
    type: NotificationType,
    pinId?: string,
    commentSnippet?: string,
  ) {
    // Never notify a user about their own activity
    if (recipientId === actorId) {
      return null;
    }

    return this.prisma.notification.create({
      data: {
        recipientId,
        actorId,
        type,
        pinId,
        commentSnippet,
      },
    });
  }

  async getForUser(userId: string, page: number = 1, limit: number = 30) {
    const skip = (page - 1) * limit;
    return this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        actor: { select: { id: true, username: true, avatarUrl: true } },
        pin: { select: { id: true, imageUrl: true, title: true } },
      },
    });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });
    return { count };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }
}
