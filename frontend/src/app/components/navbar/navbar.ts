import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
  computed,
  ElementRef,
  HostListener,
  Output,
  EventEmitter,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, Subject, Subscription, combineLatest, from, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { SupabaseService } from '../../core/services/supabase';
import { SidebarStateService } from '../../core/services/sidebar-state';
import { ThemeService } from '../../core/services/theme';
import { PinService, Pin } from '../../core/services/pin';
import { UserService, UserSearchResult } from '../../core/services/user';
import { MembershipService } from '../../core/services/membership';
import { NotificationService } from '../../core/services/notification';
import { MessagingService } from '../../core/services/messaging';
import type { MembershipPlan } from '../../core/models/membership-plan';
import { SearchHistoryService } from '../../core/services/search-history';
import { Sidebar } from '../sidebar/sidebar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { ImageSearchModal } from '../image-search-modal/image-search-modal';
import { ThemeToggle } from '../../shared/theme-toggle/theme-toggle';
import { BadgeBumpDirective } from '../../shared/badge-bump.directive';

type SuggestionItem =
  | { kind: 'recent'; term: string }
  | { kind: 'keyword'; term: string }
  | { kind: 'pin'; pin: Pin }
  | { kind: 'user'; user: UserSearchResult };

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule, Sidebar, UserAvatar, ImageSearchModal, ThemeToggle, BadgeBumpDirective],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css'
})
export class Navbar implements OnInit, OnDestroy {
  public supabaseService = inject(SupabaseService);
  public sidebarState = inject(SidebarStateService);
  public themeService = inject(ThemeService);
  private router = inject(Router);
  private elementRef = inject(ElementRef);
  private pinService = inject(PinService);
  private userService = inject(UserService);
  private searchHistory = inject(SearchHistoryService);
  private membership = inject(MembershipService);
  private notificationService = inject(NotificationService);
  private messagingService = inject(MessagingService);

  /** Total unread (notifications + messages) — badged on the hamburger so
   * it's visible even while the sidebar/notification drawer is collapsed. */
  public totalUnread$: Observable<number> = combineLatest([
    this.notificationService.unreadCount$,
    this.messagingService.unreadCount$,
  ]).pipe(map(([notifications, messages]) => notifications + messages));

  @Output() loginClick = new EventEmitter<void>();
  /** Emits the trimmed query on Enter / clear. Pages that care (e.g. /feed)
   * bind to it; pages that don't simply leave it unheard. */
  @Output() search = new EventEmitter<string>();

  @ViewChild('sidebarTrigger') sidebarTrigger?: ElementRef<HTMLButtonElement>;

  public showProfilePopup = signal(false);
  public searchQuery = signal('');

  public showSearchDropdown = signal(false);
  public showImageSearchModal = signal(false);

  public isSuggesting = signal(false);
  public suggestError = signal<string | null>(null);
  public suggestPins = signal<Pin[]>([]);
  public suggestUsers = signal<UserSearchResult[]>([]);
  public activeSuggestionIndex = signal<number>(-1);

  /** Recent keyword searches (localStorage-backed — see SearchHistoryService). */
  public recentSearches = this.searchHistory.recentSearches;

  public suggestKeywords = computed(() => {
    const titles = new Set<string>();
    for (const p of this.suggestPins()) {
      const title = (p.title || '').trim();
      if (title) titles.add(title);
    }
    return Array.from(titles).slice(0, 5);
  });

  /** How many pin thumbnails the dropdown actually renders (slice(0, 6)) —
   * shared by the template so the account rows' keyboard-highlight offset
   * stays in sync with flatSuggestions() instead of a hardcoded number. */
  public pinsSuggestionCount = computed(() => Math.min(this.suggestPins().length, 6));

  /** Flattened, orderable list backing keyboard navigation (arrow keys +
   * Enter) — same items rendered in the dropdown template, just linearized. */
  public flatSuggestions = computed<SuggestionItem[]>(() => {
    const query = this.searchQuery().trim();
    if (!query) {
      return this.recentSearches().map((term) => ({ kind: 'recent' as const, term }));
    }
    const items: SuggestionItem[] = [];
    for (const term of this.suggestKeywords()) items.push({ kind: 'keyword', term });
    for (const pin of this.suggestPins().slice(0, 6)) items.push({ kind: 'pin', pin });
    for (const user of this.suggestUsers()) items.push({ kind: 'user', user });
    return items;
  });

  private searchInput$ = new Subject<string>();
  private searchSub?: Subscription;

  ngOnInit(): void {
    // Loaded once per session (this is the only place that calls it besides
    // the pricing page) so every avatar that needs the viewer's own plan
    // reads the same cached signal instead of each issuing its own request.
    if (!this.membership.status()) {
      this.membership.load().catch(() => {
        // Ignore — myPlan() falls back to the last-synced plan on dbUser,
        // so a failed membership fetch never shows a wrong frame.
      });
    }

    this.searchSub = this.searchInput$
      .pipe(
        map((value) => value.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          // Typing only ever refreshes the dropdown's own suggestions — it
          // must never navigate or reload /feed. Only Enter (onEnterKey) or
          // picking a suggestion (selectSuggestion) does that, via
          // navigateToResults().
          if (!query) {
            return of({ pins: [] as Pin[], users: [] as UserSearchResult[], failed: false });
          }

          this.isSuggesting.set(true);
          this.suggestError.set(null);
          return from(
            Promise.allSettled([
              this.pinService.searchPins(query, 1, 6),
              this.userService.searchUsers(query, 5),
            ]),
          ).pipe(
            map(([pinsResult, usersResult]) => ({
              pins: pinsResult.status === 'fulfilled' ? pinsResult.value : [],
              users: usersResult.status === 'fulfilled' ? usersResult.value : [],
              failed: pinsResult.status === 'rejected' && usersResult.status === 'rejected',
            })),
          );
        }),
      )
      .subscribe(({ pins, users, failed }) => {
        this.suggestPins.set(pins);
        this.suggestUsers.set(users);
        this.isSuggesting.set(false);
        this.activeSuggestionIndex.set(-1);
        this.suggestError.set(failed ? 'Không thể tải gợi ý lúc này.' : null);
      });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  /** Best available avatar URL: synced DB profile picture first (persists
   * across providers/sessions), then the raw OAuth metadata as a fallback
   * for the brief window before the backend sync completes. */
  avatarUrl(): string | null {
    const dbAvatar = this.supabaseService.dbUser()?.avatarUrl;
    if (dbAvatar) return dbAvatar;
    const user = this.supabaseService.user();
    return user?.user_metadata?.['avatar_url'] || user?.user_metadata?.['picture'] || null;
  }

  /** The signed-in viewer's own active plan, driving their navbar/account-
   * popup avatar frame. Prefers the live MembershipService signal (kept
   * current after subscribe()/webhook-driven changes); falls back to the
   * plan already carried on dbUser from the last /api/users/sync while
   * membership.status() hasn't loaded yet or failed to load — never FREE by
   * default, since that would flash a real Plus/Pro member down to no frame. */
  myPlan(): MembershipPlan | null | undefined {
    return this.membership.status()?.plan ?? this.supabaseService.dbUser()?.plan;
  }

  displayName(): string {
    const dbUser = this.supabaseService.dbUser();
    if (dbUser) return dbUser.displayName || dbUser.username;
    const user = this.supabaseService.user();
    if (!user) return '';
    return (
      user.user_metadata?.['full_name'] ||
      user.user_metadata?.['name'] ||
      user.email?.split('@')[0] ||
      ''
    );
  }

  onSearchInput(value: string) {
    this.searchQuery.set(value);
    this.showSearchDropdown.set(true);
    this.searchInput$.next(value);
  }

  onSearchFocus() {
    this.showProfilePopup.set(false);
    this.showSearchDropdown.set(true);
  }

  submitSearch() {
    const value = this.searchQuery().trim();
    if (!value) return;
    this.navigateToResults(value);
  }

  clearSearch() {
    this.searchQuery.set('');
    this.searchInput$.next('');
    this.search.emit('');
    this.showSearchDropdown.set(false);
    if (this.router.url.startsWith('/feed')) {
      this.router.navigate(['/feed'], {
        queryParams: { q: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  onArrowDown(event: Event) {
    const list = this.flatSuggestions();
    if (list.length === 0) return;
    event.preventDefault();
    this.showSearchDropdown.set(true);
    this.activeSuggestionIndex.update((i) => Math.min(i + 1, list.length - 1));
  }

  onArrowUp(event: Event) {
    const list = this.flatSuggestions();
    if (list.length === 0) return;
    event.preventDefault();
    this.activeSuggestionIndex.update((i) => Math.max(i - 1, -1));
  }

  onEnterKey() {
    const list = this.flatSuggestions();
    const idx = this.activeSuggestionIndex();
    if (idx >= 0 && idx < list.length) {
      this.selectSuggestion(list[idx]);
    } else {
      this.submitSearch();
    }
  }

  selectSuggestion(item: SuggestionItem) {
    switch (item.kind) {
      case 'recent':
      case 'keyword':
        this.searchQuery.set(item.term);
        this.navigateToResults(item.term);
        break;
      case 'pin':
        this.showSearchDropdown.set(false);
        this.router.navigate(['/pin', item.pin.id]);
        break;
      case 'user':
        this.showSearchDropdown.set(false);
        this.router.navigate(['/profile', item.user.username]);
        break;
    }
  }

  removeRecentSearch(term: string, event: MouseEvent) {
    event.stopPropagation();
    this.searchHistory.remove(term);
  }

  private navigateToResults(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    this.searchHistory.add(trimmed);
    this.showSearchDropdown.set(false);
    this.activeSuggestionIndex.set(-1);
    this.search.emit(trimmed);
    this.router.navigate(['/feed'], { queryParams: { q: trimmed } });
  }

  openImageSearch() {
    this.showSearchDropdown.set(false);
    this.showImageSearchModal.set(true);
  }

  closeImageSearchModal() {
    this.showImageSearchModal.set(false);
  }

  onImageSearched() {
    this.showImageSearchModal.set(false);
    this.searchQuery.set('');
    this.router.navigate(['/feed'], { queryParams: { mode: 'image' } });
  }

  toggleProfilePopup(event: MouseEvent) {
    event.stopPropagation();
    this.showSearchDropdown.set(false);
    this.showProfilePopup.update(val => !val);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.showProfilePopup.set(false);
      this.showSearchDropdown.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.showSearchDropdown()) {
      this.showSearchDropdown.set(false);
      return;
    }
    if (this.sidebarState.isOpen()) {
      this.sidebarState.close();
      this.sidebarTrigger?.nativeElement.focus();
    }
  }

  onSidebarTriggerEnter() {
    this.sidebarState.cancelClose();
    this.sidebarState.openSidebar();
  }

  onSidebarTriggerLeave() {
    this.sidebarState.scheduleClose();
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

  navigateToMyProfile() {
    const dbUser = this.supabaseService.dbUser();
    if (dbUser && dbUser.username) {
      this.router.navigate(['/profile', dbUser.username]);
    } else {
      const user = this.supabaseService.user();
      if (user) {
        const email = user.email || '';
        const username = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || email.split('@')[0];
        this.router.navigate(['/profile', username]);
      }
    }
    this.showProfilePopup.set(false);
  }

  navigateToCreate() {
    this.router.navigate(['/create']);
  }
  navigateToPricing() { this.showProfilePopup.set(false); this.router.navigate(['/pricing']); }

  navigateToSettings() {
    this.showProfilePopup.set(false);
    this.router.navigate(['/settings']);
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
}
