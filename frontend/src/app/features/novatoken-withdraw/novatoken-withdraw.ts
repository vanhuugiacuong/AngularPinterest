import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { NovaTokenService } from '../../core/services/novatoken';
import { ToastService } from '../../core/services/toast';
import { DialogService } from '../../core/services/dialog';

const QUICK_PERCENTS = [25, 50, 100] as const;

@Component({
  selector: 'app-novatoken-withdraw',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, Navbar],
  templateUrl: './novatoken-withdraw.html',
  styleUrl: './novatoken-withdraw.css',
})
export class NovaTokenWithdrawPage implements OnInit {
  readonly tokens = inject(NovaTokenService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly quickPercents = QUICK_PERCENTS;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly withdrawing = signal(false);
  readonly withdrawalMessage = signal('');
  withdrawalAmount: number | null = null;

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

  selectQuickAmount(percent: number) {
    const wallet = this.tokens.wallet();
    if (!wallet) return;
    const available = Number(wallet.withdrawableBalance);
    const raw = Math.floor(((available * percent) / 100) / 1000) * 1000;
    this.withdrawalAmount = Math.max(10_000, Math.min(raw || available, available));
  }

  async submitDemoWithdrawal() {
    const wallet = this.tokens.wallet();
    const amount = Number(this.withdrawalAmount);
    this.withdrawalMessage.set('');
    if (!wallet?.payoutAccount) {
      this.withdrawalMessage.set('Hãy cấu hình tài khoản nhận tiền trong Cài đặt trước.');
      return;
    }
    if (!Number.isSafeInteger(amount) || amount < 10_000) {
      this.withdrawalMessage.set('Số tiền rút thử tối thiểu là 10.000đ.');
      return;
    }
    if (amount > Number(wallet.withdrawableBalance)) {
      this.withdrawalMessage.set('Số tiền vượt quá doanh thu có thể rút thử.');
      return;
    }
    const confirmed = await this.dialog.confirm({
      variant: 'warning',
      title: 'Xác nhận rút tiền mô phỏng',
      description: `Đây chỉ là bản demo. Hệ thống sẽ trừ ${amount.toLocaleString('vi-VN')}đ khỏi số dư thử nghiệm nhưng không chuyển tiền thật tới ngân hàng.`,
      confirmLabel: 'Chạy thử rút tiền',
      cancelLabel: 'Hủy',
    });
    if (!confirmed) return;
    this.withdrawing.set(true);
    try {
      await this.tokens.createDemoWithdrawal(amount);
      this.withdrawalAmount = null;
      this.withdrawalMessage.set(
        'Đã hoàn tất mô phỏng. Không có tiền thật được chuyển qua ngân hàng.',
      );
      this.toast.success('Rút tiền mô phỏng thành công!');
    } catch (error) {
      this.withdrawalMessage.set(
        error instanceof Error ? error.message : 'Không thể tạo yêu cầu rút thử.',
      );
    } finally {
      this.withdrawing.set(false);
    }
  }
}
