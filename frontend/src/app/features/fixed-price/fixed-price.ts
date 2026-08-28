import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { PinService, Pin } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { MembershipService } from '../../core/services/membership';
import { DialogService } from '../../core/services/dialog';
import { formatNovaToken, vndToNovaToken } from '../../core/utils/novatoken';

const TAKE = 24;

@Component({
  selector: 'app-fixed-price',
  standalone: true,
  imports: [CommonModule, Navbar, UserAvatar],
  templateUrl: './fixed-price.html',
  styleUrl: './fixed-price.css',
})
export class FixedPrice implements OnInit {
  private pinService = inject(PinService);
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

  private skip = 0;

  async ngOnInit(): Promise<void> {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    await this.loadFirstPage();
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
}
