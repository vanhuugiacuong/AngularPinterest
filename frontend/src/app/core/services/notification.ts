import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface Notification {
  id: string;
  userId: string;
  senderId?: string;
  pinId?: string;
  type: 'LIKE' | 'COMMENT' | 'SAVE' | 'POST_SUCCESS';
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: {
    id: string;
    username: string;
    avatarUrl?: string;
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
  private http = inject(HttpClient);
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  private unreadCountSubject = new BehaviorSubject<number>(0);

  notifications$ = this.notificationsSubject.asObservable();
  unreadCount$ = this.unreadCountSubject.asObservable();

  constructor() {
    this.startPolling();
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
    return this.http.get<NotificationsResponse>(`/api/notifications`, {
      params: { page: page.toString(), limit: limit.toString() },
    });
  }

  getUnreadCount(): Observable<{ unreadCount: number }> {
    return this.http.get<{ unreadCount: number }>(`/api/notifications/unread/count`);
  }

  markAsRead(notificationId: string): Observable<Notification> {
    return this.http.patch<Notification>(`/api/notifications/${notificationId}/read`, {});
  }

  markAllAsRead(): Observable<any> {
    return this.http.patch(`/api/notifications/all/read`, {});
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
