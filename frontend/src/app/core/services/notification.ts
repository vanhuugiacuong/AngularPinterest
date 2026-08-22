import { Injectable } from '@angular/core';

export type NotificationType = 'like' | 'comment' | 'follow' | 'save' | 'new_pin' | 'message_request' | 'message';

export interface AppNotification {
  id: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
  content: string;
  sender: {
    id: string;
    username: string;
    avatarUrl?: string;
  } | null;
  pin: {
    id: string;
    imageUrl: string;
    title: string;
  } | null;
  groupCount?: number;
  groupedIds?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private baseUrl = 'http://localhost:3000/api/notifications';

  async getNotifications(token: string, page = 1, limit = 30): Promise<AppNotification[]> {
    const response = await fetch(`${this.baseUrl}?page=${page}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch notifications: ${response.statusText}`);
    }
    return await response.json();
  }

  async getUnreadCount(token: string): Promise<number> {
    const response = await fetch(`${this.baseUrl}/unread-count`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch unread count: ${response.statusText}`);
    }
    const data = await response.json();
    return data.count ?? 0;
  }

  async markAllRead(token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to mark notifications as read: ${response.statusText}`);
    }
  }
}
