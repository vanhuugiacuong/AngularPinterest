import { Component, OnDestroy, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { LikeButton } from '../../shared/like-button/like-button';
import {
  AuctionService,
  AuctionListItem,
  AuctionListStatusFilter,
} from '../../core/services/auction';
import { PinService } from '../../core/services/pin';
import { BoardService, Board } from '../../core/services/board';
import { MembershipService } from '../../core/services/membership';
import { SupabaseService } from '../../core/services/supabase';
import { DialogService } from '../../core/services/dialog';
import { ToastService } from '../../core/services/toast';
import { formatNovaToken, vndToNovaToken } from '../../core/utils/novatoken';

interface AuctionTab {
  key: AuctionListStatusFilter;
  label: string;
}

const TABS: AuctionTab[] = [
  { key: 'active', label: 'Đang diễn ra' },
  { key: 'scheduled', label: 'Sắp diễn ra' },
  { key: 'ended', label: 'Đã kết thúc' },
];

const TAKE = 24;

@Component({
  selector: 'app-auctions',
  standalone: true,
  imports: [CommonModule, Navbar, UserAvatar, LikeButton],
  templateUrl: './auctions.html',
  styleUrl: './auctions.css',
})
export class Auctions implements OnInit, OnDestroy {
  private auctionService = inject(AuctionService);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private toast = inject(ToastService);
  public router = inject(Router);
  public membership = inject(MembershipService);
  public supabaseService = inject(SupabaseService);
  private dialogService = inject(DialogService);

  public readonly tabs = TABS;
  public readonly formatNovaToken = formatNovaToken;
  public readonly vndToNovaToken = vndToNovaToken;

  public activeTab = signal<AuctionListStatusFilter>('active');
  public items = signal<AuctionListItem[]>([]);
  public total = signal(0);
  public loading = signal(false);
  public loadingMore = signal(false);
  public loadError = signal<string | null>(null);
  public countdowns = signal<Record<string, string>>({});

  public readonly hasMore = computed(() => this.items().length < this.total());

  public readonly isPro = computed(() => this.membership.status()?.plan === 'PRO');

  /** Bảng chọn bộ sưu tập — cùng mẫu portal-positioned dropdown như
   * home.ts (dropdownAnchor tính từ getBoundingClientRect của nút bấm),
   * vì thẻ lưới đấu giá có overflow-hidden riêng nên dropdown lồng bên
   * trong sẽ bị cắt mất nếu cao hơn phần còn lại phía trên. */
  public boards = signal<Board[]>([]);
  public activeDropdownPinId = signal<string | null>(null);
  public dropdownAnchor = signal<{ top: number; left: number } | null>(null);
  public readonly activeDropdownItem = computed(() => {
    const pinId = this.activeDropdownPinId();
    if (!pinId) return null;
    return this.items().find((item) => item.pin.id === pinId) ?? null;
  });
  public selectedBoardMap = signal<Record<string, Board>>({});

  private serverTimeOffsetMs = 0;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private skip = 0;

  ngOnInit(): void {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    void this.loadBoards();
    void this.loadTab('active');
  }

  ngOnDestroy(): void {
    this.stopCountdownTicker();
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

  selectTab(tab: AuctionListStatusFilter): void {
    if (tab === this.activeTab()) return;
    void this.loadTab(tab);
  }

  private async loadTab(tab: AuctionListStatusFilter): Promise<void> {
    this.activeTab.set(tab);
    this.skip = 0;
    this.items.set([]);
    this.total.set(0);
    this.loadError.set(null);
    this.loading.set(true);
    this.stopCountdownTicker();
    try {
      const result = await this.auctionService.listAuctions(tab, 0, TAKE);
      this.items.set(result.items);
      this.total.set(result.total);
      this.skip = result.items.length;
      this.applyServerTimeOffset(result.serverNow);
      this.startCountdownTicker();
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Không thể tải danh sách đấu giá.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    try {
      const result = await this.auctionService.listAuctions(this.activeTab(), this.skip, TAKE);
      this.items.update((current) => [...current, ...result.items]);
      this.total.set(result.total);
      this.skip += result.items.length;
      this.applyServerTimeOffset(result.serverNow);
      this.updateCountdownLabels();
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Không thể tải thêm.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Đấu giá là tính năng chỉ dành cho Pro — khớp luật `canAuction` phía
   * backend (getAuction 403 với ai không phải Pro/chủ phiên). Đây chỉ là lớp
   * UX: ảnh đã được server tự làm mờ cho viewer không đủ điều kiện rồi.
   * Chủ phiên luôn xem được ảnh thật của chính mình (khớp resolveViewablePinImageUrl
   * phía backend), nên không áp lớp mờ/khóa cho chính họ dù chưa có Pro. */
  isRestricted(item: AuctionListItem): boolean {
    const userId = this.supabaseService.user()?.id;
    if (userId && item.seller.id === userId) return false;
    const plan = this.membership.status()?.plan ?? this.supabaseService.dbUser()?.plan;
    return plan !== 'PRO';
  }

  async onCardClick(item: AuctionListItem): Promise<void> {
    if (this.isRestricted(item)) {
      const goToPricing = await this.dialogService.confirm({
        variant: 'information',
        title: 'Cần gói Pro để xem đấu giá',
        description: 'Trang chi tiết và đặt giá của tác phẩm đấu giá chỉ dành cho thành viên Pro.',
        confirmLabel: 'Xem các gói',
        cancelLabel: 'Để sau',
      });
      if (goToPricing) this.router.navigate(['/pricing']);
      return;
    }
    this.router.navigate(['/auctions', item.id]);
  }

  statusLabel(item: AuctionListItem): string {
    switch (item.status) {
      case 'SCHEDULED':
        return 'Sắp diễn ra';
      case 'ACTIVE':
        return 'Đang diễn ra';
      case 'ENDED':
        return 'Đã kết thúc';
      default:
        return item.status;
    }
  }

  countdownFor(item: AuctionListItem): string {
    return this.countdowns()[item.id] ?? '';
  }

  private applyServerTimeOffset(serverNow: string): void {
    this.serverTimeOffsetMs = new Date(serverNow).getTime() - Date.now();
  }

  private startCountdownTicker(): void {
    this.updateCountdownLabels();
    this.countdownTimer = setInterval(() => this.updateCountdownLabels(), 1000);
  }

  private stopCountdownTicker(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = undefined;
    }
  }

  private updateCountdownLabels(): void {
    const nowMs = Date.now() + this.serverTimeOffsetMs;
    const next: Record<string, string> = {};
    for (const item of this.items()) {
      if (item.status === 'ENDED') continue;
      const target = item.status === 'SCHEDULED' ? new Date(item.startsAt) : new Date(item.endsAt);
      const diffMs = target.getTime() - nowMs;
      next[item.id] = diffMs <= 0 ? 'Sắp cập nhật…' : this.formatDuration(diffMs);
    }
    this.countdowns.set(next);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days}n ${hours}g`;
    if (hours > 0) return `${hours}g ${minutes}p`;
    if (minutes > 0) return `${minutes}p ${seconds}s`;
    return `${seconds}s`;
  }

  async toggleLike(item: AuctionListItem, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    const pin = item.pin;
    const previousLiked = pin.isLiked === true;
    const previousLikes = pin.likeCount ?? 0;
    pin.isLiked = !previousLiked;
    pin.likeCount = Math.max(0, previousLikes + (previousLiked ? -1 : 1));
    (pin as any).likeQueuedToggles = ((pin as any).likeQueuedToggles || 0) + 1;
    this.items.update((current) => [...current]);

    await this.flushLikeQueue(pin);
  }

  private async flushLikeQueue(pin: AuctionListItem['pin']): Promise<void> {
    const state = pin as any;
    if (state.likeSyncing) return;
    state.likeSyncing = true;

    try {
      while ((state.likeQueuedToggles || 0) > 0) {
        state.likeQueuedToggles--;

        try {
          const token = await this.supabaseService.getSessionToken();
          if (!token) throw new Error('Không tìm thấy phiên đăng nhập.');

          const result = await this.pinService.toggleLike(pin.id, token);
          if (state.likeQueuedToggles === 0) {
            pin.isLiked = result.liked;
            pin.likeCount = result.likeCount;
          }
        } catch (error) {
          const currentLiked = pin.isLiked === true;
          pin.isLiked = !currentLiked;
          pin.likeCount = Math.max(0, (pin.likeCount ?? 0) + (currentLiked ? -1 : 1));
          console.error('Error toggling like:', error);
        }

        this.items.update((current) => [...current]);
      }
    } finally {
      state.likeSyncing = false;
      this.items.update((current) => [...current]);
    }
  }

  toggleBoardDropdown(item: AuctionListItem, event: MouseEvent): void {
    event.stopPropagation();
    if (!item.canSave) {
      this.toast.error('Bạn cần thắng và thanh toán phiên đấu giá trước khi lưu vào bộ sưu tập.');
      return;
    }
    const pinId = item.pin.id;
    if (this.activeDropdownPinId() === pinId) {
      this.closeBoardDropdown();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const dropdownWidth = 176;
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

  saveItemToBoard(item: AuctionListItem, event: MouseEvent): void {
    event.stopPropagation();
    if (!item.canSave) {
      this.toast.error('Bạn cần thắng và thanh toán phiên đấu giá trước khi lưu vào bộ sưu tập.');
      return;
    }
    void this.performSaveToBoard(item.pin.id);
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
