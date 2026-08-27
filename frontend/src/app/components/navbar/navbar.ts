import { Component, inject, signal, ElementRef, HostListener, Output, EventEmitter, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase';
import { ThemeService } from '../../core/services/theme';
import { NotificationService, AppNotification } from '../../core/services/notification';
import { NotificationSocketService } from '../../core/services/notification-socket';
import { NotificationItem } from '../notification-item/notification-item';
import { Icon } from '../../shared/icon/icon';
import { PinService, Pin } from '../../core/services/pin';
import { ChatService, PublicUserSummary } from '../../core/services/chat';
import { BillingService } from '../../core/services/billing';
import { VisualSearchService } from '../../core/services/visual-search';

// Lowercases and strips Vietnamese diacritics so "meo" matches "mèo" — same normalizer
// used by the /search results page, kept in sync so typing and submitting agree.
function normalizeForSearch(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, NotificationItem, Icon],
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
  private pinService = inject(PinService);
  private chatService = inject(ChatService);
  public billing = inject(BillingService);
  private visualSearchService = inject(VisualSearchService);

  @Output() loginClick = new EventEmitter<void>();
  @ViewChild('searchInputEl') searchInputEl?: ElementRef<HTMLInputElement>;

  public showProfilePopup = signal(false);

  // Left rail's expand/collapse state — remembered across visits. Wrapped in try/catch
  // since localStorage can throw (private browsing, storage disabled, quota).
  private navMenuKey = 'pinhub_nav_menu_open';
  public showNavMenu = signal(this.readNavMenuPref());
  // Hovering the capsule reveals the panel without needing a click; it collapses back
  // to whatever the click-toggled/persisted state was once the mouse leaves.
  public isHoveringNav = signal(false);

  public showNotifPopup = signal(false);
  public notifications = signal<AppNotification[]>([]);
  public unreadCount = signal(0);
  public notifLoading = signal(false);

  public toasts = signal<{ id: number; notification: AppNotification }[]>([]);
  private toastSeq = 0;
  private toastTimers = new Map<number, any>();

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
        void this.billing.refreshMe();
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

    // Keeps the search box showing the active query (e.g. "chó cute") whenever it's the
    // one driving /search — covers typing+submitting here, but also refinement tags on
    // the results page itself, which navigate straight to /search?q=... without going
    // through this component at all.
    this.syncSearchQueryFromUrl(this.router.url);
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncSearchQueryFromUrl(event.urlAfterRedirects);
      }
    });
  }

  private syncSearchQueryFromUrl(url: string) {
    const [path, queryString] = url.split('?');
    if (!path.startsWith('/search')) return;
    const params = new URLSearchParams(queryString || '');
    this.searchQuery.set(params.get('q') || '');
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
    this.showSearchDropdown.set(false);
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
    this.showSearchDropdown.set(false);
    this.showProfilePopup.update(val => !val);
  }

  isNavMenuVisible(): boolean {
    return this.showNavMenu() || this.isHoveringNav();
  }

  toggleNavMenu(event: MouseEvent) {
    event.stopPropagation();
    this.setNavMenu(!this.showNavMenu());
  }

  closeNavMenu() {
    this.setNavMenu(false);
  }

  private setNavMenu(open: boolean) {
    this.showNavMenu.set(open);
    try {
      localStorage.setItem(this.navMenuKey, open ? '1' : '0');
    } catch {
      // Storage unavailable (private browsing, disabled, quota) — state just won't persist.
    }
  }

  private readNavMenuPref(): boolean {
    try {
      return localStorage.getItem(this.navMenuKey) === '1';
    } catch {
      return false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.showNavMenu()) {
      this.closeNavMenu();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.showProfilePopup.set(false);
      this.showNotifPopup.set(false);
      if (this.showSearchDropdown()) {
        this.closeSearchDropdown();
      }
      if (this.showNavMenu()) {
        this.closeNavMenu();
      }
    }
  }

  // Clicking away without actually submitting a new search (e.g. after tapping the X to
  // clear, then changing your mind) reverts the box to whatever's really being viewed —
  // matches Pinterest, which treats an in-progress edit as provisional. Also used by the
  // dropdown's own backdrop, which otherwise closes it before document-click sees it.
  closeSearchDropdown() {
    this.showSearchDropdown.set(false);
    this.revertSearchQueryToCurrentRoute();
  }

  onVisualSearchClick(event: Event) {
    event.stopPropagation();
    this.showSearchDropdown.set(false);
    this.visualSearchService.open();
  }

  private revertSearchQueryToCurrentRoute() {
    const [path, queryString] = this.router.url.split('?');
    if (path.startsWith('/search')) {
      const params = new URLSearchParams(queryString || '');
      this.searchQuery.set(params.get('q') || '');
    } else {
      this.searchQuery.set('');
    }
  }

  onLoginClick() {
    this.loginClick.emit();
  }

  // Set of URLs that failed even after a retry — deliberately NOT written back into the
  // <img> src imperatively, so displayAvatarUrl (and therefore Angular's own binding)
  // stays the source of truth. That matters because a raw `img.src = fallback` write
  // permanently wedges the avatar on the placeholder with no way back: once Angular's
  // change detection sees a component-level failure signal instead, a later real avatar
  // change (new upload, dbUser resolving) naturally overrides it again on its own.
  private avatarLoadFailures = signal<ReadonlySet<string>>(new Set());
  private avatarRetried = new Set<string>();

  // A URL can fail to load once from a purely transient blip (flaky network, or in dev
  // a hot-reload tearing down the <img> mid-request) even though it's actually fine —
  // retry the exact same URL once (cache-busted, since an unchanged src won't re-fetch)
  // before treating it as truly broken.
  onAvatarError(event: Event) {
    const img = event.target as HTMLImageElement;
    const originalUrl = img.src.split('#__avatar_retry=')[0];
    if (!this.avatarRetried.has(originalUrl)) {
      this.avatarRetried.add(originalUrl);
      img.src = `${originalUrl}#__avatar_retry=${Date.now()}`;
      return;
    }
    this.avatarLoadFailures.update((prev) => new Set(prev).add(originalUrl));
  }

  // dbUser().avatarUrl reflects avatars uploaded in Settings; Supabase's own
  // user_metadata only ever holds what the OAuth provider (Google) handed us at
  // sign-in. Prefer the DB copy so an in-app avatar change shows up here too,
  // instead of navbar staying stuck on the Google photo (or lack thereof).
  get displayAvatarUrl(): string {
    const placeholder = 'https://api.dicebear.com/7.x/bottts/svg';
    const primary =
      this.supabaseService.dbUser()?.avatarUrl ||
      this.supabaseService.user()?.user_metadata?.['avatar_url'] ||
      this.supabaseService.user()?.user_metadata?.['picture'] ||
      null;
    if (!primary || this.avatarLoadFailures().has(primary)) {
      return placeholder;
    }
    return primary;
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
  }

  navigateToChat() {
    this.router.navigate(['/chat']);
  }

  isChatPage(): boolean {
    return this.router.url.startsWith('/chat');
  }

  navigateToSettings() {
    this.showProfilePopup.set(false);
    this.router.navigate(['/settings']);
  }

  navigateToPro() {
    this.showProfilePopup.set(false);
    this.router.navigate(['/pro']);
  }

  navigateToWallet() {
    this.showProfilePopup.set(false);
    this.router.navigate(['/wallet']);
  }

  // Search suggestions dropdown — recent searches (real, stored locally), plus "for
  // you" and "popular" sections that both reuse the general pin pool (there's no real
  // personalization or search-analytics trending data to draw from), split into two
  // different slices so the two sections aren't just showing the same pins twice.
  public showSearchDropdown = signal(false);
  public recentSearches = signal<{ query: string; thumbnail: string | null }[]>([]);
  public ideaPins = signal<Pin[]>([]);
  public popularPins = signal<Pin[]>([]);
  // Live "as you type" suggestions, drawn from this same pool — Pinterest's real
  // autocomplete is backed by search-query analytics we don't have, so this
  // approximates it from what pin titles/usernames actually exist.
  public searchQuery = signal('');
  private suggestionPool = signal<Pin[]>([]);
  private readonly recentSearchesKey = 'pinhub_recent_searches';

  get titleSuggestions(): string[] {
    const q = normalizeForSearch(this.searchQuery().trim());
    if (!q) return [];
    const seen = new Set<string>();
    const results: string[] = [];
    for (const pin of this.suggestionPool()) {
      const title = pin.title?.trim();
      const normalizedTitle = normalizeForSearch(title);
      if (title && normalizedTitle.includes(q) && !seen.has(normalizedTitle)) {
        seen.add(normalizedTitle);
        results.push(title);
        if (results.length >= 8) break;
      }
    }
    return results;
  }

  // Backed by the real users/search API (searches every account, not just whoever
  // happens to have authored one of the sampled pins above) — debounced since it fires
  // on every keystroke. Same endpoint the "new message" compose search already uses.
  public userSuggestions = signal<PublicUserSummary[]>([]);
  private userSuggestionDebounce: ReturnType<typeof setTimeout> | null = null;

  private fetchUserSuggestions(q: string) {
    if (this.userSuggestionDebounce) clearTimeout(this.userSuggestionDebounce);
    if (!q) {
      this.userSuggestions.set([]);
      return;
    }
    this.userSuggestionDebounce = setTimeout(async () => {
      try {
        const token = await this.supabaseService.getSessionToken();
        if (!token) return;
        const users = await this.chatService.searchUsers(q, token);
        // The query may have changed while this was in flight — don't clobber newer results.
        if (this.searchQuery().trim() === q) {
          this.userSuggestions.set(users.slice(0, 4));
        }
      } catch (error) {
        console.error('Error fetching user suggestions:', error);
      }
    }, 250);
  }

  private loadRecentSearches() {
    try {
      const raw = localStorage.getItem(this.recentSearchesKey);
      this.recentSearches.set(raw ? JSON.parse(raw) : []);
    } catch {
      this.recentSearches.set([]);
    }
  }

  // Prefers a matching person's avatar over a pin thumbnail — searching a name should
  // show that person's face in "Tìm kiếm gần đây", not a random pin that happens to
  // mention them.
  private saveRecentSearch(query: string, avatarUrl?: string | null) {
    if (!query) return;
    const matchedUser = this.userSuggestions().find((u) => u.username.toLowerCase() === query.toLowerCase());
    const thumbnail =
      avatarUrl ??
      matchedUser?.avatarUrl ??
      [...this.ideaPins(), ...this.popularPins()].find((p) => p.title?.toLowerCase().includes(query.toLowerCase()))
        ?.imageUrl ??
      null;
    const existing = this.recentSearches().filter((s) => s.query.toLowerCase() !== query.toLowerCase());
    const updated = [{ query, thumbnail }, ...existing].slice(0, 8);
    this.recentSearches.set(updated);
    localStorage.setItem(this.recentSearchesKey, JSON.stringify(updated));
  }

  removeRecentSearch(query: string, event: Event) {
    event.stopPropagation();
    const updated = this.recentSearches().filter((s) => s.query !== query);
    this.recentSearches.set(updated);
    localStorage.setItem(this.recentSearchesKey, JSON.stringify(updated));
  }

  async onSearchFocus() {
    this.showNotifPopup.set(false);
    this.showProfilePopup.set(false);
    this.showSearchDropdown.set(true);
    this.loadRecentSearches();
    if (this.suggestionPool().length === 0) {
      try {
        const pins = await this.pinService.getPins(1, 100);
        this.suggestionPool.set(pins);
        const half = Math.ceil(Math.min(pins.length, 16) / 2);
        this.ideaPins.set(pins.slice(0, half));
        this.popularPins.set(pins.slice(half, half * 2));
      } catch (error) {
        console.error('Error fetching pins for search dropdown:', error);
      }
    }
  }

  onSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
    this.fetchUserSuggestions(input.value.trim());
  }

  clearSearchInput(event: Event) {
    event.stopPropagation();
    this.searchQuery.set('');
    this.userSuggestions.set([]);
    this.onSearchFocus();
    this.searchInputEl?.nativeElement.focus();
  }

  goToSearch(query: string) {
    this.showSearchDropdown.set(false);
    this.searchQuery.set(query);
    this.userSuggestions.set([]);
    this.saveRecentSearch(query);
    this.router.navigate(['/search'], { queryParams: query ? { q: query } : {} });
  }

  goToUserProfile(user: PublicUserSummary) {
    this.showSearchDropdown.set(false);
    this.searchQuery.set('');
    this.saveRecentSearch(user.username, user.avatarUrl);
    this.userSuggestions.set([]);
    this.router.navigate(['/profile', user.username]);
  }

  onSearchSubmit(event: Event) {
    const input = event.target as HTMLInputElement;
    this.goToSearch(input.value.trim());
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

  isNotificationsPage(): boolean {
    return this.router.url.startsWith('/notifications');
  }

  isCollagePage(): boolean {
    return this.router.url.startsWith('/collage');
  }
}
