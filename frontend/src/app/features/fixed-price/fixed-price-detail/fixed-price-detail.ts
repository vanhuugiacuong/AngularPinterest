import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Navbar } from '../../../components/navbar/navbar';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { PinService, Pin } from '../../../core/services/pin';
import { MembershipService } from '../../../core/services/membership';
import { SupabaseService } from '../../../core/services/supabase';
import { DialogService } from '../../../core/services/dialog';
import { NovaTokenService } from '../../../core/services/novatoken';
import { API_BASE_URL } from '../../../core/api-base';
import { formatNovaToken, vndToNovaToken } from '../../../core/utils/novatoken';

/** Phải khớp chính xác với thông báo ForbiddenException của
 * PinsService.getPinById ở backend, để phân biệt "cần nâng cấp gói" với các
 * lỗi tải khác (404, mất mạng...). */
const FIXED_PRICE_REQUIRED_MESSAGE =
  'Chỉ thành viên Plus hoặc Pro mới có thể xem chi tiết tác phẩm bán giá cố định.';

@Component({
  selector: 'app-fixed-price-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, Navbar, UserAvatar],
  templateUrl: './fixed-price-detail.html',
  styleUrl: './fixed-price-detail.css',
})
export class FixedPriceDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private pinService = inject(PinService);
  private dialogService = inject(DialogService);
  private novaTokens = inject(NovaTokenService);
  public membership = inject(MembershipService);
  public supabaseService = inject(SupabaseService);

  public readonly formatNovaToken = formatNovaToken;
  public readonly vndToNovaToken = vndToNovaToken;

  public pin = signal<Pin | null>(null);
  public loading = signal(true);
  public error = signal<string | null>(null);

  public buying = signal(false);
  public downloading = signal(false);
  public downloadMessage = signal<string | null>(null);

  private pinId = '';

  ngOnInit(): void {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.pinId = id;
      void this.loadPin();
    });
  }

  goBack(): void {
    this.location.back();
  }

  private async loadPin(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const token = await this.supabaseService.getSessionToken();
      const pin = await this.pinService.getPinById(this.pinId, token ?? undefined);
      this.pin.set(pin);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Không thể tải tác phẩm này.');
    } finally {
      this.loading.set(false);
    }
  }

  isRestricted(): boolean {
    return this.error() === FIXED_PRICE_REQUIRED_MESSAGE;
  }

  isOwner(): boolean {
    const p = this.pin();
    const userId = this.supabaseService.user()?.id;
    return !!p && !!userId && p.userId === userId;
  }

  needsPurchase(): boolean {
    const p = this.pin();
    if (!p) return false;
    return !!p.isForSale && !this.isOwner() && !p.hasPurchased;
  }

  goToPricing(): void {
    this.router.navigate(['/pricing']);
  }

  async buyNow(): Promise<void> {
    const p = this.pin();
    if (!p || this.buying()) return;

    const confirmed = await this.dialogService.confirm({
      variant: 'confirm',
      title: 'Xác nhận mua tác phẩm',
      description: `Bạn sắp mua "${p.title}" với giá ${formatNovaToken(vndToNovaToken(p.price))}. Số tiền sẽ được trừ ngay từ ví của bạn và không thể hoàn lại.`,
      confirmLabel: 'Mua ngay',
      cancelLabel: 'Hủy',
    });
    if (!confirmed) return;

    this.buying.set(true);
    try {
      await this.novaTokens.purchase(p.id);
      this.pin.set({ ...p, hasPurchased: true });
      await this.downloadOriginal();
    } catch (e) {
      this.downloadMessage.set(e instanceof Error ? e.message : 'Không thể hoàn tất giao dịch.');
    } finally {
      this.buying.set(false);
    }
  }

  async downloadOriginal(): Promise<void> {
    const p = this.pin();
    if (!p || this.downloading()) return;
    this.downloadMessage.set('Đang chuẩn bị ảnh...');
    this.downloading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      const response = await fetch(`${API_BASE_URL}/api/memberships/pins/${p.id}/download`, {
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
      anchor.download = `${p.title || 'novaframe'}.jpg`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.downloadMessage.set('Đã tải ảnh.');
    } catch (e) {
      this.downloadMessage.set(e instanceof Error ? e.message : 'Không thể tải ảnh.');
    } finally {
      this.downloading.set(false);
    }
  }
}
