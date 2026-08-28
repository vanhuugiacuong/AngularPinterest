import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Navbar } from '../../../components/navbar/navbar';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { MoneyInput } from '../../../shared/money-input/money-input';
import { AuctionService, AuctionDetail } from '../../../core/services/auction';
import { MembershipService } from '../../../core/services/membership';
import { SupabaseService } from '../../../core/services/supabase';
import { DialogService } from '../../../core/services/dialog';
import { ToastService } from '../../../core/services/toast';
import { API_BASE_URL } from '../../../core/api-base';
import { formatNovaToken, vndToNovaToken } from '../../../core/utils/novatoken';

const MAX_BID_AMOUNT = 9_999_999_999;

@Component({
  selector: 'app-auction-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, Navbar, UserAvatar, MoneyInput],
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

  private auctionId = '';
  private serverTimeOffsetMs = 0;
  private pollTimer?: ReturnType<typeof setInterval>;
  private countdownTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.auctionId = id;
      void this.loadAuction();
    });
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
