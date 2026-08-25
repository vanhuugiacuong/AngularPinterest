import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationTemplateHelper, NotificationData, NOTIFICATION_TEMPLATES, NotificationTemplate } from '../templates/notification.templates';
import { PUBLIC_USER_SELECT } from '../common/relationship.util';

export type NotificationType =
  | 'LIKE'
  | 'COMMENT'
  | 'SAVE'
  | 'POST_SUCCESS'
  | 'POST_AI_SUCCESS'
  | 'FOLLOW'
  | 'FOLLOW_REQUEST'
  | 'AUCTION_NEW_BID'
  | 'AUCTION_OUTBID'
  | 'AUCTION_WON'
  | 'AUCTION_ENDED_NO_BIDS'
  | 'AUCTION_SALE_PAID'
  | 'PURCHASE_CONFIRMED_BY_SELLER';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    content: string,
    senderId?: string,
    pinId?: string,
    templateData?: NotificationData,
  ) {
    let finalContent = content;

    // If templateData is provided, use templates to format the message
    if (templateData && !content) {
      const template = NotificationTemplateHelper.getTemplate(type, 'friendly');
      if (template) {
        finalContent = NotificationTemplateHelper.formatMessage(template, templateData);
      }
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        senderId,
        pinId,
        type,
        content: finalContent,
      },
      include: {
        sender: {
          select: PUBLIC_USER_SELECT,
        },
        pin: {
          select: { id: true, title: true, imageUrl: true },
        },
      },
    });

    void this.supabase.broadcast(`user:${userId}`, 'notification', notification);

    return notification;
  }

  async getNotifications(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        include: {
          sender: {
            select: PUBLIC_USER_SELECT,
          },
          pin: {
            select: { id: true, title: true, imageUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return {
      notifications,
      total,
      unreadCount,
    };
  }

  async markAsRead(notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }
}
