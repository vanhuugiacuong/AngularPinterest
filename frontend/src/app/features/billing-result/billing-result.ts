import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { BillingService, QR_EXPIRE_MS } from '../../core/services/billing';
import { ToastService } from '../../core/services/toast';

type Phase = 'qr' | 'success' | 'failed' | 'expired';

@Component({
  selector: 'app-billing-result',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './billing-result.html',
  styleUrl: './billing-result.css',
})
export class BillingResult implements OnInit, OnDestroy {
  public billing = inject(BillingService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);

  public phase = signal<Phase>('qr');
  public ref = '';
  public pending = signal(this.billing.peekPending());
  public qrUrl = signal<string>('');
  public remainingMs = signal<number>(QR_EXPIRE_MS);
  public detecting = signal<boolean>(true);

  private pollTimer: any = null;
  private countdownTimer: any = null;

  ngOnInit() {
    this.ref = this.route.snapshot.queryParamMap.get('ref') || '';
    const p = this.billing.peekPending();
    this.pending.set(p);

    if (!p || p.txnRef !== this.ref) {
      this.phase.set('expired');
      return;
    }

    this.qrUrl.set(this.billing.qrImageUrl(p));
    this.tickCountdown();

    // Dò trạng thái tự động mỗi 3 giây (mô phỏng webhook đối soát ngân hàng).
    this.pollTimer = setInterval(() => this.poll(), 3000);
    this.countdownTimer = setInterval(() => this.tickCountdown(), 1000);
  }

  ngOnDestroy() {
    this.stopTimers();
  }

  private stopTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.pollTimer = null;
    this.countdownTimer = null;
  }

  private async poll() {
    const status = await this.billing.checkPaymentStatus(this.ref);
    if (status === 'PAID') {
      this.stopTimers();
      this.phase.set('success');
    } else if (status === 'EXPIRED') {
      this.stopTimers();
      this.phase.set('expired');
    }
  }

  private tickCountdown() {
    const p = this.pending();
    if (!p) return;
    const left = p.createdAtMs + QR_EXPIRE_MS - Date.now();
    this.remainingMs.set(Math.max(0, left));
    if (left <= 0) {
      this.stopTimers();
      this.phase.set('expired');
    }
  }

  get countdown(): string {
    const total = Math.ceil(this.remainingMs() / 1000);
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  get isPro() {
    return this.pending()?.purpose === 'PRO_SUB';
  }

  get title() {
    const p = this.pending();
    if (!p) return '';
    if (p.purpose === 'PRO_SUB') return p.planCode === 'YEARLY' ? 'PinHub Pro (năm)' : 'PinHub Pro (tháng)';
    return `${p.credits} credit`;
  }

  // Nút "Tôi đã chuyển khoản": bản thật chỉ dò lại; bản mô phỏng cộng luôn.
  public checking = signal(false);
  async confirmNow() {
    this.checking.set(true);
    try {
      const paid = await this.billing.confirmNow(this.ref);
      if (paid) {
        this.stopTimers();
        this.phase.set('success');
      } else {
        this.toast.info('Chưa nhận được thanh toán. Vui lòng đợi hệ thống xác nhận sau khi bạn chuyển khoản.');
      }
    } finally {
      this.checking.set(false);
    }
  }

  cancel() {
    this.billing.completePending(this.ref, false);
    this.stopTimers();
    this.phase.set('failed');
  }

  copyMemo() {
    const memo = this.pending()?.memo;
    if (!memo) return;
    navigator.clipboard?.writeText(memo).then(
      () => this.toast.success('Đã sao chép nội dung chuyển khoản'),
      () => {},
    );
  }

  goPro() { this.router.navigate(['/pro']); }
  goWallet() { this.router.navigate(['/wallet']); }
  goFeed() { this.router.navigate(['/feed']); }
}
