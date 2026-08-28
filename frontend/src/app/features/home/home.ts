import { Component, OnInit, AfterViewInit, OnDestroy, inject, signal, computed, effect, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { BoardService, Board } from '../../core/services/board';
import { UserService, ProfilePin } from '../../core/services/user';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { LikeButton } from '../../shared/like-button/like-button';
import { ImageSearchStore } from '../../core/services/image-search-store';
import { ToastService } from '../../core/services/toast';
import { MembershipService } from '../../core/services/membership';
import { DialogService } from '../../core/services/dialog';
import { formatVnd } from '../../core/utils/currency';
import { formatNovaToken, vndToNovaToken } from '../../core/utils/novatoken';
import { masonryColumnCount, masonryContentWidth } from '../../core/utils/masonry';
import { showsCardByline, showsCardTitle } from '../../core/utils/card-caption';

/** Vietnamese labels for the category codes the backend's auto-classifier
 * assigns (see PinsService.classifyCategory) — chips are only ever built
 * from categories actually present in the loaded feed, never a fixed list. */
const CATEGORY_LABELS: Record<string, string> = {
  meme: 'Meme & Thú cưng',
  kpop: 'K-Pop & Idol',
  drawing: 'Hội họa',
  anime: 'Anime & Cyberpunk',
  nature: 'Thiên nhiên',
  food: 'Ẩm thực',
  fashion: 'Thời trang',
  other: 'Khác',
};

/** Tỉ lệ tạm dùng cho khung ảnh trước khi đo được tỉ lệ thật. Backend không
 * lưu kích thước ảnh nên tỉ lệ chỉ biết sau khi ảnh tải xong; 0.75 là dáng dọc
 * phổ biến nhất, giúp lưới ít nhảy nhất khi tỉ lệ thật được áp vào. */
const PLACEHOLDER_RATIO = 0.75;

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, Navbar, UserAvatar, LikeButton],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home implements OnInit, AfterViewInit, OnDestroy {
  private pinService = inject(PinService);
  private supabaseService = inject(SupabaseService);
  private boardService = inject(BoardService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private imageSearchStore = inject(ImageSearchStore);
  public membership = inject(MembershipService);
  private dialogService = inject(DialogService);

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef;

  public pins = signal<any[]>([]);
  public boards = signal<Board[]>([]);
  public activeDropdownPinId = signal<string | null>(null);
  /** Screen position of the currently-open board dropdown's trigger button.
   * The dropdown itself renders as a `position: fixed` portal outside the
   * pin card's `overflow-hidden` frame (see home.html) instead of as an
   * absolutely-positioned descendant of it — otherwise a dropdown taller
   * than the remaining space above its anchor gets silently clipped by the
   * card's own rounded-corner mask. */
  public dropdownAnchor = signal<{ top: number; left: number } | null>(null);
  public readonly activeDropdownPin = computed(() => {
    const id = this.activeDropdownPinId();
    if (!id) return null;
    return this.filteredPins().find((pin) => pin.id === id) ?? null;
  });
  public selectedBoardMap = signal<Record<string, Board>>({});
  public isLoading = signal<boolean>(true);
  public isScrollingLoad = signal<boolean>(false);
  public loadError = signal<string | null>(null);
  public numColumns = signal<number>(4);

  /** Non-null while the user has an active search query (from the navbar
   * search bar). Search results replace the feed and disable infinite
   * scroll / category filtering, matching the backend's non-paginated
   * `/api/pins/search` contract. */
  public searchQuery = signal<string | null>(null);

  /** True while the active search is a reverse-image search (results read
   * from ImageSearchStore instead of PinService.searchPins). */
  public isImageSearch = signal<boolean>(false);
  public imageSearchPreviewUrl = computed(() => this.imageSearchStore.previewUrl());

  public activeCategory = signal<string | null>(null);

  /** "Tiếp tục sáng tạo" — the logged-in user's own most recent pins, reusing
   * the same UserService.getUserPosts endpoint Profile already calls. Loads
   * independently of the main feed and never blocks it. */
  public recentCreations = signal<ProfilePin[]>([]);
  public isRecentLoading = signal<boolean>(false);
  public recentCreationsLoaded = signal<boolean>(false);

  private currentPage = 1;
  private limit = 20;
  private hasMore = true;
  private observer?: IntersectionObserver;
  private feedSeed = Math.random().toString(36).substring(2, 15);
  private queryParamsSub?: Subscription;
  /** Guards against a slow, now-stale search response overwriting a newer
   * one (e.g. fast typing while the results page is live-updating). */
  private searchRequestId = 0;

  /** The viewer's own unique username — the URL-safe identifier, distinct
   * from displayName() below (free-text, not routable). Only ever use this
   * one for navigation (e.g. `navigateToProfile`). */
  public myUsername = computed(() => this.supabaseService.dbUser()?.username || '');

  /** Real display name sourced from the backend-synced profile (falls back to
   * OAuth metadata briefly while that sync is in flight) — same resolution
   * order as Navbar.displayName(). Empty string renders no greeting. Display
   * text only — never pass this to navigateToProfile(), it is not a valid
   * username once the person has set a custom display name. */
  public displayName = computed(() => {
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
  });

  constructor() {
    // dbUser syncs asynchronously after sign-in (see SupabaseService), so this
    // reacts once it becomes available instead of racing it in ngOnInit.
    effect(() => {
      const dbUser = this.supabaseService.dbUser();
      if (dbUser?.username && !this.recentCreationsLoaded() && !this.isRecentLoading()) {
        void this.loadRecentCreations(dbUser.username);
      } else if (!dbUser && this.recentCreationsLoaded()) {
        this.recentCreations.set([]);
        this.recentCreationsLoaded.set(false);
      }
    });

    // Mirrors ImageSearchStore reactively (not just once on navigation) so
    // uploading a second image while already on the results page updates
    // this view too, even when the URL (/feed?mode=image) doesn't change.
    effect(() => {
      if (!this.isImageSearch()) return;
      const loading = this.imageSearchStore.isLoading();
      const error = this.imageSearchStore.error();
      const results = this.imageSearchStore.results();
      this.isLoading.set(loading);
      this.loadError.set(error);
      this.pins.set(this.mapPins(results || []));
      this.hasMore = false;
    });
  }

  /** Danh mục có thật trong feed, lấy từ `GET /api/pins/categories` (đếm trên
   * toàn bộ feed người xem thấy được), KHÔNG suy ra từ các pin đã tải: suy ra
   * từ pin đã tải thì chip bật/tắt giữa lúc cuộn, và danh mục nằm ở trang chưa
   * tải sẽ không bao giờ chọn tới được. */
  private feedCategories = signal<{ code: string; count: number }[]>([]);

  public categoryChips = computed(() =>
    this.feedCategories().map(({ code, count }) => ({
      code,
      count,
      label: CATEGORY_LABELS[code] || code,
    })),
  );

  /** Chip lọc chỉ có nghĩa khi có từ 2 danh mục trở lên — một danh mục duy nhất
   * thì "Tất cả" và chip đó trả về đúng cùng một tập, hàng chip chiếm chỗ mà
   * không phân loại được gì. */
  public readonly showCategoryChips = computed(() => this.categoryChips().length >= 2);

  /** Server đã lọc theo `activeCategory` nên `pins()` vốn đã là tập đúng. Giữ
   * tên này vì template và nhiều helper đang dùng. */
  public filteredPins = computed(() => this.pins());

  /** True while either a text search or a reverse-image search is active —
   * gates the feed-only UI (greeting, recent creations, category chips)
   * that only makes sense outside of search mode. */
  public isSearchActive = computed(() => this.searchQuery() !== null || this.isImageSearch());

  async ngOnInit() {
    this.updateNumColumns();
    void this.loadBoards();
    void this.loadFeedCategories();

    // Query params are the single source of truth for search mode — reached
    // via a direct link (/feed?q=...) or the navbar's Enter/suggestion-click
    // navigation (see Navbar.navigateToResults). Typing alone never lands
    // here; it only refreshes the navbar's own dropdown.
    this.queryParamsSub = this.route.queryParamMap.subscribe((params) => {
      const mode = params.get('mode');
      const q = (params.get('q') || '').trim();

      if (mode === 'image') {
        this.applyImageSearchResults();
        return;
      }

      if (q) {
        void this.onSearch(q);
      } else {
        if (this.isSearchActive()) {
          this.searchQuery.set(null);
          this.isImageSearch.set(false);
        }
        void this.loadPins();
      }
    });
  }

  @HostListener('window:resize')
  onResize() {
    this.updateNumColumns();
    this.closeBoardDropdown();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.activeDropdownPinId()) this.closeBoardDropdown();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.activeDropdownPinId()) this.closeBoardDropdown();
  }

  updateNumColumns() {
    if (typeof document === 'undefined') return;
    // clientWidth: đã trừ scrollbar, khác với innerWidth.
    const viewport = document.documentElement.clientWidth;
    // Khớp padding ngang của <main>: px-4 (32) / sm:px-6 (48) / lg:px-8 (64).
    const padding = viewport >= 1024 ? 64 : viewport >= 640 ? 48 : 32;
    this.numColumns.set(masonryColumnCount(masonryContentWidth(viewport, padding)));
  }

  getColumnsArray(): number[] {
    return Array.from({ length: this.numColumns() }, (_, i) => i);
  }

  getPinsForColumn(colIndex: number): any[] {
    return this.filteredPins().filter((_, index) => index % this.numColumns() === colIndex);
  }

  getSkeletonsForColumn(colIndex: number): number[] {
    const dummyArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return dummyArray.filter((_, index) => index % this.numColumns() === colIndex);
  }

  getScrollingSkeletonsForColumn(colIndex: number): number[] {
    const dummyArray = [1, 2, 3, 4, 5, 6];
    return dummyArray.filter((_, index) => index % this.numColumns() === colIndex);
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.queryParamsSub?.unsubscribe();
  }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (
        entry.isIntersecting &&
        !this.isLoading() &&
        !this.isScrollingLoad() &&
        !this.isSearchActive() &&
        this.hasMore
      ) {
        await this.loadMorePins();
      }
    }, {
      rootMargin: '200px',
    });

    if (this.scrollSentinel) {
      this.observer.observe(this.scrollSentinel.nativeElement);
    }
  }

  async loadRecentCreations(username: string) {
    this.isRecentLoading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken() || undefined;
      const page = await this.userService.getUserPosts(username, 1, 6, token);
      this.recentCreations.set(page.items || []);
    } catch (error) {
      console.error('Error loading recent creations:', error);
      this.recentCreations.set([]);
    } finally {
      this.isRecentLoading.set(false);
      this.recentCreationsLoaded.set(true);
    }
  }

  async loadBoards() {
    const currentUser = this.supabaseService.user();
    if (currentUser) {
      try {
        const token = await this.supabaseService.getSessionToken();
        if (token) {
          const list = await this.boardService.getBoards(token);
          this.boards.set(list);
        }
      } catch (error) {
        console.error('Error fetching user boards:', error);
      }
    }
  }

  /** `resetCategory` mặc định true để mọi lời gọi cũ (mở trang, thử lại, thoát
   * tìm kiếm) giữ nguyên hành vi đưa feed về "Tất cả"; setActiveCategory truyền
   * false để tải lại feed mà KHÔNG xoá chip vừa chọn. */
  async loadPins(resetCategory = true) {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.currentPage = 1;
    this.hasMore = true;
    if (resetCategory) this.activeCategory.set(null);
    try {
      const token = await this.supabaseService.getSessionToken() || undefined;
      const apiPins = await this.pinService.getPins(
        this.currentPage,
        this.limit,
        token,
        this.feedSeed,
        this.activeCategory(),
      );
      const mapped = this.mapPins(apiPins || []);
      this.pins.set(mapped);
      if (!apiPins || apiPins.length < this.limit) {
        this.hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching pins from backend:', error);
      this.pins.set([]);
      this.hasMore = false;
      this.loadError.set('Không thể tải Không gian khám phá. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMorePins() {
    if (this.isScrollingLoad() || !this.hasMore) return;
    this.isScrollingLoad.set(true);
    this.currentPage++;
    try {
      const token = await this.supabaseService.getSessionToken() || undefined;
      // Giữ filter khi nạp trang tiếp — thiếu tham số này thì trang sau trả về
      // pin của mọi danh mục và người dùng thấy lưới "lọc" lẫn ảnh không khớp.
      const apiPins = await this.pinService.getPins(
        this.currentPage,
        this.limit,
        token,
        this.feedSeed,
        this.activeCategory(),
      );
      if (apiPins && apiPins.length > 0) {
        const mapped = this.mapPins(apiPins);
        this.pins.update(current => {
          const existingIds = new Set(current.map(p => p.id));
          const uniqueNew = mapped.filter(p => !existingIds.has(p.id));
          return [...current, ...uniqueNew];
        });
        if (apiPins.length < this.limit) {
          this.hasMore = false;
        }
      } else {
        this.hasMore = false;
      }
    } catch (error) {
      console.error('Error loading more pins:', error);
      this.hasMore = false;
    } finally {
      this.isScrollingLoad.set(false);
    }
  }

  /** Runs a real search against the backend's CLIP/text search endpoint
   * (see PinService.searchPins / GET /api/pins/search). An empty query
   * clears search mode and restores the normal ranked feed. Reached both
   * from the navbar's (search) output and from the /feed?q= queryParamMap
   * subscription in ngOnInit — the equality check below makes a second,
   * redundant call for the same query a no-op instead of double-fetching. */
  async onSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      if (this.isSearchActive()) {
        this.searchQuery.set(null);
        this.isImageSearch.set(false);
        await this.loadPins();
      }
      return;
    }

    if (!this.isImageSearch() && trimmed === this.searchQuery()) {
      return;
    }

    this.searchQuery.set(trimmed);
    this.isImageSearch.set(false);
    this.activeCategory.set(null);
    this.isLoading.set(true);
    this.loadError.set(null);

    // Stamped so a slow, now-superseded response can't overwrite a faster,
    // newer one (e.g. two quick consecutive searches, or a stray duplicate
    // call from the (search) output firing alongside the queryParam sync).
    const requestId = ++this.searchRequestId;
    try {
      const results = await this.pinService.searchPins(trimmed);
      if (requestId !== this.searchRequestId) return;
      this.pins.set(this.mapPins(results || []));
      this.hasMore = false;
    } catch (error) {
      if (requestId !== this.searchRequestId) return;
      console.error('Error searching pins:', error);
      this.pins.set([]);
      this.hasMore = false;
      this.loadError.set('Không thể tìm kiếm lúc này. Vui lòng thử lại.');
    } finally {
      if (requestId === this.searchRequestId) {
        this.isLoading.set(false);
      }
    }
  }

  /** Reflects an already-completed reverse-image search (see
   * ImageSearchStore) into the feed view. The effect registered in the
   * constructor keeps pins/loading/error mirrored for as long as image mode
   * stays active, so this only needs to flip the mode flags. */
  private applyImageSearchResults() {
    this.searchRequestId++; // invalidate any in-flight text search
    this.searchQuery.set(null);
    this.activeCategory.set(null);
    this.isImageSearch.set(true);
  }

  async clearSearch() {
    this.searchQuery.set(null);
    this.isImageSearch.set(false);
    if (this.route.snapshot.queryParamMap.keys.length > 0) {
      this.router.navigate(['/feed']);
    }
    await this.loadPins();
  }

  /** Đổi chip = tải lại feed từ trang 1 với danh mục mới, vì việc lọc nằm ở
   * server. Bấm lại chip đang chọn thì bỏ lọc (về "Tất cả"). */
  setActiveCategory(code: string | null) {
    const next = this.activeCategory() === code ? null : code;
    if (next === this.activeCategory()) return;
    this.activeCategory.set(next);
    void this.loadPins(false);
  }

  /** Nạp danh mục cho hàng chip. Lỗi ở đây không được chặn feed — mất chip thì
   * chỉ là không lọc được, còn ảnh vẫn xem bình thường. */
  private async loadFeedCategories(): Promise<void> {
    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      this.feedCategories.set(await this.pinService.getFeedCategories(token));
    } catch (error) {
      console.error('Error fetching feed categories:', error);
      this.feedCategories.set([]);
    }
  }

  retryLoad() {
    if (this.isImageSearch()) {
      // No File is kept around after upload (see ImageSearchStore), so
      // there is nothing to resubmit — send the user back to the feed to
      // try another image via the camera button instead.
      void this.clearSearch();
      return;
    }
    const q = this.searchQuery();
    if (q) {
      void this.onSearch(q);
    } else {
      void this.loadPins();
    }
  }

  private mapPins(apiPins: any[]): any[] {
    return apiPins.map(p => ({
      id: p.id,
      title: p.title,
      image: p.imageUrl,
      author: p.user?.username || 'NovaFrame AI',
      authorAvatarUrl: p.user?.avatarUrl || null,
      authorPlan: p.user?.plan || 'FREE',
      authorIsAdmin: p.user?.isAdmin ?? false,
      likes: (p as any)._count?.likes ?? 0,
      isLiked: p.isLiked === true,
      isAiGenerated: p.isAiGenerated,
      category: p.category,
      /** Tỉ lệ thật, đo từ ảnh khi tải xong (onPinImageLoad) — backend chưa
       * lưu kích thước ảnh, nên null cho tới lúc đó và khung dùng tỉ lệ tạm
       * PLACEHOLDER_RATIO. Trước đây chỗ này bốc một tỉ lệ ngẫu nhiên từ hash
       * của id, nên mọi pin trong lưới đều hiển thị sai hình dạng. */
      aspectRatio: null as number | null,
      ownerId: p.userId,
      price: p.price ?? null,
      currency: p.currency ?? null,
      listingType: p.listingType ?? 'NONE',
      auction: p.auction ?? null,
    }));
  }

  /** Tỉ lệ tạm cho khung pin chưa đo được — template đọc trực tiếp. */
  public readonly placeholderRatio = PLACEHOLDER_RATIO;

  /** Ghi lại tỉ lệ thật của một pin ngay khi ảnh tải xong, để khung ảnh khớp
   * đúng hình dạng gốc thay vì bị cắt theo một tỉ lệ áp đặt. */
  onPinImageLoad(pin: { aspectRatio: number | null }, img: HTMLImageElement): void {
    if (pin.aspectRatio !== null) return;
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) return;
    pin.aspectRatio = w / h;
    // Cùng kiểu cập nhật như toggleLike: pin là object thường được mutate tại
    // chỗ, nên phải phát lại signal để template đọc lại.
    this.pins.update((current) => [...current]);
  }

  /** Text hiển thị trong badge vương miện — '' nếu pin không phải tác phẩm
   * có giá trị (template ẩn badge hoàn toàn trong trường hợp đó). */
  valueBadgeText(pin: any): string {
    if (pin.listingType === 'FIXED_PRICE') return formatNovaToken(vndToNovaToken(pin.price));
    if (pin.listingType === 'AUCTION' && pin.auction) {
      const a = pin.auction;
      if (a.status === 'SCHEDULED') return 'Sắp diễn ra';
      if (a.status === 'ENDED' || a.status === 'CANCELLED') return 'Đã kết thúc';
      return `Giá hiện tại · ${formatNovaToken(vndToNovaToken(a.currentPrice))}`;
    }
    return '';
  }

  valueBadgeAriaLabel(pin: any): string {
    if (pin.listingType === 'FIXED_PRICE') return `Tác phẩm bán giá cố định, giá ${formatNovaToken(vndToNovaToken(pin.price))}`;
    if (pin.listingType === 'AUCTION' && pin.auction) {
      const a = pin.auction;
      if (a.status === 'SCHEDULED') return 'Tác phẩm đấu giá, phiên sắp diễn ra';
      if (a.status === 'ENDED' || a.status === 'CANCELLED') return 'Tác phẩm đấu giá, phiên đã kết thúc';
      return `Tác phẩm đấu giá, giá hiện tại ${formatNovaToken(vndToNovaToken(a.currentPrice))}`;
    }
    return '';
  }

  /** Giá cố định yêu cầu Plus/Pro; đấu giá yêu cầu Pro.
   * Đây chỉ là lớp UX; backend (GET /api/pins/:id) là lớp chặn thật. */
  private requiresUpgradeToOpen(pin: any): boolean {
    if (pin.listingType !== 'AUCTION' && pin.listingType !== 'FIXED_PRICE') return false;
    const currentUserId = this.supabaseService.user()?.id;
    if (currentUserId && pin.ownerId && currentUserId === pin.ownerId) return false;
    // Navbar loads MembershipService asynchronously. During that short gap,
    // use the already-synced database user plan so a paid member is not shown
    // a false upgrade dialog just because they clicked quickly after routing.
    const plan = this.membership.status()?.plan ?? this.supabaseService.dbUser()?.plan;
    return pin.listingType === 'AUCTION'
      ? plan !== 'PRO'
      : plan !== 'PLUS' && plan !== 'PRO';
  }

  isAuctionRestricted(pin: any): boolean {
    return this.requiresUpgradeToOpen(pin);
  }

  private async showUpgradeDialog(pin: any): Promise<void> {
    const isAuction = pin.listingType === 'AUCTION';
    const goToPricing = await this.dialogService.confirm({
      variant: 'information',
      title: isAuction ? 'Cần gói Pro để xem đấu giá' : 'Khám phá tác phẩm cùng Plus',
      description: isAuction
        ? 'Ảnh và trang chi tiết của tác phẩm đấu giá chỉ dành cho thành viên Pro.'
        : 'Nâng cấp Plus hoặc Pro để xem rõ và mở chi tiết tác phẩm bán giá cố định.',
      confirmLabel: 'Xem các gói',
      cancelLabel: 'Để sau',
    });
    if (goToPricing) this.router.navigate(['/pricing']);
  }

  navigateToPin(pin: any) {
    if (this.requiresUpgradeToOpen(pin)) {
      void this.showUpgradeDialog(pin);
      return;
    }
    this.router.navigate(['/pin', pin.id]);
  }

  /** Uỷ quyền cho util dùng chung — xem card-caption.ts. Bọc lại ở đây để
   *  template gọi thẳng mà không phải nhập hàm vào lớp. */
  showsTitle = showsCardTitle;
  showsByline = showsCardByline;

  navigateToProfile(username: string | undefined | null, event: MouseEvent) {
    event.stopPropagation();
    if (!username) return;
    this.router.navigate(['/profile', username]);
  }

  navigateToCreate() {
    this.router.navigate(['/create']);
  }

  async toggleLike(pin: any, event: MouseEvent) {
    event.stopPropagation();
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    const previousLiked = pin.isLiked === true;
    const previousLikes = Number(pin.likes) || 0;
    pin.isLiked = !previousLiked;
    pin.likes = Math.max(0, previousLikes + (previousLiked ? -1 : 1));
    pin.likeQueuedToggles = (pin.likeQueuedToggles || 0) + 1;
    this.pins.update((current) => [...current]);

    await this.flushLikeQueue(pin);
  }

  private async flushLikeQueue(pin: any): Promise<void> {
    if (pin.likeSyncing) return;
    pin.likeSyncing = true;

    try {
      while ((pin.likeQueuedToggles || 0) > 0) {
        pin.likeQueuedToggles--;

        try {
          const token = await this.supabaseService.getSessionToken();
          if (!token) throw new Error('Không tìm thấy phiên đăng nhập.');

          const result = await this.pinService.toggleLike(pin.id, token);
          if (pin.likeQueuedToggles === 0) {
            pin.isLiked = result.liked;
            pin.likes = result.likeCount;
          }
        } catch (error) {
          const currentLiked = pin.isLiked === true;
          pin.isLiked = !currentLiked;
          pin.likes = Math.max(
            0,
            (Number(pin.likes) || 0) + (currentLiked ? -1 : 1),
          );
          console.error('Error toggling like:', error);
        }

        this.pins.update((current) => [...current]);
      }
    } finally {
      pin.likeSyncing = false;
      this.pins.update((current) => [...current]);
    }
  }

  toggleBoardDropdown(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    if (this.activeDropdownPinId() === pinId) {
      this.closeBoardDropdown();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const dropdownWidth = 176; // w-44
    this.dropdownAnchor.set({
      top: rect.top,
      left: Math.min(rect.left, window.innerWidth - dropdownWidth - 12),
    });
    this.activeDropdownPinId.set(pinId);
  }

  closeBoardDropdown(): void {
    this.activeDropdownPinId.set(null);
    this.dropdownAnchor.set(null);
  }

  selectBoardForPin(pinId: string, board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.selectedBoardMap.update(current => ({
      ...current,
      [pinId]: board
    }));
    this.closeBoardDropdown();
  }

  getSelectedBoardName(pinId: string): string {
    const selected = this.selectedBoardMap()[pinId];
    if (selected) {
      return selected.name;
    }
    const list = this.boards();
    if (list.length > 0) {
      return list[0].name;
    }
    return 'Lưu vào';
  }

  savePinToBoard(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    void this.performSaveToBoard(pinId);
  }

  private async performSaveToBoard(pinId: string): Promise<void> {
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = this.selectedBoardMap()[pinId]?.id;

      if (!boardId && this.boards().length > 0) {
        boardId = this.boards()[0].id;
      }

      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Bộ sưu tập của tôi',
          'Bộ sưu tập lưu mặc định',
          false,
          token
        );
        this.boards.update(current => [newBoard, ...current]);
        boardId = newBoard.id;
      }

      await this.boardService.addPinToBoard(boardId, pinId, token);
      this.toast.success('Đã lưu vào bộ sưu tập');
    } catch (error) {
      console.error('Error saving pin to board:', error);
      this.toast.error('Không thể lưu ảnh vào bộ sưu tập.', {
        action: { label: 'Thử lại', onClick: () => this.performSaveToBoard(pinId) },
      });
    }
  }
}
