import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import {
  AuctionService,
  AuctionListItem,
  AuctionListStatusFilter,
} from '../../core/services/auction';
import { MembershipService } from '../../core/services/membership';
import { SupabaseService } from '../../core/services/supabase';
import { DialogService } from '../../core/services/dialog';
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
  imports: [CommonModule, Navbar, UserAvatar],
  templateUrl: './auctions.html',
  styleUrl: './auctions.css',
})
export class Auctions implements OnInit, OnDestroy {
  private auctionService = inject(AuctionService);
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

  private serverTimeOffsetMs = 0;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private skip = 0;

  ngOnInit(): void {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    void this.loadTab('active');
  }

  ngOnDestroy(): void {
    this.stopCountdownTicker();
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
}
