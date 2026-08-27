import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { NovaTokenService, NovaTokenTopUp } from '../../core/services/novatoken';
import { ToastService } from '../../core/services/toast';
import { DialogService } from '../../core/services/dialog';

@Component({
  selector: 'app-novatoken-wallet',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, Navbar],
  templateUrl: './novatoken-wallet.html',
  styleUrls: ['./novatoken-wallet.css', './novatoken-wallet-dialog.css'],
})
export class NovaTokenWalletPage implements OnInit, OnDestroy {
  readonly tokens = inject(NovaTokenService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedTopUp = signal<NovaTokenTopUp | null>(null);
  readonly checking = signal(false);
  readonly qrSecondsLeft = signal(300);
  readonly qrExpired = signal(false);
  private paymentPoll?: ReturnType<typeof setInterval>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private reconciliationInFlight = false;

  async ngOnInit() {
    await this.loadWallet();
  }

  async retryLoad() {
    this.loading.set(true);
    await this.loadWallet();
  }

  private async loadWallet() {
    try {
      this.error.set(null);
      await this.tokens.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Không thể tải ví.');
    } finally {
      this.loading.set(false);
    }
  }

  async choosePackage(amount: number) {
    this.error.set(null);
    try {
      this.selectedTopUp.set(await this.tokens.createTopUp(amount));
      this.startAutomaticConfirmation();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Không thể tạo giao dịch nạp.');
    }
  }

  bankQr(topUp: NovaTokenTopUp): string {
    return `https://img.vietqr.io/image/MB-110605043105-compact2.png?amount=${Number(topUp.vndAmount)}&addInfo=${encodeURIComponent(topUp.paymentReference)}&accountName=NGUYEN%20DOAN%20PHUC`;
  }

  async checkPayment(silent = false) {
    const current = this.selectedTopUp();
    if (!current) return;
    if (this.reconciliationInFlight) {
      if (!silent) setTimeout(() => void this.checkPayment(false), 350);
      return;
    }
    this.reconciliationInFlight = true;
    if (!silent) {
      this.checking.set(true);
      this.error.set(null);
    }
    try {
      const latest = await this.tokens.getTopUp(current.id);
      this.selectedTopUp.set(latest);
      if (latest.status === 'PAID') {
        this.stopAutomaticConfirmation();
        await this.tokens.load();
        if (!silent) this.toast.success('Nạp tiền thành công!');
      } else if (!silent) {
        this.stopAutomaticConfirmation();
        this.selectedTopUp.set(null);
        void this.dialog.confirm({
          variant: 'warning',
          title: 'Giao dịch chưa được thanh toán',
          description:
            'Hệ thống chưa ghi nhận khoản chuyển tiền của bạn. Vui lòng kiểm tra lại và thử nạp lần nữa.',
          confirmLabel: 'Đóng thông báo',
        });
      }
    } catch (error) {
      if (!silent)
        this.toast.error(error instanceof Error ? error.message : 'Không thể kiểm tra giao dịch.');
    } finally {
      this.reconciliationInFlight = false;
      if (!silent) this.checking.set(false);
    }
  }

  private startAutomaticConfirmation() {
    this.stopAutomaticConfirmation();
    this.updateCountdown();
    void this.checkPayment(true);
    this.paymentPoll = setInterval(() => void this.checkPayment(true), 3_000);
    this.countdownTimer = setInterval(() => this.updateCountdown(), 1_000);
  }

  private updateCountdown() {
    const topUp = this.selectedTopUp();
    if (!topUp) return;
    const seconds = Math.max(
      0,
      Math.ceil((new Date(topUp.createdAt).getTime() + 300_000 - Date.now()) / 1000),
    );
    this.qrSecondsLeft.set(seconds);
    this.qrExpired.set(seconds === 0);
    if (seconds === 0) this.stopAutomaticConfirmation();
  }

  qrCountdown(): string {
    const seconds = this.qrSecondsLeft();
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private stopAutomaticConfirmation() {
    if (this.paymentPoll) clearInterval(this.paymentPoll);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.paymentPoll = undefined;
    this.countdownTimer = undefined;
  }

  ngOnDestroy() {
    this.stopAutomaticConfirmation();
  }

  entrySign(amount: string) {
    return Number(amount) > 0 ? '+' : '';
  }
  closeTopUp() {
    if (!this.checking()) {
      this.stopAutomaticConfirmation();
      this.selectedTopUp.set(null);
    }
  }
}
