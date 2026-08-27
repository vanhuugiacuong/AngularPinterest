import { Component, OnInit, inject, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { BoardService, Board } from '../../core/services/board';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';
import { ReportService } from '../../core/services/report';
import { ChatService, ConversationSummary } from '../../core/services/chat';
import { BillingService } from '../../core/services/billing';
import { ImageCropper, CropBox } from '../../components/image-cropper/image-cropper';
import { ProAvatar } from '../../shared/pro-avatar/pro-avatar';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pin-detail',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule, ImageCropper, ProAvatar],
  templateUrl: './pin-detail.html',
  styleUrl: './pin-detail.css'
})
export class PinDetail implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private reportService = inject(ReportService);
  private chatService = inject(ChatService);
  public supabaseService = inject(SupabaseService);
  public billing = inject(BillingService);
  private elementRef = inject(ElementRef);

  public isBuying = signal<boolean>(false);
  public access = signal<{ isPremium: boolean; priceCredits: number | null; owned: boolean; purchased: boolean; canDownload: boolean } | null>(null);

  private async loadAccess(pinId: string) {
    this.access.set(null);
    const a = await this.billing.getPinAccess(pinId);
    if (a) this.access.set(a);
  }

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef;

  public pin = signal<any | null>(null);
  public relatedPins = signal<any[]>([]);
  public boards = signal<Board[]>([]);
  public showBoardDropdown = signal<boolean>(false);
  public selectedBoard = signal<Board | null>(null);
  public isLoading = signal<boolean>(true);
  public isRelatedLoading = signal<boolean>(true);

  /** Bật trong ~0.5s ngay sau khi bấm thích để chạy hiệu ứng nảy + vòng loang. */
  public likeBurst = signal<boolean>(false);
  /* Which pins this session has saved. There is no API that answers "is this pin
     already on one of my boards", so this is session-scoped by necessity: it
     fills the bookmark right after a save, and a reload returns the button to
     its unsaved look. Persisting it needs the backend to report saved state
     alongside the pin. */
  public savedPinIds = signal<Set<string>>(new Set<string>());
  public saveBurstPinId = signal<string | null>(null);
  private saveBurstTimer: any = null;
  private likeBurstTimer: any = null;
  public isScrollingLoad = signal<boolean>(false);
  public isLandscape = signal<boolean>(false);
  public isDesktop = signal<boolean>(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);

  public showSharePopover = signal(false);
  public shareConversations = signal<ConversationSummary[]>([]);
  public shareLoading = signal(false);
  public shareError = signal<string | null>(null);
  public shareSendingId = signal<string | null>(null);
  public shareSentToId = signal<string | null>(null);
  public numSideColumns = signal<number>(2);
  public numBottomColumns = signal<number>(3);
  public newCommentText = '';
  public isSubmittingComment = false;
  public showOptionsMenu = signal<boolean>(false);

  // --- Crop / "Pinterest Lens" region search (inline on the image) ----------
  private static readonly DEFAULT_CROP: CropBox = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 };
  public cropMode = signal<boolean>(false);
  public cropBox = signal<CropBox>({ ...PinDetail.DEFAULT_CROP });
  public regionResults = signal<any[] | null>(null);
  public regionLoading = signal<boolean>(false);
  private cropDebounce: any = null;
  private cropInFlight: AbortController | null = null;

  // Full-size image lightbox (the "phóng to" button next to the crop toggle)
  public showFullImage = signal<boolean>(false);

  @HostListener('window:resize')
  onResize() {
    this.calculateColumns();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.showOptionsMenu.set(false);
    }
  }

  calculateColumns() {
    if (typeof window === 'undefined') return;
    const width = window.innerWidth;
    if (width >= 1024) {
      this.isDesktop.set(true);
      if (width >= 1800) {
        this.numSideColumns.set(3);
        this.numBottomColumns.set(4);
      } else if (width >= 1400) {
        this.numSideColumns.set(2);
        this.numBottomColumns.set(4);
      } else {
        this.numSideColumns.set(2);
        this.numBottomColumns.set(3);
      }
    } else {
      this.isDesktop.set(false);
      this.numSideColumns.set(0);
      if (width >= 768) {
        this.numBottomColumns.set(3);
      } else {
        this.numBottomColumns.set(2);
      }
    }
  }

  // ── Ảnh Premium (ưu tiên dữ liệu server, fallback registry local) ────────────
  get isPremiumPin(): boolean {
    const a = this.access();
    if (a) return a.isPremium;
    const p = this.pin();
    return !!p?.isPremium || (!!p?.id && this.billing.isPremium(p.id));
  }

  get premiumPriceValue(): number {
    const a = this.access();
    if (a && a.priceCredits != null) return a.priceCredits;
    const p = this.pin();
    if (p?.priceCredits != null) return p.priceCredits;
    return (p?.id && this.billing.premiumPrice(p.id)) || 0;
  }

  get isOwnerOfPin(): boolean {
    const uid = this.supabaseService.user()?.id || this.supabaseService.dbUser()?.id;
    return !!uid && this.pin()?.userId === uid;
  }

  /** Đã có quyền tải HD: là chủ ảnh, hoặc đã mua entitlement. */
  get canDownloadHd(): boolean {
    const a = this.access();
    if (a) return a.canDownload;
    const id = this.pin()?.id;
    return this.isOwnerOfPin || (!!id && this.billing.hasEntitlement(id));
  }

  /** Cần khoá (hiện preview watermark + nút mua). */
  get isLocked(): boolean {
    return this.isPremiumPin && !this.canDownloadHd;
  }

  async buyDownload() {
    const id = this.pin()?.id;
    if (!id) return;
    this.isBuying.set(true);
    try {
      // Đường thật: gọi API backend (trừ credit + chia doanh thu + tạo entitlement)
      const res = await this.billing.purchasePinApi(id);
      if (res.ok) {
        this.toastService.success('Đã mua quyền tải HD! Bạn có thể tải bản gốc ngay.');
        await this.loadAccess(id);
        return;
      }
      // Backend chưa chạy (preview) -> fallback mô phỏng cục bộ
      if (res.reason === 'no_token' || res.reason === 'network') {
        const price = this.premiumPriceValue;
        if (this.billing.spendable() < price) {
          this.toastService.error('Bạn không đủ credit. Hãy nạp thêm trong Ví.');
          this.router.navigate(['/wallet']);
          return;
        }
        if (this.billing.purchasePin(id, price)) {
          this.toastService.success('Đã mua quyền tải HD! Bạn có thể tải bản gốc ngay.');
        }
        return;
      }
      // Backend trả lỗi nghiệp vụ (không đủ credit...)
      const msg = res.reason || 'Không mua được.';
      this.toastService.error(msg);
      if (/credit/i.test(msg)) this.router.navigate(['/wallet']);
    } finally {
      this.isBuying.set(false);
    }
  }

  /**
   * Tải bản HD. Ở bản thật: gọi GET /api/pins/:id/download (guard kiểm entitlement,
   * trả signed URL 1 lần + watermark ẩn). Ở bản demo: mở ảnh gốc để tải xuống.
   */
  public isDownloading = signal(false);

  /**
   * Tải bản HD thẳng về máy.
   *
   * Không dùng <a download href="{cdn}"> được: thuộc tính `download` bị trình
   * duyệt bỏ qua với link khác origin (ảnh nằm trên CDN Supabase), nên trước
   * đây bấm chỉ MỞ ảnh ở tab mới chứ không tải. Vì vậy phải tải nội dung về
   * thành blob (cùng origin) rồi mới gắn vào link tải.
   */
  async downloadHd() {
    const p = this.pin();
    if (!p || !this.canDownloadHd || this.isDownloading()) return;

    this.isDownloading.set(true);
    let objectUrl: string | null = null;
    try {
      const res = await fetch(p.imageUrl, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();

      // Đuôi file theo đúng kiểu ảnh server trả về, không đoán cứng .jpg
      const type = blob.type || 'image/jpeg';
      const ext = type.includes('png') ? 'png'
        : type.includes('webp') ? 'webp'
        : type.includes('gif') ? 'gif'
        : 'jpg';
      const safeName = (p.title || 'pinhub')
        .replace(/[\\/:*?"<>|]+/g, '')  // ký tự Windows không cho phép trong tên file
        .trim()
        .slice(0, 80) || 'pinhub';

      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${safeName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.toastService.success('Đã tải bản HD về máy.');
    } catch (e) {
      console.error('Tải HD thất bại:', e);
      this.toastService.error('Không tải được ảnh. Vui lòng thử lại.');
    } finally {
      // Thu hồi sau một nhịp để trình duyệt kịp bắt đầu lưu file
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 10_000);
      this.isDownloading.set(false);
    }
  }

  private currentPage = 1;
  private limit = 20;
  private hasMore = true;
  private observer?: IntersectionObserver;

  async ngOnInit() {
    this.calculateColumns();
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.currentPage = 1;
        this.hasMore = true;
        this.relatedPins.set([]);
        this.exitCropMode({ updateUrl: false });
        this.loadPinDetail(id);
      }
    });
    // Restore crop state from the URL (?cx&cy&cw&ch) so a shared/refreshed link
    // reopens the same selection.
    this.route.queryParamMap.subscribe(q => {
      const box = this.parseCropParams(q.get('cx'), q.get('cy'), q.get('cw'), q.get('ch'));
      if (box && !this.cropMode()) {
        this.cropBox.set(box);
        this.cropMode.set(true);
        // wait until the pin (and its image) is loaded before searching
        if (this.pin()) this.runRegionSearch();
      }
    });
    await this.loadBoards();
  }

  private parseCropParams(cx: string | null, cy: string | null, cw: string | null, ch: string | null): CropBox | null {
    const nums = [cx, cy, cw, ch].map(v => (v === null ? NaN : Number(v)));
    if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return null;
    const [x, y, width, height] = nums;
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
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

  async loadPinDetail(id: string) {
    this.isLoading.set(true);
    this.isRelatedLoading.set(true);
    this.isLandscape.set(false); // reset
    try {
      // 1. Fetch details
      const detailPin = await this.pinService.getPinById(id);
      this.pin.set(detailPin);
      void this.loadAccess(id);

      // Check if image is horizontal landscape
      if (detailPin && detailPin.imageUrl) {
        const img = new Image();
        img.src = detailPin.imageUrl;
        img.onload = () => {
          this.isLandscape.set(img.naturalWidth > img.naturalHeight);
        };
      }

      this.isLoading.set(false);

      // If the URL asked for crop mode, run the region search now that we have the pin
      if (this.cropMode() && detailPin?.id) {
        this.runRegionSearch();
      }

      // 2. Fetch related feed by category (excluding this one)
      try {
        const related = await this.pinService.getRelatedPins(id, 1, 30);
        const mappedRelated = related.map(p => ({
          id: p.id,
          title: p.title,
          image: p.imageUrl,
          author: p.user?.username || 'Pinterest AI',
          likes: (p as any)._count?.likes ?? 0,
        }));
        this.relatedPins.set(mappedRelated);
      } catch (relErr) {
        console.error('Error loading related pins:', relErr);
      } finally {
        this.isRelatedLoading.set(false);
      }
    } catch (error) {
      console.error('Error loading pin detail:', error);
      this.router.navigate(['/feed']);
      this.isLoading.set(false);
      this.isRelatedLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/feed']);
  }

  openFullImage() {
    this.showFullImage.set(true);
  }

  closeFullImage() {
    this.showFullImage.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.showFullImage()) this.closeFullImage();
  }

  // --- Crop / region search --------------------------------------------------

  toggleCropMode() {
    if (this.cropMode()) {
      this.exitCropMode({ updateUrl: true });
    } else {
      this.cropBox.set({ ...PinDetail.DEFAULT_CROP });
      this.cropMode.set(true);
      this.syncCropUrl();
      this.runRegionSearch();
    }
  }

  private exitCropMode(opts: { updateUrl: boolean }) {
    if (this.cropDebounce) { clearTimeout(this.cropDebounce); this.cropDebounce = null; }
    if (this.cropInFlight) { this.cropInFlight.abort(); this.cropInFlight = null; }
    this.cropMode.set(false);
    this.regionResults.set(null);
    this.regionLoading.set(false);
    if (opts.updateUrl) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { cx: null, cy: null, cw: null, ch: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  /** live box updates while dragging — just re-render, don't search */
  onCropBoxChange(box: CropBox) {
    this.cropBox.set(box);
  }

  /** pointer released after a drag/resize — debounce, then search + sync URL */
  onCropCommit() {
    if (this.cropDebounce) clearTimeout(this.cropDebounce);
    this.cropDebounce = setTimeout(() => {
      this.syncCropUrl();
      this.runRegionSearch();
    }, 400);
  }

  private syncCropUrl() {
    const b = this.cropBox();
    const r = (n: number) => Math.round(n * 1000) / 1000;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cx: r(b.x), cy: r(b.y), cw: r(b.width), ch: r(b.height) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private async runRegionSearch() {
    const p = this.pin();
    if (!p?.id) return;
    if (this.cropInFlight) this.cropInFlight.abort();
    const controller = new AbortController();
    this.cropInFlight = controller;
    this.regionLoading.set(true);
    try {
      const raw = await this.pinService.searchByRegion(p.id, this.cropBox(), controller.signal);
      if (controller.signal.aborted) return;
      this.regionResults.set(raw.map((rp: any) => ({
        id: rp.id,
        title: rp.title,
        image: rp.imageUrl,
        author: rp.user?.username || 'Pinterest AI',
        likes: rp._count?.likes ?? 0,
      })));
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Region search failed:', err);
      this.toastService.error(err?.message || 'Không thể tìm kiếm theo vùng ảnh.');
      this.regionResults.set([]);
    } finally {
      if (this.cropInFlight === controller) {
        this.cropInFlight = null;
        this.regionLoading.set(false);
      }
    }
  }

  /** Pins shown in the masonry grid: region-search results when cropping, else related pins. */
  displayPins(): any[] {
    if (this.cropMode() && this.regionResults()) return this.regionResults()!;
    return this.relatedPins();
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastService.success('Đã sao chép liên kết ảnh!');
    } catch (error) {
      console.error('Error copying link:', error);
    }
  }

  /**
   * Ba popup ở hàng nút (chia sẻ / tuỳ chọn / chọn bảng) neo cùng một hàng nên
   * mở đồng thời sẽ chồng đè lên nhau — mở cái nào thì đóng hai cái kia.
   */
  private closeOtherPopups(keep: 'share' | 'options' | 'board') {
    if (keep !== 'share') this.showSharePopover.set(false);
    if (keep !== 'options') this.showOptionsMenu.set(false);
    if (keep !== 'board') this.showBoardDropdown.set(false);
  }

  async toggleSharePopover(event: MouseEvent) {
    event.stopPropagation();
    const next = !this.showSharePopover();
    this.closeOtherPopups('share');
    this.showSharePopover.set(next);
    if (next && this.shareConversations().length === 0) {
      await this.loadShareConversations();
    }
  }

  closeSharePopover() {
    this.showSharePopover.set(false);
  }

  private async loadShareConversations() {
    this.shareLoading.set(true);
    this.shareError.set(null);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      this.shareConversations.set(await this.chatService.listConversations(token));
    } catch (error) {
      this.shareError.set(error instanceof Error ? error.message : 'Không thể tải danh sách trò chuyện.');
    } finally {
      this.shareLoading.set(false);
    }
  }

  async shareToConversation(conversationId: string, event: MouseEvent) {
    event.stopPropagation();
    const currentPin = this.pin();
    if (!currentPin || this.shareSendingId()) return;

    this.shareSendingId.set(conversationId);
    this.shareError.set(null);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      await this.chatService.sendMessage(conversationId, { type: 'PIN', pinId: currentPin.id }, token);
      this.shareSentToId.set(conversationId);
      setTimeout(() => {
        this.shareSentToId.set(null);
        this.showSharePopover.set(false);
      }, 1200);
    } catch (error) {
      this.shareError.set(error instanceof Error ? error.message : 'Không thể chia sẻ Pin này.');
    } finally {
      this.shareSendingId.set(null);
    }
  }

  toggleOptionsMenu(event: MouseEvent) {
    event.stopPropagation();
    const next = !this.showOptionsMenu();
    this.closeOtherPopups('options');
    this.showOptionsMenu.set(next);
  }

  isOwner(): boolean {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    return !!currentPin && !!currentUser && currentPin.userId === currentUser.id;
  }

  navigateToAuthorProfile() {
    const username = this.pin()?.user?.username;
    if (username) this.router.navigate(['/profile', username]);
  }

  async deleteCurrentPin() {
    const currentPin = this.pin();
    if (!currentPin || !this.isOwner()) return;
    const confirmed = await this.confirmService.ask(
      'Bạn có chắc muốn xóa ảnh này? Hành động này không thể hoàn tác.',
      { title: 'Xóa ảnh', confirmLabel: 'Xóa', danger: true }
    );
    if (!confirmed) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      await this.pinService.deletePin(currentPin.id, token);
      this.showOptionsMenu.set(false);
      this.toastService.success('Đã xóa ảnh thành công!');
      this.router.navigate(['/feed']);
    } catch (error) {
      console.error('Error deleting pin:', error);
      this.toastService.error('Lỗi khi xóa ảnh.');
    }
  }

  public isReporting = signal(false);

  /**
   * Gửi báo cáo ảnh vi phạm. Endpoint POST /pins/:id/report đã có sẵn ở backend
   * nhưng nút này trước đây chỉ đóng menu, không gửi gì cả.
   */
  async reportCurrentPin() {
    const currentPin = this.pin();
    if (!currentPin || this.isReporting()) return;

    // Hộp thoại riêng: chọn lý do dựng sẵn, "Khác" thì nhập mô tả (report.ts)
    this.showOptionsMenu.set(false);
    const reason = await this.reportService.ask(currentPin.title || 'ảnh này');
    if (!reason) return;

    this.isReporting.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) {
        this.toastService.error('Bạn cần đăng nhập để báo cáo.');
        return;
      }
      await this.pinService.reportPin(currentPin.id, token, reason);
      this.showOptionsMenu.set(false);
      this.toastService.success('Đã gửi báo cáo. Cảm ơn bạn đã phản hồi.');
    } catch (error) {
      console.error('Error reporting pin:', error);
      this.toastService.error(error instanceof Error ? error.message : 'Không gửi được báo cáo.');
    } finally {
      this.isReporting.set(false);
    }
  }

  /* --- Related-card save --------------------------------------------------
     savePinToBoard() above only ever saves this.pin(), so the related cards had
     no way to reach it — their button carried no handler at all. These mirror
     what the feed does (see onSaveClick/saveToBoard in home.ts) so a card
     behaves the same wherever it appears.

     Keyed by pin id, not a boolean: several related cards are on screen at once
     and only the one that was clicked may open its picker. */
  public activeRelatedPinId = signal<string | null>(null);

  /** Every related card navigates on click, so each of these stops the event —
   * otherwise saving would also leave the page for the pin being saved. */
  async onRelatedSaveClick(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    if (!this.supabaseService.user()) {
      this.toastService.error('Bạn cần đăng nhập để lưu ảnh.');
      return;
    }
    // With boards to choose from, ask; with none, saving creates the default
    // board and completes in one click rather than opening an empty menu.
    if (this.boards().length > 0) {
      this.activeRelatedPinId.set(this.activeRelatedPinId() === pinId ? null : pinId);
      return;
    }
    await this.saveRelatedToBoard(pinId, null, event);
  }

  async saveRelatedToBoard(pinId: string, board: Board | null, event: MouseEvent) {
    event.stopPropagation();
    this.activeRelatedPinId.set(null);
    if (!this.supabaseService.user()) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = board?.id;
      let boardName = board?.name;

      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Hồ sơ',
          'Bảng lưu mặc định',
          false,
          token
        );
        this.boards.update(current => [newBoard, ...current]);
        boardId = newBoard.id;
        boardName = newBoard.name;
      }

      await this.boardService.addPinToBoard(boardId, pinId, token);
      this.markSaved(pinId);
      this.toastService.success(`Đã lưu vào bảng "${boardName}"!`);
    } catch (error) {
      console.error('Error saving related pin to board:', error);
      this.toastService.error('Lỗi khi lưu ảnh vào bảng.');
    }
  }

  isSaved(pinId: string): boolean {
    return this.savedPinIds().has(pinId);
  }

  /** Fills the bookmark and fires the ring, same shape as the like button's
   * burst. Called only after the save actually succeeded. */
  private markSaved(pinId: string): void {
    this.savedPinIds.update((current) => new Set(current).add(pinId));
    this.saveBurstPinId.set(pinId);
    if (this.saveBurstTimer) clearTimeout(this.saveBurstTimer);
    this.saveBurstTimer = setTimeout(() => this.saveBurstPinId.set(null), 520);
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  async toggleLike() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin) return;
    // Was a silent no-op when signed out, so the button simply did nothing and
    // gave no reason. Same message shape as saving to a board.
    if (!currentUser) {
      this.toastService.error('Bạn cần đăng nhập để thích ảnh.');
      return;
    }

    // 1. Optimistic UI update (0ms instant response)
    const currentlyLiked = this.isLikedByUser();
    const nextLikes = [...(currentPin.likes || [])];
    if (currentlyLiked) {
      const idx = nextLikes.findIndex(l => l.userId === currentUser.id);
      if (idx !== -1) nextLikes.splice(idx, 1);
    } else {
      nextLikes.push({ userId: currentUser.id, pinId: currentPin.id });
    }
    this.pin.set({ ...currentPin, likes: nextLikes });

    // 1b. Hiệu ứng nảy + vòng loang, chỉ khi VỪA thích (không chạy lúc bỏ thích)
    if (!currentlyLiked) {
      this.likeBurst.set(true);
      if (this.likeBurstTimer) clearTimeout(this.likeBurstTimer);
      this.likeBurstTimer = setTimeout(() => this.likeBurst.set(false), 520);
    }

    // Toast rides with the optimistic update, not the network reply, so it
    // lands at the same moment the heart fills. The catch below undoes both the
    // state and this claim if the call fails.
    if (currentlyLiked) {
      this.toastService.success('Đã bỏ thích ảnh này.');
    } else {
      this.toastService.success('Đã thích ảnh này!');
    }

    // 2. Perform network call asynchronously
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.pinService.toggleLike(currentPin.id, token);
      }
    } catch (error) {
      console.error('Error toggling like:', error);
      // Revert state on error
      this.pin.set(currentPin);
      this.toastService.error('Không thể cập nhật lượt thích. Vui lòng thử lại.');
    }
  }

  isLikedByUser(): boolean {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser || !currentPin.likes) return false;
    return currentPin.likes.some((l: any) => l.userId === currentUser.id);
  }

  async submitComment() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser || !this.newCommentText.trim()) return;

    this.isSubmittingComment = true;
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const newComment = await this.pinService.addComment(currentPin.id, this.newCommentText.trim(), token);
        const updatedComments = [...(currentPin.comments || []), newComment];
        this.pin.set({ ...currentPin, comments: updatedComments });
        this.newCommentText = '';
      }
    } catch (error) {
      console.error('Error submitting comment:', error);
    } finally {
      this.isSubmittingComment = false;
    }
  }

  toggleBoardDropdown(event: MouseEvent) {
    event.stopPropagation();
    const next = !this.showBoardDropdown();
    this.closeOtherPopups('board');
    this.showBoardDropdown.set(next);
  }

  selectBoard(board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.selectedBoard.set(board);
    this.showBoardDropdown.set(false);
  }

  getSelectedBoardName(): string {
    const active = this.selectedBoard();
    if (active) {
      return active.name;
    }
    const list = this.boards();
    if (list.length > 0) {
      return list[0].name;
    }
    return 'Hồ sơ';
  }

  async savePinToBoard() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = this.selectedBoard()?.id;
      let boardName = this.selectedBoard()?.name;

      if (!boardId && this.boards().length > 0) {
        boardId = this.boards()[0].id;
        boardName = this.boards()[0].name;
      }

      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Hồ sơ',
          'Bảng lưu mặc định',
          false,
          token
        );
        this.boards.update(current => [newBoard, ...current]);
        boardId = newBoard.id;
        boardName = newBoard.name;
      }

      await this.boardService.addPinToBoard(boardId, currentPin.id, token);
      this.markSaved(currentPin.id);
      this.toastService.success(`Đã lưu vào bảng "${boardName}"!`);
    } catch (error) {
      console.error('Error saving pin to board:', error);
      this.toastService.error('Lỗi khi lưu ảnh vào bảng.');
    }
  }

  getSideColumnsArray(): number[] {
    return Array.from({ length: this.numSideColumns() }, (_, i) => i);
  }

  getBottomColumnsArray(): number[] {
    return Array.from({ length: this.numBottomColumns() }, (_, i) => i);
  }

  getSideRelatedPinsForColumn(colIndex: number): any[] {
    if (!this.isDesktop()) {
      return [];
    }
    const totalCols = this.numBottomColumns() + this.numSideColumns();
    const targetModulo = this.numBottomColumns() + colIndex;
    return this.displayPins().filter((_, index) => index % totalCols === targetModulo);
  }

  getBottomRelatedPinsForColumn(colIndex: number): any[] {
    const totalCols = this.isDesktop() ? (this.numBottomColumns() + this.numSideColumns()) : this.numBottomColumns();
    return this.displayPins().filter((_, index) => index % totalCols === colIndex);
  }
  getSideSkeletonsForColumn(colIndex: number): number[] {
    const dummy = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const totalCols = this.numBottomColumns() + this.numSideColumns();
    const targetModulo = this.numBottomColumns() + colIndex;
    return dummy.filter((_, index) => index % totalCols === targetModulo);
  }

  getBottomSkeletonsForColumn(colIndex: number): number[] {
    const dummy = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const totalCols = this.isDesktop() ? (this.numBottomColumns() + this.numSideColumns()) : this.numBottomColumns();
    return dummy.filter((_, index) => index % totalCols === colIndex);
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.cropDebounce) clearTimeout(this.cropDebounce);
    if (this.cropInFlight) this.cropInFlight.abort();
    if (this.likeBurstTimer) clearTimeout(this.likeBurstTimer);
    if (this.saveBurstTimer) clearTimeout(this.saveBurstTimer);
  }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !this.isLoading() && !this.isRelatedLoading() && !this.isScrollingLoad() && this.hasMore) {
        await this.loadMoreRelatedPins();
      }
    }, {
      rootMargin: '200px',
    });

    if (this.scrollSentinel) {
      this.observer.observe(this.scrollSentinel.nativeElement);
    }
  }

  async loadMoreRelatedPins() {
    const currentPin = this.pin();
    // in crop mode the grid shows region-search results — don't append related pins to it
    if (!currentPin || this.cropMode() || this.isScrollingLoad() || !this.hasMore) return;
    this.isScrollingLoad.set(true);
    this.currentPage++;
    try {
      const related = await this.pinService.getRelatedPins(currentPin.id, this.currentPage, this.limit);
      if (related && related.length > 0) {
        const mappedRelated = related.map(p => ({
          id: p.id,
          title: p.title,
          image: p.imageUrl,
          author: p.user?.username || 'Pinterest AI',
          likes: (p as any)._count?.likes ?? 0,
        }));
        this.relatedPins.update(current => [...current, ...mappedRelated]);
        if (related.length < this.limit) {
          this.hasMore = false;
        }
      } else {
        this.hasMore = false;
      }
    } catch (error) {
      console.error('Error loading more related pins:', error);
      this.hasMore = false;
    } finally {
      this.isScrollingLoad.set(false);
    }
  }
}
