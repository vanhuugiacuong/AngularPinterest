import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationTemplateHelper, NotificationData, NOTIFICATION_TEMPLATES, NotificationTemplate } from '../templates/notification.templates';

export type NotificationType = 'LIKE' | 'COMMENT' | 'SAVE' | 'POST_SUCCESS' | 'POST_AI_SUCCESS';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.notification.create({
      data: {
        userId,
        senderId,
        pinId,
        type,
        content: finalContent,
      },
      include: {
        sender: {
          select: { id: true, username: true, avatarUrl: true },
        },
        pin: {
          select: { id: true, title: true, imageUrl: true },
        },
      },
    });
  }

  async getNotifications(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        include: {
          sender: {
            select: { id: true, username: true, avatarUrl: true },
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
