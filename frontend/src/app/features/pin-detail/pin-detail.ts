import { Component, OnInit, inject, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { BoardService, Board } from '../../core/services/board';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';
import { ChatService, ConversationSummary } from '../../core/services/chat';
import { BillingService } from '../../core/services/billing';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pin-detail',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule],
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
  downloadHd() {
    const p = this.pin();
    if (!p || !this.canDownloadHd) return;
    const a = document.createElement('a');
    a.href = p.imageUrl;
    a.download = (p.title || 'pinhub') + '.jpg';
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
    this.toastService.success('Đang tải bản HD...');
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
        this.loadPinDetail(id);
      }
    });
    await this.loadBoards();
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

  async copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastService.success('Đã sao chép liên kết ảnh!');
    } catch (error) {
      console.error('Error copying link:', error);
    }
  }

  async toggleSharePopover(event: MouseEvent) {
    event.stopPropagation();
    const next = !this.showSharePopover();
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
    this.showOptionsMenu.update(val => !val);
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

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  async toggleLike() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const result = await this.pinService.toggleLike(currentPin.id, token);
        const updatedLikes = [...(currentPin.likes || [])];
        if (result.liked) {
          updatedLikes.push({ userId: currentUser.id, pinId: currentPin.id });
        } else {
          const idx = updatedLikes.findIndex(l => l.userId === currentUser.id);
          if (idx !== -1) updatedLikes.splice(idx, 1);
        }
        this.pin.set({ ...currentPin, likes: updatedLikes });
      }
    } catch (error) {
      console.error('Error toggling like:', error);
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
    this.showBoardDropdown.update(val => !val);
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
    return this.relatedPins().filter((_, index) => index % totalCols === targetModulo);
  }

  getBottomRelatedPinsForColumn(colIndex: number): any[] {
    const totalCols = this.isDesktop() ? (this.numBottomColumns() + this.numSideColumns()) : this.numBottomColumns();
    return this.relatedPins().filter((_, index) => index % totalCols === colIndex);
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
    if (!currentPin || this.isScrollingLoad() || !this.hasMore) return;
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
