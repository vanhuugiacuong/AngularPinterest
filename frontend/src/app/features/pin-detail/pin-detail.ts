import {
  Component,
  OnInit,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Pin, PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { BoardService, Board } from '../../core/services/board';
import { FormsModule } from '@angular/forms';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { MembershipService } from '../../core/services/membership';
import type { MembershipPlan } from '../../core/models/membership-plan';
import { ImageRegionSearch } from './image-region-search/image-region-search';
import { API_BASE_URL } from '../../core/api-base';
import { WatermarkPreset, WatermarkService } from '../../core/services/watermark';
import { ToastService } from '../../core/services/toast';

@Component({
  selector: 'app-pin-detail',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule, UserAvatar, ImageRegionSearch],
  templateUrl: './pin-detail.html',
  styleUrl: './pin-detail.css',
})
export class PinDetail implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private toast = inject(ToastService);
  public supabaseService = inject(SupabaseService);
  public membership = inject(MembershipService);
  public downloadMessage = signal('');
  public pendingPurchase = signal<{ paymentReference: string; amount: string } | null>(null);
  public downloading = signal(false);
  public watermarkService = inject(WatermarkService);
  public selectedWatermarkPresetId = signal<string | null>(null);

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef;
  @ViewChild('relatedSection') relatedSection?: ElementRef<HTMLElement>;

  public pin = signal<any | null>(null);
  public loadError = signal<string | null>(null);
  public relatedPins = signal<any[]>([]);
  public boards = signal<Board[]>([]);
  public showBoardDropdown = signal<boolean>(false);
  public selectedBoard = signal<Board | null>(null);
  public isLoading = signal<boolean>(true);
  public isRelatedLoading = signal<boolean>(true);
  public isScrollingLoad = signal<boolean>(false);
  public isLandscape = signal<boolean>(false);
  public numRelatedColumns = signal<number>(2);
  public showImageSearch = signal<boolean>(false);
  public isVisualSearchResults = signal<boolean>(false);
  public newCommentText = '';
  public isSubmittingComment = false;

  /** Best available avatar for the signed-in viewer's own comment-box avatar. */
  myAvatarUrl(): string | null {
    const dbAvatar = this.supabaseService.dbUser()?.avatarUrl;
    if (dbAvatar) return dbAvatar;
    const user = this.supabaseService.user();
    return user?.user_metadata?.['avatar_url'] || user?.user_metadata?.['picture'] || null;
  }

  /** The signed-in viewer's own active plan, for the comment-box avatar.
   * Same precedence as Navbar.myPlan(): the live membership signal (already
   * loaded in ngOnInit below) first, falling back to the plan last synced
   * onto dbUser so a slow/failed membership fetch never shows a wrong frame. */
  myPlan(): MembershipPlan | null | undefined {
    return this.membership.status()?.plan ?? this.supabaseService.dbUser()?.plan;
  }

  myDisplayName(): string {
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

  @HostListener('window:resize')
  onResize() {
    this.calculateColumns();
  }

  calculateColumns() {
    if (typeof window === 'undefined') return;
    const width = window.innerWidth;
    if (width >= 1440) {
      this.numRelatedColumns.set(5);
    } else if (width >= 1024) {
      this.numRelatedColumns.set(4);
    } else if (width >= 768) {
      this.numRelatedColumns.set(3);
    } else {
      this.numRelatedColumns.set(2);
    }
  }

  private currentPage = 1;
  private limit = 20;
  private hasMore = true;
  private observer?: IntersectionObserver;
  private currentPinId: string | null = null;
  private relatedRequestVersion = 0;

  async ngOnInit() {
    await this.membership.load();
    if (this.membership.status()?.customWatermark) {
      try {
        const presets = await this.watermarkService.list();
        this.selectedWatermarkPresetId.set(presets.find((p) => p.isDefault)?.id ?? null);
      } catch {
        // Không chặn xem pin nếu tải preset thất bại - người dùng vẫn tải được ảnh sạch.
      }
    }
    this.calculateColumns();
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.currentPinId = id;
        this.currentPage = 1;
        this.hasMore = true;
        this.relatedRequestVersion++;
        this.relatedPins.set([]);
        this.showImageSearch.set(false);
        this.isVisualSearchResults.set(false);
        this.loadPinDetail(id);
      }
    });
    await this.loadBoards();
  }

  bankQrFor(purchase: { paymentReference: string; amount: string }) {
    return `https://img.vietqr.io/image/MB-110605043105-compact2.png?amount=${Number(purchase.amount)}&addInfo=${encodeURIComponent(purchase.paymentReference)}&accountName=NGUYEN%20DOAN%20PHUC`;
  }

  async downloadPin() {
    const p = this.pin(); if (!p || this.downloading()) return;
    this.downloadMessage.set('Đang chuẩn bị ảnh...');
    this.downloading.set(true);
    try {
      const isOwner = p.user?.id === this.supabaseService.user()?.id;
      if (p.isForSale && !isOwner) {
        const purchase = await this.membership.purchase(p.id);
        if (purchase.status !== 'PAID') {
          this.pendingPurchase.set(purchase);
          this.downloadMessage.set('Cần thanh toán trước khi tải ảnh gốc — quét mã bên dưới rồi bấm lại "Mua & tải" để kiểm tra.');
          return;
        }
      }
      this.pendingPurchase.set(null);
      await this.fetchAndSaveDownload(p.id, p.title);
      this.downloadMessage.set('Đã tải ảnh.');
    } catch (e) {
      this.downloadMessage.set(e instanceof Error ? e.message : 'Không thể tải ảnh.');
    } finally {
      this.downloading.set(false);
    }
  }

  private async fetchAndSaveDownload(pinId: string, title: string): Promise<void> {
    const token = await this.supabaseService.getSessionToken();
    const presetId = this.selectedWatermarkPresetId();
    const query = presetId ? `?watermarkPresetId=${encodeURIComponent(presetId)}` : '';
    const response = await fetch(`${API_BASE_URL}/api/memberships/pins/${pinId}/download${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Không thể tải ảnh.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title || 'novaframe'}.jpg`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  retryLoad() {
    if (this.currentPinId) {
      this.loadPinDetail(this.currentPinId);
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

  async loadPinDetail(id: string) {
    this.isLoading.set(true);
    this.isRelatedLoading.set(true);
    this.isLandscape.set(false); // reset
    this.loadError.set(null);
    try {
      // 1. Fetch details
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      const detailPin = await this.pinService.getPinById(id, token);
      // Route may have changed while this request was in flight — drop stale results.
      if (this.currentPinId !== id) return;
      this.pin.set(detailPin);

      // Check if image is horizontal landscape
      if (detailPin && detailPin.imageUrl) {
        const img = new Image();
        img.src = detailPin.imageUrl;
        img.onload = () => {
          if (this.currentPinId !== id) return;
          this.isLandscape.set(img.naturalWidth > img.naturalHeight);
        };
      }

      this.isLoading.set(false);

      // 2. Fetch related feed by category (excluding this one)
      const relatedVersion = this.relatedRequestVersion;
      try {
        const related = await this.pinService.getRelatedPins(id, 1, 30);
        if (this.currentPinId !== id || this.relatedRequestVersion !== relatedVersion) return;
        const mappedRelated = this.mapRelatedPins(related);
        this.relatedPins.set(mappedRelated);
      } catch (relErr) {
        console.error('Error loading related pins:', relErr);
      } finally {
        if (this.currentPinId === id && this.relatedRequestVersion === relatedVersion) {
          this.isRelatedLoading.set(false);
        }
      }
    } catch (error) {
      console.error('Error loading pin detail:', error);
      if (this.currentPinId !== id) return;
      this.loadError.set('Không thể tải tác phẩm này. Có thể đường liên kết không còn tồn tại hoặc mạng đang gặp sự cố.');
      this.isLoading.set(false);
      this.isRelatedLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/feed']);
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  /** Receives real CLIP matches from the region selector and swaps only the
   * gallery below the current artwork. The detail page stays mounted, the
   * current pin is excluded, and infinite category suggestions are disabled
   * because this result set belongs to one exact visual query. */
  onImageSearchCompleted(results: Pin[]) {
    const currentId = this.currentPinId;
    const matches = results.filter((result) => result.id !== currentId);

    this.relatedRequestVersion++;
    this.currentPage = 1;
    this.hasMore = false;
    this.isScrollingLoad.set(false);
    this.isRelatedLoading.set(false);
    this.isVisualSearchResults.set(true);
    this.relatedPins.set(this.mapRelatedPins(matches));
    this.showImageSearch.set(false);

    setTimeout(() => {
      const behavior =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth';
      this.relatedSection?.nativeElement.scrollIntoView({ behavior, block: 'start' });
    });
  }

  navigateToProfile(username: string | undefined | null) {
    if (!username) return;
    this.router.navigate(['/profile', username]);
  }

  async toggleLike() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const result = await this.pinService.toggleLike(currentPin.id, token);
        this.pin.set({
          ...currentPin,
          isLiked: result.liked,
          likeCount: result.likeCount,
          _count: { ...currentPin._count, likes: result.likeCount },
        });
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  isLikedByUser(): boolean {
    const currentPin = this.pin();
    return currentPin?.isLiked === true;
  }

  async submitComment() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser || !this.newCommentText.trim()) return;

    this.isSubmittingComment = true;
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const newComment = await this.pinService.addComment(
          currentPin.id,
          this.newCommentText.trim(),
          token,
        );
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
    this.showBoardDropdown.update((val) => !val);
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
    return 'Lưu vào';
  }

  async savePinToBoard() {
    const currentPin = this.pin();
    const currentUser = this.supabaseService.user();
    if (!currentPin || !currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = this.selectedBoard()?.id;

      if (!boardId && this.boards().length > 0) {
        boardId = this.boards()[0].id;
      }

      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Bộ sưu tập của tôi',
          'Bộ sưu tập lưu mặc định',
          false,
          token,
        );
        this.boards.update((current) => [newBoard, ...current]);
        boardId = newBoard.id;
      }

      await this.boardService.addPinToBoard(boardId, currentPin.id, token);
      this.toast.success('Đã lưu vào bộ sưu tập');
    } catch (error) {
      console.error('Error saving pin to board:', error);
      this.toast.error('Không thể lưu ảnh vào bộ sưu tập.', {
        action: { label: 'Thử lại', onClick: () => this.savePinToBoard() },
      });
    }
  }

  /** Per-related-pin like/save state — mirrors Home's own toggleLike/
   * toggleBoardDropdown/selectBoardForPin/savePinToBoard exactly (same
   * default board name, same toast/error pattern) so the related-pins strip
   * behaves and looks identical to every other pin grid in the app, not a
   * stripped-down hover-only preview. */
  public relatedActiveDropdownPinId = signal<string | null>(null);
  public relatedSelectedBoardMap = signal<Record<string, Board>>({});

  async toggleRelatedLike(rel: { id: string; likes: number }, event: MouseEvent) {
    event.stopPropagation();
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const result = await this.pinService.toggleLike(rel.id, token);
      rel.likes = result.liked ? (rel.likes || 0) + 1 : Math.max(0, (rel.likes || 0) - 1);
      this.relatedPins.update((current) => [...current]);
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  toggleRelatedBoardDropdown(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    this.relatedActiveDropdownPinId.update((current) => (current === pinId ? null : pinId));
  }

  selectRelatedBoardForPin(pinId: string, board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.relatedSelectedBoardMap.update((current) => ({ ...current, [pinId]: board }));
    this.relatedActiveDropdownPinId.set(null);
  }

  getRelatedSelectedBoardName(pinId: string): string {
    const selected = this.relatedSelectedBoardMap()[pinId];
    if (selected) return selected.name;
    const list = this.boards();
    if (list.length > 0) return list[0].name;
    return 'Lưu vào';
  }

  saveRelatedPinToBoard(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    void this.performSaveRelatedToBoard(pinId);
  }

  private async performSaveRelatedToBoard(pinId: string): Promise<void> {
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = this.relatedSelectedBoardMap()[pinId]?.id;

      if (!boardId && this.boards().length > 0) {
        boardId = this.boards()[0].id;
      }

      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Bộ sưu tập của tôi',
          'Bộ sưu tập lưu mặc định',
          false,
          token,
        );
        this.boards.update((current) => [newBoard, ...current]);
        boardId = newBoard.id;
      }

      await this.boardService.addPinToBoard(boardId, pinId, token);
      this.toast.success('Đã lưu vào bộ sưu tập');
    } catch (error) {
      console.error('Error saving pin to board:', error);
      this.toast.error('Không thể lưu ảnh vào bộ sưu tập.', {
        action: { label: 'Thử lại', onClick: () => void this.performSaveRelatedToBoard(pinId) },
      });
    }
  }

  getRelatedColumnsArray(): number[] {
    return Array.from({ length: this.numRelatedColumns() }, (_, i) => i);
  }

  getRelatedPinsForColumn(colIndex: number): any[] {
    const totalCols = this.numRelatedColumns();
    return this.relatedPins().filter((_, index) => index % totalCols === colIndex);
  }

  getRelatedSkeletonsForColumn(colIndex: number): number[] {
    const dummy = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const totalCols = this.numRelatedColumns();
    return dummy.filter((_, index) => index % totalCols === colIndex);
  }

  private mapRelatedPins(pins: Pin[]): any[] {
    return pins.map((p) => {
      let idHash = 0;
      for (let i = 0; i < p.id.length; i++) {
        idHash += p.id.charCodeAt(i);
      }
      const ratios = [0.65, 0.7, 0.75, 0.8, 1.0, 1.2];
      const aspectRatio = ratios[idHash % ratios.length];
      return {
        id: p.id,
        title: p.title,
        image: p.imageUrl,
        author: p.user?.username || 'NovaFrame AI',
        authorAvatarUrl: p.user?.avatarUrl || null,
        authorPlan: p.user?.plan || 'FREE',
        likes: p._count?.likes ?? 0,
        isAiGenerated: p.isAiGenerated,
        aspectRatio,
      };
    });
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
    this.observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (
          entry.isIntersecting &&
          !this.isLoading() &&
          !this.isRelatedLoading() &&
          !this.isScrollingLoad() &&
          this.hasMore
        ) {
          await this.loadMoreRelatedPins();
        }
      },
      {
        rootMargin: '200px',
      },
    );

    if (this.scrollSentinel) {
      this.observer.observe(this.scrollSentinel.nativeElement);
    }
  }

  async loadMoreRelatedPins() {
    const currentPin = this.pin();
    if (!currentPin || this.isScrollingLoad() || !this.hasMore) return;
    const requestedPinId = currentPin.id;
    const relatedVersion = this.relatedRequestVersion;
    this.isScrollingLoad.set(true);
    this.currentPage++;
    try {
      const related = await this.pinService.getRelatedPins(
        currentPin.id,
        this.currentPage,
        this.limit,
      );
      // Route may have changed to a different pin while this request was in flight.
      if (
        this.currentPinId !== requestedPinId ||
        this.relatedRequestVersion !== relatedVersion
      ) return;
      if (related && related.length > 0) {
        const mappedRelated = this.mapRelatedPins(related);
        this.relatedPins.update((current) => [...current, ...mappedRelated]);
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
