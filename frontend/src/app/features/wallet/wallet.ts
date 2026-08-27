import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Icon } from '../../shared/icon/icon';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';
import { BillingService, PackCode, CreditTxnType, PayoutInfo } from '../../core/services/billing';

@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, Icon],
  templateUrl: './wallet.html',
  styleUrl: './wallet.css',
})
export class Wallet implements OnInit {
  public billing = inject(BillingService);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  public packs = this.billing.creditPacks;
  public buyingCode = signal<PackCode | null>(null);
  public flipped = signal(false);

  flip() {
    this.flipped.update((v) => !v);
  }

  get holderName(): string {
    const u = this.supabase.dbUser();
    const meta = this.supabase.user()?.user_metadata;
    const name = u?.username || meta?.['full_name'] || meta?.['name'] || 'PINHUB MEMBER';
    return String(name).toUpperCase();
  }

  // ── Rút tiền ────────────────────────────────────────────────────────────────
  private toast = inject(ToastService);
  private confirmService = inject(ConfirmService);

  public payout = signal<PayoutInfo | null>(null);
  public showPayoutForm = signal(false);
  public payoutBusy = signal(false);
  public payoutError = signal<string | null>(null);

  public payoutCredits = 0;
  public payoutBank = '';
  public payoutAccount = '';
  public payoutName = '';

  async ngOnInit() {
    await this.billing.refreshMe();
    await this.loadPayout();
  }

  private async loadPayout() {
    const info = await this.billing.getPayoutInfo();
    this.payout.set(info);
    // Mặc định điền sẵn mức tối thiểu để người dùng đỡ phải gõ.
    if (info && this.payoutCredits === 0) {
      this.payoutCredits = Math.min(info.balance, Math.max(info.minCredits, 0));
    }
  }

  payoutAmountVnd(vndPerCredit: number): number {
    const n = Math.floor(Number(this.payoutCredits) || 0);
    return Math.max(0, n) * vndPerCredit;
  }

  closePayoutForm() {
    this.showPayoutForm.set(false);
    this.payoutError.set(null);
  }

  async submitPayout(info: PayoutInfo) {
    const credits = Math.floor(Number(this.payoutCredits) || 0);
    this.payoutError.set(null);

    // Chặn sớm ở client cho phản hồi nhanh; backend vẫn kiểm tra lại độc lập.
    if (credits < info.minCredits) {
      this.payoutError.set(`Rút tối thiểu ${info.minCredits} credit.`);
      return;
    }
    if (credits > info.balance) {
      this.payoutError.set('Số credit rút vượt quá số dư trong ví.');
      return;
    }
    if (!this.payoutBank.trim() || !this.payoutAccount.trim() || !this.payoutName.trim()) {
      this.payoutError.set('Vui lòng nhập đủ thông tin ngân hàng.');
      return;
    }

    const ok = await this.confirmService.ask(
      `Rút ${credits} credit (${this.billing.formatVnd(credits * info.vndPerCredit)}) về ` +
        `${this.payoutBank.trim()} — ${this.payoutAccount.trim()}?`,
      { title: 'Xác nhận rút tiền', confirmLabel: 'Gửi yêu cầu' },
    );
    if (!ok) return;

    this.payoutBusy.set(true);
    try {
      const err = await this.billing.requestPayout({
        credits,
        bankName: this.payoutBank.trim(),
        accountNumber: this.payoutAccount.trim(),
        accountName: this.payoutName.trim(),
      });
      if (err) {
        this.payoutError.set(err);
        return;
      }
      this.toast.success('Đã gửi yêu cầu rút tiền. Đội ngũ sẽ xử lý trong 1–3 ngày làm việc.');
      this.closePayoutForm();
      await this.loadPayout();
    } finally {
      this.payoutBusy.set(false);
    }
  }

  async cancelPayout(id: string) {
    const ok = await this.confirmService.ask(
      'Huỷ yêu cầu rút tiền này? Credit sẽ được hoàn lại ví của bạn.',
      { title: 'Huỷ yêu cầu', confirmLabel: 'Huỷ yêu cầu', danger: true },
    );
    if (!ok) return;

    this.payoutBusy.set(true);
    try {
      const done = await this.billing.cancelPayout(id);
      if (done) {
        this.toast.success('Đã huỷ. Credit được hoàn lại ví.');
        await this.loadPayout();
      } else {
        this.toast.error('Không huỷ được yêu cầu.');
      }
    } finally {
      this.payoutBusy.set(false);
    }
  }

  payoutStatusLabel(s: string): string {
    switch (s) {
      case 'PENDING': return 'Chờ duyệt';
      case 'APPROVED': return 'Đã duyệt';
      case 'PAID': return 'Đã chuyển';
      case 'REJECTED': return 'Từ chối';
      default: return s;
    }
  }

  payoutStatusClass(s: string): string {
    switch (s) {
      case 'PAID': return 'payout-status-paid';
      case 'REJECTED': return 'payout-status-rejected';
      case 'APPROVED': return 'payout-status-approved';
      default: return 'payout-status-pending';
    }
  }

  async buy(code: PackCode) {
    this.buyingCode.set(code);
    try {
      const url = await this.billing.startBuyCredits(code);
      this.router.navigateByUrl(url);
    } finally {
      this.buyingCode.set(null);
    }
  }

  goPro() { this.router.navigate(['/pro']); }

  txnIcon(type: CreditTxnType): string {
    switch (type) {
      case 'PURCHASE': return 'wallet';
      case 'MONTHLY_GRANT': return 'spark';
      case 'SPEND_DOWNLOAD': return 'download';
      case 'EARN_SALE': return 'coin';
      case 'REFUND': return 'sync';
      default: return 'coin';
    }
  }

  txnLabel(type: CreditTxnType): string {
    switch (type) {
      case 'PURCHASE': return 'Nạp credit';
      case 'MONTHLY_GRANT': return 'Credit tặng';
      case 'SPEND_DOWNLOAD': return 'Tải ảnh Premium';
      case 'EARN_SALE': return 'Bán ảnh';
      case 'REFUND': return 'Hoàn credit';
      default: return 'Giao dịch';
    }
  }
}
