import { Component, effect, inject, OnInit, OnDestroy, HostListener, signal } from '@angular/core';
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
import { SidebarIcon } from './sidebar-icon';

/** Marks the authenticated app shell so global responsive spacing can reserve
 * the persistent desktop rail and the fixed mobile dock without per-route
 * layout overrides. */
const BODY_DOCK_CLASS = 'nf-has-dock';
const BODY_EXPANDED_CLASS = 'nf-sidebar-expanded';

/** Chuột ra xa mép phải rail quá ngưỡng này (px) thì rail tự thu gọn. Đủ rộng
 * để một cú lia chuột chéo qua không làm rail sập ngay, nhưng vẫn nhỏ hơn
 * khoảng cách tới vùng nội dung chính nên rời rail có chủ đích là thu. */
const AUTO_COLLAPSE_DISTANCE_PX = 160;

/** Bề rộng rail mở dùng khi chưa đọc được biến CSS (chỉ là lưới an toàn —
 * `--nf-shell-sidebar-width` mới là nguồn thật, xem styles.css). */
const FALLBACK_EXPANDED_RAIL_PX = 248;

/** Dưới ngưỡng này rail là drawer phủ có backdrop, đóng bằng cách bấm backdrop
 * — tự thu theo khoảng cách chuột không áp dụng. Khớp `@media (min-width: 768px)`
 * của shell trong styles.css. */
const DOCK_MIN_WIDTH_PX = 768;

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, UserAvatar, BadgeBumpDirective, SidebarIcon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css'
})
export class Sidebar implements OnInit, OnDestroy {
  public sidebarState = inject(SidebarStateService);
  private notificationService = inject(NotificationService);
  private messagingService = inject(MessagingService);
  private userService = inject(UserService);
  public supabaseService = inject(SupabaseService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private readonly syncShellWidth = effect((onCleanup) => {
    document.body.classList.toggle(BODY_EXPANDED_CLASS, this.sidebarState.isExpanded());
    onCleanup(() => document.body.classList.remove(BODY_EXPANDED_CLASS));
  });

  isNotificationOpen = false;
  unreadCount$: Observable<number> = this.notificationService.unreadCount$;
  notifications$: Observable<Notification[]> = this.notificationService.notifications$;
  unreadMessageCount$: Observable<number> = this.messagingService.unreadCount$;
  private notificationItems: Notification[] = [];
  private readonly notificationItemsSubscription = this.notifications$.subscribe((items) => {
    this.notificationItems = items;
  });

  /** Local, session-only bookkeeping for inline follow-request actions.
   * UI state is keyed by notification id so a later request from the same
   * sender is a fresh actionable item. The API still uses senderId. */
  private followRequestPendingIds = signal<Set<string>>(new Set());
  private followRequestOutcomes = signal<Map<string, 'accepted' | 'rejected'>>(new Map());

  ngOnInit(): void {
    this.notificationService.loadNotifications();
    document.body.classList.add(BODY_DOCK_CLASS);
  }

  ngOnDestroy(): void {
    this.notificationItemsSubscription.unsubscribe();
    document.body.classList.remove(BODY_DOCK_CLASS);
    document.body.classList.remove(BODY_EXPANDED_CLASS);
  }

  @HostListener('window:keydown.escape')
  handleEscapeKey(): void {
    this.isNotificationOpen = false;
    this.sidebarState.collapseSidebar();
  }

  /** Tự thu gọn rail khi chuột đi ra xa nó. Mở rộng vẫn phải bấm — chỉ chiều
   * thu là tự động, nên không quay lại kiểu hover-để-mở mà PR click-only đã
   * bỏ.
   *
   * Đọc bề rộng từ biến CSS `--nf-shell-sidebar-width` chứ không đo phần tử:
   * rail có transition 260ms, đo bằng getBoundingClientRect giữa lúc đang mở
   * sẽ trả về bề rộng dở dang và làm rail thu lại ngay khi vừa bung. Biến CSS
   * mang giá trị ĐÍCH và không bị transition, nên đọc lúc nào cũng đúng. */
  @HostListener('document:mousemove', ['$event'])
  handlePointerDistance(event: MouseEvent): void {
    if (!this.sidebarState.isExpanded()) return;
    // Bảng thông báo neo cạnh rail và tự force-expand khi mở; thu rail lúc đó
    // sẽ kéo bảng chạy theo giữa lúc người dùng đang đọc.
    if (this.isNotificationOpen) return;
    if (!this.canAutoCollapse()) return;

    const railRight = this.expandedRailWidth(); // rail là fixed, left: 0
    if (event.clientX > railRight + AUTO_COLLAPSE_DISTANCE_PX) {
      this.sidebarState.collapseSidebar();
    }
  }

  /** Chỉ áp dụng cho con trỏ thật trên bố cục dock. Thiết bị cảm ứng không có
   * "chuột ra xa" — mọi lần chạm đều là một điểm rời rạc, tự thu sẽ đóng rail
   * ngay sau khi người dùng chạm để mở. */
  private canAutoCollapse(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.innerWidth < DOCK_MIN_WIDTH_PX) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  private expandedRailWidth(): number {
    const raw = getComputedStyle(document.body).getPropertyValue('--nf-shell-sidebar-width');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : FALLBACK_EXPANDED_RAIL_PX;
  }

  onRailClick(event: MouseEvent): void {
    if (this.sidebarState.isExpanded()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, [role="button"]')) return;
    this.sidebarState.expandSidebar();
  }

  onRailKeydown(event: Event): void {
    if (event.target !== event.currentTarget || this.sidebarState.isExpanded()) return;
    event.preventDefault();
    this.sidebarState.expandSidebar();
  }

  onBrandClick(event: MouseEvent): void {
    event.stopPropagation();
    this.sidebarState.toggleSidebar();
  }

  onBackdropClick(): void {
    this.isNotificationOpen = false;
    this.sidebarState.collapseSidebar();
  }

  toggleNotifications(): void {
    this.isNotificationOpen = !this.isNotificationOpen;
    if (this.isNotificationOpen) {
      this.sidebarState.expandSidebar();
      this.notificationService.loadNotifications();
      this.notificationService.markAllAsRead().subscribe();
    }
  }

  closeNotifications(): void {
    this.isNotificationOpen = false;
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

  isFollowRequestPending(notificationId: string): boolean {
    return this.followRequestPendingIds().has(notificationId);
  }

  isFollowRequestHandled(notificationId: string): boolean {
    return this.followRequestOutcomes().has(notificationId);
  }

  isPendingFollowRequest(item: Notification): boolean {
    return (
      item.type === 'FOLLOW_REQUEST' &&
      !!item.senderId &&
      this.isLatestFollowRequestFromSender(item) &&
      !this.isFollowRequestHandled(item.id)
    );
  }

  private isLatestFollowRequestFromSender(item: Notification): boolean {
    // Notifications arrive newest-first from both the API and realtime push.
    // Older duplicate rows must never become actionable after the latest row
    // is handled; a later retry gets a new id and naturally becomes first.
    const latest = this.notificationItems.find(
      (candidate) => candidate.type === 'FOLLOW_REQUEST' && candidate.senderId === item.senderId,
    );
    return !latest || latest.id === item.id;
  }

  getFollowRequestResult(item: Notification): 'accepted' | 'rejected' | null {
    return this.followRequestOutcomes().get(item.id) ?? null;
  }

  isRespondingToFollowRequest(item: Notification): boolean {
    return this.isFollowRequestPending(item.id);
  }

  async acceptFollowRequest(item: Notification, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!item.senderId || this.isFollowRequestPending(item.id)) return;
    await this.resolveFollowRequest(item, 'accepted');
  }

  async rejectFollowRequest(item: Notification, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!item.senderId || this.isFollowRequestPending(item.id)) return;
    await this.resolveFollowRequest(item, 'rejected');
  }

  private async resolveFollowRequest(
    item: Notification,
    outcome: 'accepted' | 'rejected',
  ): Promise<void> {
    const requesterId = item.senderId;
    if (!requesterId) return;

    this.followRequestPendingIds.update((ids) => new Set(ids).add(item.id));

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Bạn cần đăng nhập lại để thực hiện thao tác này.');

      if (outcome === 'accepted') {
        await this.userService.acceptFollowRequest(requesterId, token);
      } else {
        await this.userService.rejectFollowRequest(requesterId, token);
      }

      this.followRequestOutcomes.update((map) => new Map(map).set(item.id, outcome));

      if (!item.isRead) {
        this.notificationService.markAsRead(item.id).subscribe();
      }
      this.toastService.success(outcome === 'accepted' ? 'Đã chấp nhận yêu cầu theo dõi.' : 'Đã từ chối yêu cầu theo dõi.');
    } catch (error) {
      this.toastService.error(toUserMessage(error, 'Không thể xử lý yêu cầu theo dõi.'));
    } finally {
      this.followRequestPendingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(item.id);
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
    this.closeNotifications();
    this.router.navigate(['/messages']);
  }

  navigateToSettings(): void {
    this.closeNotifications();
    this.router.navigate(['/settings']);
  }

  avatarUrl(): string | null {
    const dbAvatar = this.supabaseService.dbUser()?.avatarUrl;
    if (dbAvatar) return dbAvatar;
    const user = this.supabaseService.user();
    return user?.user_metadata?.['avatar_url'] || user?.user_metadata?.['picture'] || null;
  }

  displayName(): string {
    const dbUser = this.supabaseService.dbUser();
    if (dbUser) return dbUser.displayName || dbUser.username;
    const user = this.supabaseService.user();
    return (
      user?.user_metadata?.['full_name'] ||
      user?.user_metadata?.['name'] ||
      user?.email?.split('@')[0] ||
      ''
    );
  }

  navigateToMyProfile(): void {
    // Như mọi handler điều hướng khác trong rail: rời trang thì đóng bảng thông
    // báo. Thiếu dòng này (chỉ riêng handler profile) làm bảng thông báo dính
    // lại và tab của nó vẫn sáng sau khi đã sang trang cá nhân.
    this.closeNotifications();
    const dbUser = this.supabaseService.dbUser();
    const user = this.supabaseService.user();
    const profileIdentifier = dbUser?.username || user?.id;
    if (profileIdentifier) {
      this.router.navigate(['/profile', profileIdentifier]);
    }
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
