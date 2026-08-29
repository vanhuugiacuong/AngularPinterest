import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { ProAvatar } from '../../shared/pro-avatar/pro-avatar';
import { PinService } from '../../core/services/pin';
import { PinCardActionsService } from '../../core/services/pin-card-actions';
import { ChatService, PublicUserSummary } from '../../core/services/chat';
import { SupabaseService } from '../../core/services/supabase';
import { VisualSearchService } from '../../core/services/visual-search';

/** Một nút trong thanh "Gợi ý bộ lọc". Bấm vào là thêm `label` vào câu tìm.
 *  `type` chỉ cho biết từ khoá đến từ đâu (danh mục hay khái niệm) — cả hai
 *  hành xử giống hệt nhau khi bấm. */
interface SearchTag {
  key: string;
  label: string;
  imageUrl: string | null;
  type: 'category' | 'concept';
}

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, Navbar, ProAvatar],
  templateUrl: './search.html',
  styleUrl: './search.css'
})
export class Search implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('scrollSentinel') scrollSentinel?: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pinService = inject(PinService);
  private chatService = inject(ChatService);
  private supabaseService = inject(SupabaseService);
  public visualSearchService = inject(VisualSearchService);

  public query = signal<string>('');
  public results = signal<any[]>([]);
  public userResults = signal<PublicUserSummary[]>([]);
  public isLoading = signal<boolean>(true);
  public refinementTags = signal<SearchTag[]>([]);
  public visualQueryPreviewUrl = signal<string | null>(null);

  /** Cuộn tới đâu tải tới đó. Trước đây trang này tải TOÀN BỘ thư viện trước
   *  khi vẽ được ô nào — 1.500+ ảnh qua 26 lượt gọi nối đuôi nhau, nên gõ xong
   *  chỉ thấy vòng xoay đứng im. Giờ mỗi lần một trang. */
  public isLoadingMore = signal<boolean>(false);
  public hasMore = signal<boolean>(true);
  private page = 1;
  private readonly pageSize = 30;
  /** Tăng mỗi lần đổi câu tìm, để kết quả của câu cũ về trễ thì bị bỏ qua. */
  private runId = 0;

  /** Câu tìm không ra gì -> vẫn hiện ảnh phổ biến thay vì một trang trắng,
   *  đúng cách Pinterest xử lý. Cờ này để tiêu đề nói rõ đây là gợi ý. */
  public isShowingFallback = signal<boolean>(false);

  /** Save/like live in a shared service — see PinCardActionsService for why
   * this page no longer carries its own copy. Public so the template can bind
   * straight to its signals. */
  public readonly cardActions = inject(PinCardActionsService);

  // When the user runs another image search while already on the results page,
  // the router sees the same /search?visual=1 URL and skips re-navigation, so
  // ngOnInit never re-runs. React to the service's results signal directly so a
  // repeat search still refreshes the page.
  private readonly visualResultsEffect = effect(() => {
    const results = this.visualSearchService.results();
    if (results !== null && this.route.snapshot.queryParamMap.get('visual') === '1') {
      this.showVisualSearchResults();
    }
  });

  private readonly pillPalette = [
    'bg-[#F9D9E7] dark:bg-[#3a2530]',
    'bg-[#D9E9F9] dark:bg-[#20303f]',
    'bg-[#DFF3D9] dark:bg-[#243422]',
    'bg-[#FBE7C6] dark:bg-[#3a3020]',
    'bg-[#E6D9F9] dark:bg-[#2e2440]',
    'bg-[#F9E0D9] dark:bg-[#3a2820]',
    'bg-[#D9F9F3] dark:bg-[#1f3a35]',
    'bg-[#F9F3D9] dark:bg-[#38371f]',
  ];

  pillColorClass(i: number): string {
    return this.pillPalette[i % this.pillPalette.length];
  }

  ngOnInit() {
    void this.cardActions.loadBoards();
    this.route.queryParamMap.subscribe(params => {
      const isVisualSearch = params.get('visual') === '1' && this.visualSearchService.results() !== null;
      if (isVisualSearch) {
        this.showVisualSearchResults();
        return;
      }
      this.visualQueryPreviewUrl.set(null);
      const q = params.get('q') || '';
      this.query.set(q);
      void this.runSearch(q);
    });
  }

  private showVisualSearchResults() {
    this.query.set('');
    this.visualQueryPreviewUrl.set(this.visualSearchService.lastQueryImageUrl());
    this.userResults.set([]);
    this.refinementTags.set([]);
    this.results.set(this.visualSearchService.results() || []);
    this.isShowingFallback.set(false);
    this.hasMore.set(false);
    this.isLoading.set(false);
  }

  /**
   * Gọi thẳng API tìm kiếm của máy chủ.
   *
   * BẢN TRƯỚC LÀM SAI CĂN BẢN: nó tải về TOÀN BỘ thư viện ảnh (phân trang 60
   * một, lặp tới khi hết — hơn 1.500 ảnh, hơn 20 lượt gọi nối đuôi) rồi mới lọc
   * bằng `includes()` ngay trên trình duyệt. Hậu quả:
   *   - Gõ xong ngồi nhìn vòng xoay rất lâu, câu không có kết quả thì xoay
   *     hết cả lượt tải mới biết là không có gì.
   *   - Vứt bỏ toàn bộ phần thông minh ở máy chủ: không bỏ dấu, không đồng
   *     nghĩa Việt–Anh, không ngữ nghĩa CLIP, không chịu lỗi gõ sai. Gõ "chó"
   *     không bao giờ ra ảnh tên "dog" dù máy chủ thừa sức trả về.
   *   - Khớp chuỗi con nên "gai" lọt cả "gãi".
   */
  async runSearch(q: string) {
    const run = ++this.runId;
    this.page = 1;
    this.hasMore.set(true);
    this.isShowingFallback.set(false);
    this.isLoading.set(true);

    try {
      const [pins] = await Promise.all([
        this.pinService.searchPins(q, 1, this.pageSize),
        this.loadMatchingUsers(q),
        this.loadFacets(q, run),
      ]);
      if (run !== this.runId) return; // câu tìm đã đổi, kết quả này lỗi thời

      if (pins.length === 0) {
        // Không có gì khớp -> vẫn cho xem ảnh phổ biến. Trang trắng trơn trông
        // như hệ thống hỏng, còn Pinterest thì luôn có ảnh để lướt tiếp.
        await this.loadFallback(run);
        return;
      }

      this.results.set(pins);
      this.hasMore.set(pins.length === this.pageSize);
      queueMicrotask(() => this.observeSentinel());
    } catch (error) {
      console.error('Error searching pins:', error);
      if (run === this.runId) {
        this.results.set([]);
        this.hasMore.set(false);
      }
    } finally {
      if (run === this.runId) this.isLoading.set(false);
    }
  }

  /** Tài khoản khớp câu tìm, hiện thành hàng avatar phía trên lưới ảnh. */
  private async loadMatchingUsers(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      this.userResults.set([]);
      return;
    }
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) {
        this.userResults.set([]);
        return;
      }
      this.userResults.set(await this.chatService.searchUsers(trimmed, token));
    } catch (error) {
      console.error('Error searching users:', error);
      this.userResults.set([]);
    }
  }

  /** Cuộn chạm đáy thì lấy thêm một trang. */
  async loadMore() {
    if (this.isLoading() || this.isLoadingMore() || !this.hasMore() || this.isShowingFallback()) return;
    const run = this.runId;
    this.isLoadingMore.set(true);
    try {
      const next = await this.pinService.searchPins(
        this.query(),
        this.page + 1,
        this.pageSize,
      );
      if (run !== this.runId) return;
      this.page++;
      // Máy chủ có thể trả lại ảnh đã thấy (nhánh ngữ nghĩa và nhánh khớp chữ
      // chồng nhau), lọc trùng theo id chứ đừng vẽ hai lần.
      const seen = new Set(this.results().map((p) => p.id));
      this.results.update((cur) => [...cur, ...next.filter((p: any) => !seen.has(p.id))]);
      this.hasMore.set(next.length === this.pageSize);
    } catch (error) {
      console.error('Error loading more results:', error);
      this.hasMore.set(false);
    } finally {
      this.isLoadingMore.set(false);
    }
  }

  private async loadFallback(run: number) {
    try {
      const popular = await this.pinService.getPins(1, this.pageSize);
      if (run !== this.runId) return;
      this.isShowingFallback.set(true);
      this.results.set(popular ?? []);
      this.hasMore.set(false);
    } catch {
      this.results.set([]);
      this.hasMore.set(false);
    }
  }

  /**
   * Gợi ý bộ lọc lấy từ máy chủ.
   *
   * Bản trước tự tách chữ từ tiêu đề ngay trên trình duyệt, nên gõ "code" thì
   * hiện "màn", "hình", "lập", "trình", "lucasacoustics" — mảnh vụn của một
   * câu, bấm vào không mở ra chủ đề nào. Máy chủ mới trả về danh mục thật của
   * ảnh cộng các khái niệm có chọn lọc, nên mỗi nút là một chủ đề tra được.
   */
  private async loadFacets(q: string, run: number) {
    if (!q.trim()) {
      this.refinementTags.set([]);
      return;
    }
    const facets = await this.pinService.searchFacets(q);
    if (run !== this.runId) return;
    // Danh mục lên trước: bấm vào là mở sang tập ảnh khác hẳn, đúng thứ người
    // dùng mong đợi nhất từ thanh này.
    this.refinementTags.set([...facets.categories, ...facets.concepts]);
  }

  /**
   * Bấm một nút gợi ý: THÊM TỪ KHOÁ vào câu tìm, đúng như Pinterest.
   *
   * Bản trước có hai kiểu nút — "danh mục" thì bật một bộ lọc riêng kèm chip
   * hồng, "khái niệm" thì nối chữ. Hai lối đi cho một hàng nút trông giống hệt
   * nhau là chỗ gây rối: bấm "Tranh vẽ" ra bộ lọc danh mục `drawing`, mà ảnh
   * màn hình code lại đang được xếp vào danh mục đó, nên nhìn như hệ thống
   * trả bừa. Giờ mọi nút làm CÙNG MỘT VIỆC và việc đó nhìn thấy được ngay
   * trên thanh tìm kiếm, nên bấm xong người dùng hiểu vì sao kết quả đổi.
   */
  applyTag(tag: SearchTag) {
    const current = this.query().trim();
    // Đã có sẵn trong câu tìm thì bấm lần nữa là GỠ ra, để còn đường lùi.
    const words = current.split(/\s+/).filter(Boolean);
    const idx = words.findIndex((w) => w.toLowerCase() === tag.label.toLowerCase());
    const next = idx >= 0 ? words.filter((_, i) => i !== idx).join(' ') : `${current} ${tag.label}`.trim();
    this.router.navigate(['/search'], { queryParams: next ? { q: next } : {} });
  }

  /** Từ khoá này đã nằm trong câu tìm chưa — để tô sáng nút tương ứng. */
  isTagActive(tag: SearchTag): boolean {
    return this.query()
      .trim()
      .split(/\s+/)
      .some((w) => w.toLowerCase() === tag.label.toLowerCase());
  }

  /**
   * Mốc cuộn nằm trong nhánh @else của template nên chỉ tồn tại khi ĐÃ có kết
   * quả — theo dõi lại mỗi lần nó xuất hiện, chứ gắn một lần lúc khởi tạo thì
   * lần tìm đầu tiên sẽ không bao giờ tải thêm được trang nào.
   */
  ngAfterViewInit() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void this.loadMore();
      },
      { rootMargin: '600px' }, // tải trước khi chạm đáy, đỡ khựng
    );
    this.observeSentinel();
  }

  private observeSentinel() {
    const el = this.scrollSentinel?.nativeElement;
    if (el && this.observer) this.observer.observe(el);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  navigateToUser(username: string) {
    this.router.navigate(['/profile', username]);
  }
}
