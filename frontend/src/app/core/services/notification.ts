import { Injectable, effect, inject } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BehaviorSubject, Observable, from, interval } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import { SupabaseService } from './supabase';
import { ToastService } from './toast';
import type { MembershipPlan } from '../models/membership-plan';

export interface Notification {
  id: string;
  userId: string;
  senderId?: string;
  pinId?: string;
  type:
    | 'LIKE'
    | 'COMMENT'
    | 'SAVE'
    | 'POST_SUCCESS'
    | 'POST_AI_SUCCESS'
    | 'FOLLOW'
    | 'FOLLOW_REQUEST';
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: {
    id: string;
    username: string;
    avatarUrl?: string;
    plan: MembershipPlan;
  };
  pin?: {
    id: string;
    title: string;
    imageUrl: string;
  };
}

export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private auth = inject(SupabaseService);
  private toast = inject(ToastService);
  private readonly baseUrl = `${API_BASE_URL}/api/notifications`;
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  private unreadCountSubject = new BehaviorSubject<number>(0);

  private realtimeChannel: RealtimeChannel | null = null;
  private realtimeUserId: string | null = null;

  notifications$ = this.notificationsSubject.asObservable();
  unreadCount$ = this.unreadCountSubject.asObservable();

  constructor() {
    this.startPolling();
    // Instant push — a per-user Supabase Realtime channel the backend
    // broadcasts to right after creating a notification (see
    // NotificationsService.createNotification). Polling stays on as a
    // silent reconciliation fallback in case a broadcast is missed.
    effect(() => {
      const userId = this.auth.user()?.id ?? null;
      this.connectRealtime(userId);
    });
  }

  private connectRealtime(userId: string | null): void {
    if (this.realtimeUserId === userId) return;
    if (this.realtimeChannel) {
      this.auth.getRealtimeClient().removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.realtimeUserId = userId;
    if (!userId) return;

    this.realtimeChannel = this.auth
      .getRealtimeClient()
      .channel(`user:${userId}`)
      .on('broadcast', { event: 'notification' }, ({ payload }) => {
        this.handleRealtimeNotification(payload as Notification);
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.debug(`[NotificationService] Realtime kết nối OK — kênh user:${userId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.error(`[NotificationService] Realtime lỗi (${status}) trên kênh user:${userId}`, err);
        }
      });
  }

  private handleRealtimeNotification(notification: Notification): void {
    this.notificationsSubject.next([notification, ...this.notificationsSubject.value]);
    this.unreadCountSubject.next(this.unreadCountSubject.value + 1);
    const message = notification.sender?.username
      ? `${notification.sender.username} ${notification.content}`
      : notification.content;
    this.toast.notify(message);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.auth.getSessionToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await safeFetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      let message = `Yêu cầu thất bại (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || message;
      } catch {
        // Giữ message theo status nếu server không trả JSON.
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  }

  /** Silent reconciliation only — the realtime channel above is what makes
   * new notifications appear instantly; this just corrects drift (missed
   * broadcast, reconnect gap) without re-toasting anything. */
  private startPolling(): void {
    interval(30000)
      .pipe(
        switchMap(() => this.getUnreadCount()),
        tap((response) => {
          this.unreadCountSubject.next(response.unreadCount);
        }),
        catchError(() => {
          return of({ unreadCount: 0 });
        })
      )
      .subscribe();
  }

  getNotifications(page: number = 1, limit: number = 20): Observable<NotificationsResponse> {
    return from(this.request<NotificationsResponse>(`?page=${page}&limit=${limit}`));
  }

  getUnreadCount(): Observable<{ unreadCount: number }> {
    return from(this.request<{ unreadCount: number }>('/unread/count'));
  }

  markAsRead(notificationId: string): Observable<Notification> {
    return from(this.request<Notification>(`/${notificationId}/read`, { method: 'PATCH' })).pipe(
      tap(() => {
        const wasUnread = this.notificationsSubject.value.find((n) => n.id === notificationId)?.isRead === false;
        this.notificationsSubject.next(
          this.notificationsSubject.value.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
        );
        if (wasUnread) {
          this.unreadCountSubject.next(Math.max(0, this.unreadCountSubject.value - 1));
        }
      })
    );
  }

  markAllAsRead(): Observable<unknown> {
    return from(this.request('/all/read', { method: 'PATCH' })).pipe(
      tap(() => {
        this.notificationsSubject.next(this.notificationsSubject.value.map((n) => ({ ...n, isRead: true })));
        this.unreadCountSubject.next(0);
      })
    );
  }

  loadNotifications(page: number = 1, limit: number = 20): void {
    this.getNotifications(page, limit)
      .pipe(
        tap((response) => {
          this.notificationsSubject.next(response.notifications);
          this.unreadCountSubject.next(response.unreadCount);
        }),
        catchError(() => {
          return of();
        })
      )
      .subscribe();
  }
}
