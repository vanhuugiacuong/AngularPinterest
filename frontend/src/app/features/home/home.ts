import { Component, OnInit, AfterViewInit, OnDestroy, inject, signal, computed, effect, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { BoardService, Board } from '../../core/services/board';
import { UserService, ProfilePin } from '../../core/services/user';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';

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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, Navbar, UserAvatar],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home implements OnInit, AfterViewInit, OnDestroy {
  private pinService = inject(PinService);
  private supabaseService = inject(SupabaseService);
  private boardService = inject(BoardService);
  private userService = inject(UserService);
  private router = inject(Router);

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef;

  public pins = signal<any[]>([]);
  public boards = signal<Board[]>([]);
  public activeDropdownPinId = signal<string | null>(null);
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

  /** Real display name sourced from the backend-synced profile (falls back to
   * OAuth metadata briefly while that sync is in flight) — same resolution
   * order as Navbar.displayName(). Empty string renders no greeting. */
  public displayName = computed(() => {
    const dbName = this.supabaseService.dbUser()?.username;
    if (dbName) return dbName;
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
  }

  /** Categories actually present in the currently loaded feed — never a
   * fixed/fake list, and hidden entirely while a search is active. */
  public categoryChips = computed(() => {
    const seen = new Map<string, number>();
    for (const pin of this.pins()) {
      if (!pin.category) continue;
      seen.set(pin.category, (seen.get(pin.category) || 0) + 1);
    }
    return Array.from(seen.keys())
      .sort((a, b) => (seen.get(b) || 0) - (seen.get(a) || 0))
      .map((code) => ({ code, label: CATEGORY_LABELS[code] || code }));
  });

  public filteredPins = computed(() => {
    const category = this.activeCategory();
    const list = this.pins();
    if (!category) return list;
    return list.filter((p) => p.category === category);
  });

  async ngOnInit() {
    this.updateNumColumns();
    await this.loadPins();
    await this.loadBoards();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateNumColumns();
  }

  updateNumColumns() {
    const width = window.innerWidth;
    if (width >= 1536) {
      this.numColumns.set(6);
    } else if (width >= 1280) {
      this.numColumns.set(5);
    } else if (width >= 768) {
      this.numColumns.set(4);
    } else if (width >= 640) {
      this.numColumns.set(3);
    } else {
      this.numColumns.set(2);
    }
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
  }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (
        entry.isIntersecting &&
        !this.isLoading() &&
        !this.isScrollingLoad() &&
        !this.searchQuery() &&
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

  async loadPins() {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.currentPage = 1;
    this.hasMore = true;
    try {
      const token = await this.supabaseService.getSessionToken() || undefined;
      const apiPins = await this.pinService.getPins(this.currentPage, this.limit, token, this.feedSeed);
      const mapped = this.mapPins(apiPins || []);
      this.pins.set(mapped);
      this.activeCategory.set(null);
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
      const apiPins = await this.pinService.getPins(this.currentPage, this.limit, token, this.feedSeed);
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
   * clears search mode and restores the normal ranked feed. */
  async onSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      if (this.searchQuery() !== null) {
        this.searchQuery.set(null);
        await this.loadPins();
      }
      return;
    }

    this.searchQuery.set(trimmed);
    this.activeCategory.set(null);
    this.isLoading.set(true);
    this.loadError.set(null);
    try {
      const results = await this.pinService.searchPins(trimmed);
      this.pins.set(this.mapPins(results || []));
      this.hasMore = false;
    } catch (error) {
      console.error('Error searching pins:', error);
      this.pins.set([]);
      this.hasMore = false;
      this.loadError.set('Không thể tìm kiếm lúc này. Vui lòng thử lại.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async clearSearch() {
    this.searchQuery.set(null);
    await this.loadPins();
  }

  setActiveCategory(code: string | null) {
    this.activeCategory.set(this.activeCategory() === code ? null : code);
  }

  retryLoad() {
    const q = this.searchQuery();
    if (q) {
      void this.onSearch(q);
    } else {
      void this.loadPins();
    }
  }

  private mapPins(apiPins: any[]): any[] {
    return apiPins.map(p => {
      const author = p.user?.username || 'NovaFrame AI';
      const likes = (p as any)._count?.likes ?? 0;

      let idHash = 0;
      for (let i = 0; i < p.id.length; i++) {
        idHash += p.id.charCodeAt(i);
      }
      const hasBottomBar = (idHash % 10) < 6;

      const ratios = [0.65, 0.7, 0.75, 0.8, 1.0, 1.2];
      const aspectRatio = ratios[idHash % ratios.length];

      return {
        id: p.id,
        title: p.title,
        image: p.imageUrl,
        hasBottomBar,
        author,
        authorAvatarUrl: p.user?.avatarUrl || null,
        likes,
        isAiGenerated: p.isAiGenerated,
        category: p.category,
        aspectRatio
      };
    });
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

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

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const result = await this.pinService.toggleLike(pin.id, token);
        console.log('Toggle like result:', result);
        if (result.liked) {
          pin.likes = (pin.likes || 0) + 1;
        } else {
          if (pin.likes !== undefined) {
            pin.likes = Math.max(0, pin.likes - 1);
          }
        }
        // Force Signal updates on template
        this.pins.update(current => [...current]);
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  toggleBoardDropdown(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    if (this.activeDropdownPinId() === pinId) {
      this.activeDropdownPinId.set(null);
    } else {
      this.activeDropdownPinId.set(pinId);
    }
  }

  selectBoardForPin(pinId: string, board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.selectedBoardMap.update(current => ({
      ...current,
      [pinId]: board
    }));
    this.activeDropdownPinId.set(null);
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
    return 'Hồ sơ';
  }

  async savePinToBoard(pinId: string, event: MouseEvent) {
    event.stopPropagation();
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
          'Hồ sơ',
          'Bộ sưu tập lưu mặc định',
          false,
          token
        );
        this.boards.update(current => [newBoard, ...current]);
        boardId = newBoard.id;
      }

      await this.boardService.addPinToBoard(boardId, pinId, token);
      alert('Đã lưu ảnh vào bộ sưu tập thành công!');
    } catch (error) {
      console.error('Error saving pin to board:', error);
      alert('Lỗi khi lưu ảnh vào bộ sưu tập.');
    }
  }
}
