import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

const NOTIFICATION_INCLUDE = {
  sender: { select: { id: true, username: true, avatarUrl: true, isPro: true, pinhubProPlan: true } },
  pin: { select: { id: true, imageUrl: true, title: true } },
} as const;

export type NotificationType = 'like' | 'comment' | 'follow' | 'save' | 'new_pin' | 'message_request' | 'message';

const CONTENT_BY_TYPE: Record<NotificationType, (extra?: string) => string> = {
  like: () => 'đã thích ảnh của bạn',
  comment: (extra) => `đã bình luận: "${extra}"`,
  follow: () => 'đã bắt đầu theo dõi bạn',
  save: () => 'đã lưu ảnh của bạn vào một bảng',
  new_pin: () => 'vừa đăng một ảnh ghim mới',
  message_request: () => 'muốn nhắn tin với bạn',
  message: () => 'đã gửi cho bạn một tin nhắn',
};

// Types where it makes sense to merge several rows into one line ("X and 4 others liked your pin").
// Comments and new-pin posts stay one-per-row since each carries its own distinct content.
const GROUPABLE_TYPES = new Set<NotificationType>(['like', 'save', 'follow']);

type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof NOTIFICATION_INCLUDE }>;

function groupNotifications(rows: NotificationRow[]) {
  const groups = new Map<string, NotificationRow[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = GROUPABLE_TYPES.has(row.type as NotificationType)
      ? `${row.type}:${row.pinId ?? 'none'}`
      : `single:${row.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  return order.map((key) => {
    const members = groups.get(key)!;
    const newest = members[0];
    const count = members.length;
    const allRead = members.every((m) => m.isRead);

    return {
      id: newest.id,
      type: newest.type,
      isRead: allRead,
      createdAt: newest.createdAt,
      content: newest.content,
      sender: newest.sender,
      pin: newest.pin,
      groupCount: count,
      groupedIds: members.map((m) => m.id),
    };
  });
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(
    recipientId: string,
    actorId: string,
    type: NotificationType,
    pinId?: string,
    extra?: string,
  ) {
    // Never notify a user about their own activity
    if (recipientId === actorId) {
      return null;
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: recipientId,
        senderId: actorId,
        type,
        pinId,
        content: CONTENT_BY_TYPE[type](extra),
      },
      include: NOTIFICATION_INCLUDE,
    });

    this.gateway.emitToUser(recipientId, notification);
    return notification;
  }

  async notifyFollowersOfNewPin(actorId: string, pinId: string) {
    const followers = await this.prisma.follow.findMany({
      where: { followingId: actorId },
      select: { followerId: true },
    });
    if (followers.length === 0) {
      return;
    }

    const batchStart = new Date();
    await this.prisma.notification.createMany({
      data: followers.map(({ followerId }) => ({
        userId: followerId,
        senderId: actorId,
        type: 'new_pin' as NotificationType,
        pinId,
        content: CONTENT_BY_TYPE.new_pin(),
      })),
    });

    const created = await this.prisma.notification.findMany({
      where: {
        type: 'new_pin',
        senderId: actorId,
        pinId,
        createdAt: { gte: batchStart },
      },
      include: NOTIFICATION_INCLUDE,
    });
    for (const notification of created) {
      this.gateway.emitToUser(notification.userId, notification);
    }
  }

  async getForUser(userId: string, page: number = 1, limit: number = 30) {
    const skip = (page - 1) * limit;
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: NOTIFICATION_INCLUDE,
    });
    return groupNotifications(rows);
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }
}
