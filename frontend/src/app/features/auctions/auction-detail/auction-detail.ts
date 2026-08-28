import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Navbar } from '../../../components/navbar/navbar';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { CurrencyInputDirective } from '../../../shared/currency-input.directive';
import { AuctionService, AuctionDetail } from '../../../core/services/auction';
import { MembershipService } from '../../../core/services/membership';
import { SupabaseService } from '../../../core/services/supabase';
import { DialogService } from '../../../core/services/dialog';
import { ToastService } from '../../../core/services/toast';
import { BoardService, Board } from '../../../core/services/board';
import { API_BASE_URL } from '../../../core/api-base';
import { formatNovaToken, vndToNovaToken } from '../../../core/utils/novatoken';

const MAX_BID_AMOUNT = 9_999_999_999;

@Component({
  selector: 'app-auction-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, Navbar, UserAvatar, CurrencyInputDirective],
  templateUrl: './auction-detail.html',
  styleUrl: './auction-detail.css',
})
export class AuctionDetailPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private auctionService = inject(AuctionService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private boardService = inject(BoardService);
  public membership = inject(MembershipService);
  public supabaseService = inject(SupabaseService);

  public readonly formatNovaToken = formatNovaToken;
  public readonly vndToNovaToken = vndToNovaToken;
  public readonly maxBidAmount = MAX_BID_AMOUNT;

  public auction = signal<AuctionDetail | null>(null);
  public loading = signal(true);
  public error = signal<string | null>(null);
  public countdownLabel = signal('');

  public bidAmount: number | null = null;
  public bidSubmitting = signal(false);
  public bidError = signal<string | null>(null);
  public bidSuccessMessage = signal<string | null>(null);

  public cancelling = signal(false);
  public downloading = signal(false);
  public downloadMessage = signal<string | null>(null);

  public boards = signal<Board[]>([]);
  public showBoardDropdown = signal(false);
  public selectedBoard = signal<Board | null>(null);
  public saving = signal(false);

  private auctionId = '';
  private serverTimeOffsetMs = 0;
  private pollTimer?: ReturnType<typeof setInterval>;
  private countdownTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    void this.loadBoards();
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.auctionId = id;
      void this.loadAuction();
    });
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

  ngOnDestroy(): void {
    this.clearPolling();
    this.stopCountdownTicker();
  }

  goBack(): void {
    this.location.back();
  }

  private async loadAuction(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.auctionService.getById(this.auctionId);
      this.auction.set(detail);
      this.applyServerTimeOffset(detail.serverNow);
      this.schedulePolling();
      this.startCountdownTicker();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Không thể tải thông tin đấu giá.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshAuction(): Promise<void> {
    const current = this.auction();
    if (!current) return;
    try {
      const detail = await this.auctionService.getById(current.id);
      this.auction.set(detail);
      this.applyServerTimeOffset(detail.serverNow);
      if (detail.status !== 'ACTIVE') this.clearPolling();
    } catch {
      // Giữ dữ liệu cũ nếu lần refresh nền thất bại — không phá UI vì lỗi thoáng qua.
    }
  }

  private applyServerTimeOffset(serverNow: string): void {
    this.serverTimeOffsetMs = new Date(serverNow).getTime() - Date.now();
  }

  private schedulePolling(): void {
    this.clearPolling();
    const a = this.auction();
    if (!a || (a.status !== 'ACTIVE' && a.status !== 'SCHEDULED')) return;
    this.pollTimer = setInterval(() => void this.refreshAuction(), 15000);
  }

  private clearPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private startCountdownTicker(): void {
    if (this.countdownTimer) return;
    this.updateCountdownLabel();
    this.countdownTimer = setInterval(() => this.updateCountdownLabel(), 1000);
  }

  private stopCountdownTicker(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = undefined;
    }
    this.countdownLabel.set('');
  }

  private updateCountdownLabel(): void {
    const a = this.auction();
    if (!a || (a.status !== 'ACTIVE' && a.status !== 'SCHEDULED')) {
      this.countdownLabel.set('');
      this.stopCountdownTicker();
      return;
    }
    const nowMs = Date.now() + this.serverTimeOffsetMs;
    const target = a.status === 'SCHEDULED' ? new Date(a.startsAt) : new Date(a.endsAt);
    const diffMs = target.getTime() - nowMs;
    if (diffMs <= 0) {
      this.countdownLabel.set(a.status === 'SCHEDULED' ? 'Sắp bắt đầu' : 'Đang kết thúc…');
      return;
    }
    this.countdownLabel.set(this.formatDuration(diffMs));
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days} ngày ${hours} giờ`;
    if (hours > 0) return `${hours} giờ ${minutes} phút`;
    if (minutes > 0) return `${minutes} phút ${seconds} giây`;
    return `${seconds} giây`;
  }

  minAcceptableBid(): number {
    const a = this.auction();
    if (!a) return 0;
    return a.bidCount === 0 ? Number(a.startingPrice) : Number(a.currentPrice) + Number(a.minimumIncrement);
  }

  minAcceptableBidLabel(): string {
    return formatNovaToken(vndToNovaToken(this.minAcceptableBid()));
  }

  isOwner(): boolean {
    const a = this.auction();
    const userId = this.supabaseService.user()?.id;
    return !!a && !!userId && a.sellerId === userId;
  }

  canPlaceBid(): boolean {
    const a = this.auction();
    if (!a || a.status !== 'ACTIVE') return false;
    if (this.isOwner()) return false;
    return this.membership.status()?.plan === 'PRO';
  }

  canCancel(): boolean {
    const a = this.auction();
    return !!a && this.isOwner() && a.bidCount === 0 && (a.status === 'SCHEDULED' || a.status === 'ACTIVE');
  }

  statusLabel(): string {
    const a = this.auction();
    if (!a) return '';
    switch (a.status) {
      case 'SCHEDULED': return 'Sắp diễn ra';
      case 'ACTIVE': return 'Đang diễn ra';
      case 'ENDED': return 'Đã kết thúc';
      case 'CANCELLED': return 'Đã hủy';
      default: return a.status;
    }
  }

  goToPricing(): void {
    this.router.navigate(['/pricing']);
  }

  /** Chỉ chủ sở hữu, hoặc người đấu giá THẮNG và đã thanh toán thật sự (auction
   * ENDED, đúng winnerId, myPurchase đã PAID) mới được lưu vào bộ sưu tập —
   * mọi người khác thì không, kể cả khi họ từng đặt giá. */
  canSave(): boolean {
    const a = this.auction();
    if (!a) return false;
    if (this.isOwner()) return true;
    const userId = this.supabaseService.user()?.id;
    return a.status === 'ENDED' && a.winnerId === userId && a.myPurchase?.status === 'PAID';
  }

  toggleBoardDropdown(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.canSave()) {
      this.toastService.error('Bạn cần thắng và thanh toán phiên đấu giá trước khi lưu vào bộ sưu tập.');
      return;
    }
    this.showBoardDropdown.update((v) => !v);
  }

  selectBoard(board: Board, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedBoard.set(board);
    this.showBoardDropdown.set(false);
  }

  getSelectedBoardName(): string {
    const active = this.selectedBoard();
    if (active) return active.name;
    const list = this.boards();
    return list.length > 0 ? list[0].name : 'Lưu vào';
  }

  async saveToBoard(): Promise<void> {
    const a = this.auction();
    if (!a || this.saving()) return;
    if (!this.canSave()) {
      this.toastService.error('Bạn cần thắng và thanh toán phiên đấu giá trước khi lưu vào bộ sưu tập.');
      return;
    }

    this.saving.set(true);
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

      await this.boardService.addPinToBoard(boardId, a.pin.id, token);
      this.toastService.success('Đã lưu vào bộ sưu tập.');
    } catch (e) {
      this.toastService.error(e instanceof Error ? e.message : 'Không thể lưu vào bộ sưu tập.');
    } finally {
      this.saving.set(false);
    }
  }

  async submitBid(): Promise<void> {
    const a = this.auction();
    if (!a || this.bidSubmitting()) return;
    this.bidError.set(null);
    this.bidSuccessMessage.set(null);

    const amount = this.bidAmount;
    const minTokens = vndToNovaToken(this.minAcceptableBid());
    if (!amount || !Number.isInteger(amount) || amount < minTokens) {
      this.bidError.set(`Giá đặt phải là số tiền VND nguyên, tối thiểu ${formatNovaToken(minTokens)}.`);
      return;
    }
    if (amount > MAX_BID_AMOUNT) {
      this.bidError.set(`Giá đặt không được vượt quá ${formatNovaToken(MAX_BID_AMOUNT)}.`);
      return;
    }

    this.bidSubmitting.set(true);
    try {
      const requestKey = crypto.randomUUID();
      const updated = await this.auctionService.placeBid(a.id, amount, requestKey);
      this.auction.set(updated);
      this.applyServerTimeOffset(updated.serverNow);
      this.bidAmount = null;
      this.bidSuccessMessage.set(`${formatNovaToken(amount)} đã được giữ an toàn cho lượt đặt giá.`);
      this.schedulePolling();
    } catch (e) {
      this.bidError.set(e instanceof Error ? e.message : 'Không thể đặt giá lúc này. Vui lòng thử lại.');
    } finally {
      this.bidSubmitting.set(false);
    }
  }

  async cancelAuction(): Promise<void> {
    const a = this.auction();
    if (!a || this.cancelling()) return;
    const confirmed = await this.dialogService.confirm({
      variant: 'destructive',
      title: 'Hủy phiên đấu giá?',
      description: 'Phiên chưa có lượt đặt giá nào nên có thể hủy an toàn. Hành động này không thể hoàn tác.',
      confirmLabel: 'Hủy phiên đấu giá',
      cancelLabel: 'Giữ lại',
    });
    if (!confirmed) return;

    this.cancelling.set(true);
    try {
      const updated = await this.auctionService.cancel(a.id);
      this.auction.set(updated);
      this.toastService.success('Đã hủy phiên đấu giá.');
    } catch (e) {
      this.toastService.error(e instanceof Error ? e.message : 'Không thể hủy phiên đấu giá.');
    } finally {
      this.cancelling.set(false);
    }
  }

  async downloadOriginal(): Promise<void> {
    const a = this.auction();
    if (!a || this.downloading()) return;
    this.downloadMessage.set('Đang chuẩn bị ảnh...');
    this.downloading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      const response = await fetch(`${API_BASE_URL}/api/memberships/pins/${a.pin.id}/download`, {
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
      anchor.download = `${a.pin.title || 'novaframe'}.jpg`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.downloadMessage.set('Đã tải ảnh.');
    } catch (e) {
      this.downloadMessage.set(e instanceof Error ? e.message : 'Không thể tải ảnh.');
    } finally {
      this.downloading.set(false);
    }
  }

  getTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Vừa xong';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} phút trước`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} giờ trước`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} ngày trước`;
  }
}
