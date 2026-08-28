import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { LikeButton } from '../../shared/like-button/like-button';
import { PinService, Pin } from '../../core/services/pin';
import { BoardService, Board } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { MembershipService } from '../../core/services/membership';
import { DialogService } from '../../core/services/dialog';
import { ToastService } from '../../core/services/toast';
import { formatNovaToken, vndToNovaToken } from '../../core/utils/novatoken';

const TAKE = 24;

@Component({
  selector: 'app-fixed-price',
  standalone: true,
  imports: [CommonModule, Navbar, UserAvatar, LikeButton],
  templateUrl: './fixed-price.html',
  styleUrl: './fixed-price.css',
})
export class FixedPrice implements OnInit {
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private toast = inject(ToastService);
  public router = inject(Router);
  public supabaseService = inject(SupabaseService);
  public membership = inject(MembershipService);
  private dialogService = inject(DialogService);

  public readonly formatNovaToken = formatNovaToken;
  public readonly vndToNovaToken = vndToNovaToken;

  public items = signal<Pin[]>([]);
  public total = signal(0);
  public loading = signal(true);
  public loadingMore = signal(false);
  public loadError = signal<string | null>(null);

  public readonly hasMore = computed(() => this.items().length < this.total());
  public readonly canBuy = computed(() => {
    const plan = this.membership.status()?.plan;
    return plan === 'PLUS' || plan === 'PRO';
  });

  /** Bảng chọn bộ sưu tập — cùng mẫu portal-positioned dropdown như home.ts. */
  public boards = signal<Board[]>([]);
  public activeDropdownPinId = signal<string | null>(null);
  public dropdownAnchor = signal<{ top: number; left: number } | null>(null);
  public readonly activeDropdownItem = computed(() => {
    const pinId = this.activeDropdownPinId();
    if (!pinId) return null;
    return this.items().find((item) => item.id === pinId) ?? null;
  });
  public selectedBoardMap = signal<Record<string, Board>>({});

  private skip = 0;

  async ngOnInit(): Promise<void> {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    void this.loadBoards();
    await this.loadFirstPage();
  }

  private async loadBoards(): Promise<void> {
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      this.boards.set(await this.boardService.getBoards(token));
    } catch {
      // Bảng chọn bộ sưu tập không tải được thì vẫn cho tạo bộ sưu tập mặc
      // định khi lưu — không chặn luồng chính chỉ vì danh sách này lỗi.
    }
  }

  @HostListener('window:resize')
  onResize(): void {
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

  private async loadFirstPage(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.skip = 0;
    try {
      const token = await this.supabaseService.getSessionToken();
      const result = await this.pinService.listFixedPrice(token ?? undefined, 0, TAKE);
      this.items.set(result.items);
      this.total.set(result.total);
      this.skip = result.items.length;
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Không thể tải danh sách sản phẩm.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      const result = await this.pinService.listFixedPrice(token ?? undefined, this.skip, TAKE);
      this.items.update((current) => [...current, ...result.items]);
      this.total.set(result.total);
      this.skip += result.items.length;
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Không thể tải thêm.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Bán giá cố định yêu cầu Plus hoặc Pro — khớp luật FIXED_PRICE_REQUIRED_MESSAGE
   * phía backend (getPinById 403 với ai dưới Plus, trừ chủ sở hữu). Ảnh đã
   * được server tự làm mờ cho viewer không đủ điều kiện rồi, đây chỉ là lớp UX. */
  isRestricted(item: Pin): boolean {
    const userId = this.supabaseService.user()?.id;
    if (userId && item.user.id === userId) return false;
    return !this.canBuy();
  }

  async onCardClick(item: Pin): Promise<void> {
    if (this.isRestricted(item)) {
      const goToPricing = await this.dialogService.confirm({
        variant: 'information',
        title: 'Khám phá tác phẩm cùng Plus',
        description: 'Nâng cấp Plus hoặc Pro để xem rõ và mua tác phẩm bán giá cố định.',
        confirmLabel: 'Xem các gói',
        cancelLabel: 'Để sau',
      });
      if (goToPricing) this.router.navigate(['/pricing']);
      return;
    }
    this.router.navigate(['/fixed-price', item.id]);
  }

  /** Chỉ chủ sở hữu hoặc người ĐÃ MUA thật sự mới được lưu vào bộ sưu tập —
   * khớp đúng luật canSave() ở fixed-price-detail.ts. */
  canSaveItem(item: Pin): boolean {
    const userId = this.supabaseService.user()?.id;
    if (userId && item.user.id === userId) return true;
    return item.hasPurchased === true;
  }

  async toggleLike(item: Pin, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    const previousLiked = item.isLiked === true;
    const previousLikes = item.likeCount ?? item._count?.likes ?? 0;
    const optimisticLikes = Math.max(0, previousLikes + (previousLiked ? -1 : 1));
    item.isLiked = !previousLiked;
    item.likeCount = optimisticLikes;
    if (item._count) item._count = { ...item._count, likes: optimisticLikes };
    (item as any).likeQueuedToggles = ((item as any).likeQueuedToggles || 0) + 1;
    this.items.update((current) => [...current]);

    await this.flushLikeQueue(item);
  }

  private async flushLikeQueue(item: Pin): Promise<void> {
    const state = item as any;
    if (state.likeSyncing) return;
    state.likeSyncing = true;

    try {
      while ((state.likeQueuedToggles || 0) > 0) {
        state.likeQueuedToggles--;

        try {
          const token = await this.supabaseService.getSessionToken();
          if (!token) throw new Error('Không tìm thấy phiên đăng nhập.');

          const result = await this.pinService.toggleLike(item.id, token);
          if (state.likeQueuedToggles === 0) {
            item.isLiked = result.liked;
            item.likeCount = result.likeCount;
            if (item._count) item._count = { ...item._count, likes: result.likeCount };
          }
        } catch (error) {
          const currentLiked = item.isLiked === true;
          const rolledBack = Math.max(0, (item.likeCount ?? 0) + (currentLiked ? -1 : 1));
          item.isLiked = !currentLiked;
          item.likeCount = rolledBack;
          if (item._count) item._count = { ...item._count, likes: rolledBack };
          console.error('Error toggling like:', error);
        }

        this.items.update((current) => [...current]);
      }
    } finally {
      state.likeSyncing = false;
      this.items.update((current) => [...current]);
    }
  }

  toggleBoardDropdown(item: Pin, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.canSaveItem(item)) {
      this.toast.error('Bạn cần mua tác phẩm trước khi lưu vào bộ sưu tập.');
      return;
    }
    if (this.activeDropdownPinId() === item.id) {
      this.closeBoardDropdown();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const dropdownWidth = 176;
    this.dropdownAnchor.set({
      top: rect.top,
      left: Math.min(rect.left, window.innerWidth - dropdownWidth - 12),
    });
    this.activeDropdownPinId.set(item.id);
  }

  closeBoardDropdown(): void {
    this.activeDropdownPinId.set(null);
    this.dropdownAnchor.set(null);
  }

  selectBoardForPin(pinId: string, board: Board, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedBoardMap.update((current) => ({ ...current, [pinId]: board }));
    this.closeBoardDropdown();
  }

  getSelectedBoardName(pinId: string): string {
    const selected = this.selectedBoardMap()[pinId];
    if (selected) return selected.name;
    const list = this.boards();
    return list.length > 0 ? list[0].name : 'Lưu vào';
  }

  saveItemToBoard(item: Pin, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.canSaveItem(item)) {
      this.toast.error('Bạn cần mua tác phẩm trước khi lưu vào bộ sưu tập.');
      return;
    }
    void this.performSaveToBoard(item.id);
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
          token,
        );
        this.boards.update((current) => [newBoard, ...current]);
        boardId = newBoard.id;
      }

      await this.boardService.addPinToBoard(boardId, pinId, token);
      this.toast.success('Đã lưu vào bộ sưu tập.');
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Không thể lưu vào bộ sưu tập.', {
        action: { label: 'Thử lại', onClick: () => this.performSaveToBoard(pinId) },
      });
    }
  }
}
