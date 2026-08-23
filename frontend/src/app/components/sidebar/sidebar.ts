import { Component, inject, OnInit, OnDestroy, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SidebarStateService } from '../../core/services/sidebar-state';
import { NotificationService, Notification } from '../../core/services/notification';
import { Observable } from 'rxjs';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { UserService } from '../../core/services/user';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { toUserMessage } from '../../core/utils/http-error';

/** Reserves room for the fixed mobile bottom nav so it never covers page
 * content — set once for the lifetime of the (always-mounted, one-per-app)
 * Sidebar rather than per-route, so it isn't the kind of per-page style hack
 * that causes theme flicker; it's a stable app-shell concern. */
const BODY_DOCK_CLASS = 'nf-has-dock';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, UserAvatar],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css'
})
export class Sidebar implements OnInit, OnDestroy {
  public sidebarState = inject(SidebarStateService);
  private notificationService = inject(NotificationService);
  private userService = inject(UserService);
  private supabaseService = inject(SupabaseService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  isNotificationOpen = false;
  unreadCount$: Observable<number> = this.notificationService.unreadCount$;
  notifications$: Observable<Notification[]> = this.notificationService.notifications$;

  /** Local, session-only bookkeeping for inline follow-request actions in
   * the notification list - keyed by the requester's user id (senderId),
   * since a Notification row has no follow-request id to key off of and the
   * backend's accept/reject endpoints are themselves keyed by sender. */
  private followRequestPendingIds = signal<Set<string>>(new Set());
  private followRequestOutcomes = signal<Map<string, 'accepted' | 'rejected'>>(new Map());

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

  /** Dims the page any time the rail is open, including a desktop
   * hover-preview — this is the intended "spotlight the dashboard" effect.
   * The scrim itself deliberately does NOT extend the hover zone (see the
   * comment on the backdrop element in sidebar.html): it covers the whole
   * page, so if entering it counted as "still hovering the sidebar" the
   * rail would almost never auto-close on mouse-leave. Auto-close on
   * leaving the hamburger/rail is handled entirely by
   * SidebarStateService.scheduleClose()'s debounce. */
  showBackdrop(): boolean {
    return this.isNotificationOpen || this.sidebarState.isOpen();
  }

  /** A background tap is a deliberate dismissal — closes immediately via
   * `close()`, not the hover-leave debounce (`scheduleClose()` is a no-op on
   * touch devices anyway, since there's no hover to time out). */
  onBackdropClick(): void {
    this.closeNotifications();
    if (!this.sidebarState.supportsHover) {
      this.sidebarState.close();
    }
  }

  toggleNotifications(): void {
    this.isNotificationOpen = !this.isNotificationOpen;
    if (this.isNotificationOpen) {
      this.sidebarState.openSidebar();
      this.notificationService.loadNotifications();
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

  isFollowRequestPending(requesterId: string): boolean {
    return this.followRequestPendingIds().has(requesterId);
  }

  isFollowRequestHandled(requesterId: string): boolean {
    return this.followRequestOutcomes().has(requesterId);
  }

  followRequestOutcome(requesterId: string): string {
    return this.followRequestOutcomes().get(requesterId) === 'accepted'
      ? 'Đã chấp nhận'
      : 'Đã từ chối';
  }

  async acceptFollowRequest(item: Notification): Promise<void> {
    if (!item.senderId || this.isFollowRequestPending(item.senderId)) return;
    await this.resolveFollowRequest(item.senderId, 'accepted');
  }

  async rejectFollowRequest(item: Notification): Promise<void> {
    if (!item.senderId || this.isFollowRequestPending(item.senderId)) return;
    await this.resolveFollowRequest(item.senderId, 'rejected');
  }

  private async resolveFollowRequest(
    requesterId: string,
    outcome: 'accepted' | 'rejected',
  ): Promise<void> {
    this.followRequestPendingIds.update((ids) => new Set(ids).add(requesterId));
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Bạn cần đăng nhập lại để thực hiện thao tác này.');

      if (outcome === 'accepted') {
        await this.userService.acceptFollowRequest(requesterId, token);
      } else {
        await this.userService.rejectFollowRequest(requesterId, token);
      }

      this.followRequestOutcomes.update((map) => new Map(map).set(requesterId, outcome));
    } catch (error) {
      this.toastService.error(toUserMessage(error, 'Không thể xử lý yêu cầu theo dõi.'));
    } finally {
      this.followRequestPendingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(requesterId);
        return next;
      });
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
