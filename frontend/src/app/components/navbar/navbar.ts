import { Component, inject, signal, ElementRef, HostListener, Output, EventEmitter, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase';
import { ThemeService } from '../../core/services/theme';
import { NotificationService, AppNotification } from '../../core/services/notification';
import { NotificationSocketService } from '../../core/services/notification-socket';
import { NotificationItem } from '../notification-item/notification-item';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, NotificationItem],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css'
})
export class Navbar {
  public supabaseService = inject(SupabaseService);
  public themeService = inject(ThemeService);
  private notificationService = inject(NotificationService);
  private notificationSocket = inject(NotificationSocketService);
  private router = inject(Router);
  private elementRef = inject(ElementRef);

  @Output() loginClick = new EventEmitter<void>();
  @ViewChild('bottomNavEl') bottomNavEl?: ElementRef;

  public showProfilePopup = signal(false);
  public isNavExpanded = signal(false);

  public showNotifPopup = signal(false);
  public notifications = signal<AppNotification[]>([]);
  public unreadCount = signal(0);
  public notifLoading = signal(false);

  public toasts = signal<{ id: number; notification: AppNotification }[]>([]);
  private toastSeq = 0;
  private toastTimers = new Map<number, any>();

  private collapseTimer: any = null;
  private longPressTimer: any = null;
  private longPressTriggered = false;
  private unreadPollTimer: any = null;

  constructor() {
    this.notificationSocket.onNotification((notification) => {
      this.unreadCount.update((count) => count + 1);
      if (this.showNotifPopup()) {
        this.notifications.update((list) => [notification, ...list]);
      }
      this.pushToast(notification);
    });

    effect(() => {
      const user = this.supabaseService.user();
      if (user) {
        this.refreshUnreadCount();
        this.notificationSocket.connect();
        if (!this.unreadPollTimer) {
          this.unreadPollTimer = setInterval(() => this.refreshUnreadCount(), 30000);
        }
      } else {
        this.unreadCount.set(0);
        this.notificationSocket.disconnect();
        if (this.unreadPollTimer) {
          clearInterval(this.unreadPollTimer);
          this.unreadPollTimer = null;
        }
      }
    });
  }

  private async refreshUnreadCount() {
    const token = await this.supabaseService.getSessionToken();
    if (!token) return;
    try {
      this.unreadCount.set(await this.notificationService.getUnreadCount(token));
    } catch (error) {
      console.error('Error fetching unread notification count:', error);
    }
  }

  async toggleNotifPopup(event: MouseEvent) {
    event.stopPropagation();
    this.showProfilePopup.set(false);
    const opening = !this.showNotifPopup();
    this.showNotifPopup.set(opening);
    if (!opening) return;

    this.notifLoading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      this.notifications.set(await this.notificationService.getNotifications(token));
      if (this.unreadCount() > 0) {
        await this.notificationService.markAllRead(token);
        this.unreadCount.set(0);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      this.notifLoading.set(false);
    }
  }

  onNotificationClick(notification: AppNotification) {
    this.showNotifPopup.set(false);
    if (notification.pin) {
      this.router.navigate(['/pin', notification.pin.id]);
    } else if (notification.sender) {
      this.router.navigate(['/profile', notification.sender.username]);
    }
  }

  private pushToast(notification: AppNotification) {
    const id = ++this.toastSeq;
    this.toasts.update((list) => [...list, { id, notification }].slice(-3));
    const timer = setTimeout(() => this.dismissToast(id), 5000);
    this.toastTimers.set(id, timer);
  }

  dismissToast(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
    const timer = this.toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.toastTimers.delete(id);
    }
  }

  onToastClick(id: number, notification: AppNotification) {
    this.dismissToast(id);
    this.onNotificationClick(notification);
  }

  toggleProfilePopup(event: MouseEvent) {
    event.stopPropagation();
    this.showNotifPopup.set(false);
    this.showProfilePopup.update(val => !val);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.showProfilePopup.set(false);
      this.showNotifPopup.set(false);
    }
    if (this.bottomNavEl && !this.bottomNavEl.nativeElement.contains(target)) {
      this.isNavExpanded.set(false);
    }
  }

  // Desktop: hover over the bottom nav fans the icons out
  onNavMouseEnter() {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    this.isNavExpanded.set(true);
  }

  onNavMouseLeave() {
    this.collapseTimer = setTimeout(() => this.isNavExpanded.set(false), 200);
  }

  // Mobile: press and hold the Home button to fan the icons out
  onHomeTouchStart() {
    this.longPressTriggered = false;
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
      this.isNavExpanded.set(true);
    }, 350);
  }

  onHomeTouchEnd() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  onHomeClick() {
    // Swallow the click that follows a long-press touch (it already opened the fan)
    if (this.longPressTriggered) {
      this.longPressTriggered = false;
      return;
    }
    this.onLogoClick();
    this.isNavExpanded.set(false);
  }

  collapseNav() {
    this.isNavExpanded.set(false);
  }

  onLoginClick() {
    this.loginClick.emit();
  }

  onLogoClick() {
    if (this.supabaseService.user()) {
      this.router.navigate(['/feed']);
    } else {
      this.router.navigate(['/']);
    }
  }

  async navigateToMyProfile() {
    this.showProfilePopup.set(false);
    this.collapseNav();

    const dbUser = await this.supabaseService.ensureDbUser();
    if (dbUser?.username) {
      this.router.navigate(['/profile', dbUser.username]);
      return;
    }

    // Fall back to a best-guess username only if the real DB record truly isn't reachable
    // (e.g. offline) — loadProfile() will show a toast if this guess turns out wrong.
    const user = this.supabaseService.user();
    if (user) {
      const email = user.email || '';
      const username = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || email.split('@')[0];
      this.router.navigate(['/profile', username]);
    }
  }

  navigateToCreate() {
    this.router.navigate(['/create']);
    this.collapseNav();
  }

  navigateToExplore() {
    this.router.navigate(['/feed'], { queryParams: { sort: 'trending' } });
    this.collapseNav();
  }

  navigateToSettings() {
    this.showProfilePopup.set(false);
    this.router.navigate(['/settings']);
  }

  onSearchSubmit(event: Event) {
    const input = event.target as HTMLInputElement;
    const q = input.value.trim();
    this.router.navigate(['/search'], { queryParams: q ? { q } : {} });
  }

  async signOut() {
    await this.supabaseService.signOut();
    this.router.navigate(['/']);
  }

  isProfilePage(): boolean {
    return this.router.url.includes('/profile');
  }

  isFeedPage(): boolean {
    return this.router.url === '/feed' || this.router.url === '/';
  }

  isCreatePage(): boolean {
    return this.router.url === '/create';
  }

  isExplorePage(): boolean {
    return this.router.url.startsWith('/feed') && this.router.url.includes('sort=trending');
  }

  isNotificationsPage(): boolean {
    return this.router.url.startsWith('/notifications');
  }
}
