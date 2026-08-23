import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from, interval } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import { SupabaseService } from './supabase';
import type { MembershipPlan } from '../models/membership-plan';

export interface Notification {
  id: string;
  userId: string;
  senderId?: string;
  pinId?: string;
  type: 'LIKE' | 'COMMENT' | 'SAVE' | 'POST_SUCCESS' | 'POST_AI_SUCCESS' | 'FOLLOW' | 'FOLLOW_REQUEST';
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
  private readonly baseUrl = `${API_BASE_URL}/api/notifications`;
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  private unreadCountSubject = new BehaviorSubject<number>(0);

  notifications$ = this.notificationsSubject.asObservable();
  unreadCount$ = this.unreadCountSubject.asObservable();

  constructor() {
    this.startPolling();
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
    return from(this.request<Notification>(`/${notificationId}/read`, { method: 'PATCH' }));
  }

  markAllAsRead(): Observable<unknown> {
    return from(this.request('/all/read', { method: 'PATCH' }));
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
