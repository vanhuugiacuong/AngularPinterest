import { Component, inject, OnInit, OnDestroy, HostListener, signal } from '@angular/core';
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
import { toUserMessage } from '../../core/utils/http-error';
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
  private toastService = inject(ToastService);
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

  showBackdrop(): boolean {
    return this.isNotificationOpen || this.sidebarState.isOpen();
  }

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

  isFollowRequestPending(requesterId: string): boolean {
    return this.followRequestPendingIds().has(requesterId) || this.respondingFollowRequests.has(requesterId);
  }

  isFollowRequestHandled(requesterId: string): boolean {
    return this.followRequestOutcomes().has(requesterId) || this.handledFollowRequests.has(requesterId);
  }

  followRequestOutcome(requesterId: string): string {
    const outcome = this.followRequestOutcomes().get(requesterId) || this.handledFollowRequests.get(requesterId);
    return outcome === 'accepted' ? 'Đã chấp nhận' : 'Đã từ chối';
  }

  isPendingFollowRequest(item: Notification): boolean {
    return item.type === 'FOLLOW_REQUEST' && !!item.senderId && !this.isFollowRequestHandled(item.senderId);
  }

  getFollowRequestResult(item: Notification): 'accepted' | 'rejected' | null {
    return item.senderId ? this.handledFollowRequests.get(item.senderId) ?? this.followRequestOutcomes().get(item.senderId) ?? null : null;
  }

  isRespondingToFollowRequest(item: Notification): boolean {
    return !!item.senderId && this.isFollowRequestPending(item.senderId);
  }

  async acceptFollowRequest(item: Notification, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!item.senderId || this.isFollowRequestPending(item.senderId)) return;
    await this.resolveFollowRequest(item, 'accepted');
  }

  async rejectFollowRequest(item: Notification, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!item.senderId || this.isFollowRequestPending(item.senderId)) return;
    await this.resolveFollowRequest(item, 'rejected');
  }

  private async resolveFollowRequest(
    item: Notification,
    outcome: 'accepted' | 'rejected',
  ): Promise<void> {
    const requesterId = item.senderId;
    if (!requesterId) return;

    this.respondingFollowRequests.add(requesterId);
    this.followRequestPendingIds.update((ids) => new Set(ids).add(requesterId));

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Bạn cần đăng nhập lại để thực hiện thao tác này.');

      if (outcome === 'accepted') {
        await this.userService.acceptFollowRequest(requesterId, token);
      } else {
        await this.userService.rejectFollowRequest(requesterId, token);
      }

      this.handledFollowRequests.set(requesterId, outcome);
      this.followRequestOutcomes.update((map) => new Map(map).set(requesterId, outcome));

      if (!item.isRead) {
        this.notificationService.markAsRead(item.id).subscribe();
      }
      this.toastService.success(outcome === 'accepted' ? 'Đã chấp nhận yêu cầu theo dõi.' : 'Đã từ chối yêu cầu theo dõi.');
    } catch (error) {
      this.toastService.error(toUserMessage(error, 'Không thể xử lý yêu cầu theo dõi.'));
    } finally {
      this.respondingFollowRequests.delete(requesterId);
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
