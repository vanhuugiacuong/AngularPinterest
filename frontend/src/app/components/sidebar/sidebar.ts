import { Component, inject, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SidebarStateService } from '../../core/services/sidebar-state';
import { NotificationService, Notification } from '../../core/services/notification';
import { MessagingService } from '../../core/services/messaging';
import { UserService } from '../../core/services/user';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { Observable } from 'rxjs';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { BadgeBumpDirective } from '../../shared/badge-bump.directive';

/** Reserves room for the fixed mobile bottom nav so it never covers page
 * content — set once for the lifetime of the (always-mounted, one-per-app)
 * Sidebar rather than per-route, so it isn't the kind of per-page style hack
 * that causes theme flicker; it's a stable app-shell concern. */
const BODY_DOCK_CLASS = 'nf-has-dock';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, UserAvatar, BadgeBumpDirective],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css'
})
export class Sidebar implements OnInit, OnDestroy {
  public sidebarState = inject(SidebarStateService);
  private notificationService = inject(NotificationService);
  private messagingService = inject(MessagingService);
  private userService = inject(UserService);
  private supabaseService = inject(SupabaseService);
  private toast = inject(ToastService);
  private router = inject(Router);

  isNotificationOpen = false;
  unreadCount$: Observable<number> = this.notificationService.unreadCount$;
  notifications$: Observable<Notification[]> = this.notificationService.notifications$;
  unreadMessageCount$: Observable<number> = this.messagingService.unreadCount$;

  /** Follow requests the viewer has just accepted/rejected inline from the
   * notification list — hides the Accept/Reject row for that item without
   * needing a full reload. Keyed by requester id (== notification.senderId). */
  private respondingFollowRequests = new Set<string>();
  private handledFollowRequests = new Map<string, 'accepted' | 'rejected'>();

  ngOnInit(): void {
    this.notificationService.loadNotifications();
    document.body.classList.add(BODY_DOCK_CLASS);
  }

  ngOnDestroy(): void {
    document.body.classList.remove(BODY_DOCK_CLASS);
  }

  @HostListener('window:keydown.escape')
  handleEscapeKey(): void {
    if (this.isNotificationOpen) {
      this.closeNotifications();
    }
  }

  onZoneEnter(): void {
    this.sidebarState.openSidebar();
  }

  onZoneLeave(): void {
    if (!this.isNotificationOpen) {
      this.sidebarState.scheduleClose();
    }
  }

  toggleNotifications(): void {
    this.isNotificationOpen = !this.isNotificationOpen;
    if (this.isNotificationOpen) {
      this.sidebarState.openSidebar();
      this.notificationService.loadNotifications();
      // Opening the panel counts as viewing — clear the badge right away
      // instead of requiring an explicit "Đọc tất cả" click.
      this.notificationService.markAllAsRead().subscribe();
    } else {
      this.sidebarState.scheduleClose();
    }
  }

  closeNotifications(): void {
    this.isNotificationOpen = false;
    this.sidebarState.scheduleClose();
  }

  markAllAsRead(): void {
    this.notificationService.markAllAsRead().subscribe(() => {
      this.notificationService.loadNotifications();
    });
  }

  onNotificationClick(item: Notification): void {
    if (!item.isRead) {
      this.notificationService.markAsRead(item.id).subscribe();
    }
    this.closeNotifications();
    if (item.pinId) {
      this.router.navigate(['/pin', item.pinId]);
    }
  }

  isPendingFollowRequest(item: Notification): boolean {
    return item.type === 'FOLLOW_REQUEST' && !!item.senderId && !this.handledFollowRequests.has(item.senderId);
  }

  getFollowRequestResult(item: Notification): 'accepted' | 'rejected' | null {
    return item.senderId ? this.handledFollowRequests.get(item.senderId) ?? null : null;
  }

  isRespondingToFollowRequest(item: Notification): boolean {
    return !!item.senderId && this.respondingFollowRequests.has(item.senderId);
  }

  async acceptFollowRequest(item: Notification, event: Event): Promise<void> {
    event.stopPropagation();
    await this.respondToFollowRequest(
      item,
      'accepted',
      'Đã chấp nhận yêu cầu theo dõi.',
      (requesterId, token) => this.userService.acceptFollowRequest(requesterId, token),
    );
  }

  async rejectFollowRequest(item: Notification, event: Event): Promise<void> {
    event.stopPropagation();
    await this.respondToFollowRequest(
      item,
      'rejected',
      'Đã từ chối yêu cầu theo dõi.',
      (requesterId, token) => this.userService.rejectFollowRequest(requesterId, token),
    );
  }

  private async respondToFollowRequest(
    item: Notification,
    result: 'accepted' | 'rejected',
    successMessage: string,
    action: (requesterId: string, token: string) => Promise<unknown>
  ): Promise<void> {
    const requesterId = item.senderId;
    if (!requesterId || this.respondingFollowRequests.has(requesterId)) return;
    this.respondingFollowRequests.add(requesterId);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      await action(requesterId, token);
      this.handledFollowRequests.set(requesterId, result);
      if (!item.isRead) {
        this.notificationService.markAsRead(item.id).subscribe();
      }
      this.toast.success(successMessage);
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Không thể xử lý yêu cầu theo dõi.');
    } finally {
      this.respondingFollowRequests.delete(requesterId);
    }
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Vừa xong';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} phút`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} giờ`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays} ngày`;
    const diffInMonths = Math.floor(diffInDays / 30);
    return `${diffInMonths} tháng`;
  }

  navigateHome(): void {
    this.closeNotifications();
    this.router.navigate(['/feed']);
  }

  navigateToCreate(): void {
    this.closeNotifications();
    this.router.navigate(['/create']);
  }

  navigateToCollage(): void {
    this.closeNotifications();
    this.router.navigate(['/collage']);
  }

  navigateToMessages(): void {
    this.router.navigate(['/messages']);
  }

  navigateToSettings(): void {
    this.closeNotifications();
    this.router.navigate(['/settings']);
  }

  isFeedPage(): boolean {
    return this.router.url === '/feed' || this.router.url === '/';
  }

  isCreatePage(): boolean {
    return this.router.url === '/create';
  }

  isCollagePage(): boolean {
    return this.router.url === '/collage';
  }

  isMessagesPage(): boolean {
    return this.router.url.startsWith('/messages');
  }

  isSettingsPage(): boolean {
    return this.router.url.startsWith('/settings');
  }
}
