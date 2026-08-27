import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Navbar } from '../../components/navbar/navbar';
import {
  MembershipPlan,
  MembershipPayment,
  MembershipService,
} from '../../core/services/membership';
import { DialogService } from '../../core/services/dialog';
type PaidPlan = 'PLUS' | 'PRO';
type PaymentMethod = 'bank' | 'momo' | 'card';
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './pricing.html',
  styleUrls: ['./pricing.css', './payment-feedback.css'],
})
export class Pricing implements OnInit, OnDestroy {
  membership = inject(MembershipService);
  private dialogService = inject(DialogService);
  selectedPlan = signal<PaidPlan | null>(null);
  method = signal<PaymentMethod>('bank');
  processing = signal(false);
  message = signal('');
  fieldErrors = signal<Record<string, string>>({});
  membershipLoading = signal(true);
  membershipLoadError = signal('');
  currentPayment = signal<MembershipPayment | null>(null);
  paymentLoading = signal(false);
  cardNumber = '';
  cardName = '';
  expiry = '';
  cvv = '';
  private checkoutReturnFocus: HTMLElement | null = null;
  private automaticPaymentTimer?: ReturnType<typeof setInterval>;
  private paymentCountdownTimer?: ReturnType<typeof setInterval>;
  private automaticCheckInFlight = false;
  readonly qrSecondsLeft = signal(300);
  readonly qrExpired = signal(false);
  readonly plans = [
    {
      id: 'FREE' as const,
      name: 'Free',
      price: 0,
      kicker: 'Khởi đầu cảm hứng',
      description: 'Nơi mọi ý tưởng đầu tiên được tự do cất cánh.',
      features: [
        '3 lượt sáng tạo với AI mỗi ngày',
        'Đăng tải, lưu giữ và khám phá tác phẩm',
        'Tải ảnh chất lượng tiêu chuẩn',
      ],
      recommended: false,
    },
    {
      id: 'PLUS' as const,
      name: 'Plus',
      price: 99000,
      kicker: 'Sáng tạo & Kinh doanh',
      description: 'Mở rộng sức sáng tạo và biến tác phẩm thành cơ hội.',
      features: [
        '10 lượt sáng tạo với AI mỗi ngày',
        'Tải ảnh nguyên bản chất lượng cao, không watermark',
        'Mở bán tác phẩm với mức giá cố định',
        'Quản lý doanh thu và theo dõi mọi giao dịch',
      ],
      recommended: true,
    },
    {
      id: 'PRO' as const,
      name: 'Pro',
      price: 199000,
      kicker: 'Đặc quyền nghệ sĩ',
      description: 'Không giới hạn sáng tạo, nâng tầm giá trị từng tác phẩm.',
      features: [
        'Sáng tạo hình ảnh AI không giới hạn',
        'Trọn bộ đặc quyền của gói Plus',
        'Độc quyền mở, khám phá và tham gia đấu giá tác phẩm',
      ],
      recommended: false,
    },
  ];
  async ngOnInit() {
    await this.loadMembership();
  }

  async retryLoadMembership() {
    this.membershipLoading.set(true);
    await this.loadMembership();
  }

  private async loadMembership() {
    try {
      this.membershipLoadError.set('');
      await this.membership.load();
    } catch (error) {
      this.membershipLoadError.set(
        error instanceof Error ? error.message : 'Không thể tải thông tin gói thành viên.',
      );
    } finally {
      this.membershipLoading.set(false);
    }
  }
  async openCheckout(plan: PaidPlan) {
    this.checkoutReturnFocus = document.activeElement as HTMLElement;
    this.selectedPlan.set(plan);
    this.method.set('bank');
    this.message.set('');
    this.fieldErrors.set({});
    this.currentPayment.set(null);
    document.body.style.overflow = 'hidden';
    setTimeout(() =>
      document.querySelector<HTMLElement>('[data-pricing-dialog="active"]')?.focus(),
    );
    await this.ensurePayment(plan);
  }
  closeCheckout() {
    if (this.processing()) return;
    this.stopAutomaticPaymentCheck();
    this.selectedPlan.set(null);
    this.currentPayment.set(null);
    document.body.style.overflow = '';
    this.checkoutReturnFocus?.focus();
    this.checkoutReturnFocus = null;
  }

  /** Tracks where a press on the backdrop started — see profile.ts's
   * identical helper for why closing must check both the mousedown and
   * click targets instead of the click alone (otherwise selecting text in
   * the card-number/name fields to retype it can close checkout out from
   * under the person paying). */
  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent) {
    this.backdropMouseDownTarget = event.target;
  }

  onCheckoutBackdropClick(event: MouseEvent) {
    const startedOnBackdrop = this.backdropMouseDownTarget === event.currentTarget;
    this.backdropMouseDownTarget = null;
    if (startedOnBackdrop && event.target === event.currentTarget) {
      this.closeCheckout();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (!this.selectedPlan()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeCheckout();
      return;
    }

    if (event.key === 'Tab') {
      const dialog = document.querySelector<HTMLElement>('[data-pricing-dialog="active"]');
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  priceOf(plan: PaidPlan | null) {
    return plan === 'PRO' ? 199000 : 99000;
  }
  ownsPlan(plan: PaidPlan) {
    return this.membership.status()?.ownedPlans?.includes(plan) === true;
  }
  choosePaid(plan: PaidPlan) {
    if (this.ownsPlan(plan)) void this.activate(plan);
    else void this.openCheckout(plan);
  }
  paidButtonText(plan: PaidPlan, name: string) {
    if (this.membershipLoading()) return 'Đang kiểm tra gói…';
    if (this.membership.status()?.plan === plan) return 'Đã mua';
    return this.ownsPlan(plan) ? `Kích hoạt lại ${name}` : `Chọn ${name}`;
  }
  selectMethod(method: PaymentMethod) {
    this.method.set(method);
    this.message.set('');
    if (method === 'bank' && this.currentPayment()) this.startAutomaticPaymentCheck();
    else this.stopAutomaticPaymentCheck();
  }
  clearError(field: string) {
    const next = { ...this.fieldErrors() };
    delete next[field];
    this.fieldErrors.set(next);
    this.message.set('');
  }
  hasErrors() {
    return Object.keys(this.fieldErrors()).length > 0;
  }
  formatCard() {
    this.clearError('cardNumber');
    this.cardNumber = this.cardNumber
      .replace(/\D/g, '')
      .slice(0, 19)
      .replace(/(.{4})/g, '$1 ')
      .trim();
  }
  formatExpiry() {
    this.clearError('expiry');
    const digits = this.expiry.replace(/\D/g, '').slice(0, 4);
    this.expiry = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  }
  formatCvv() {
    this.clearError('cvv');
    this.cvv = this.cvv.replace(/\D/g, '').slice(0, 4);
  }
  validateField(field: string) {
    const errors = this.collectCardErrors();
    const next = { ...this.fieldErrors() };
    if (errors[field]) next[field] = errors[field];
    else delete next[field];
    this.fieldErrors.set(next);
  }
  // Mã tham chiếu do backend sinh - QR luôn khớp đúng giao dịch PENDING thật,
  // không còn dùng "NOVAFRAME {plan}" tĩnh (dễ gây lệch nội dung chuyển khoản).
  bankQr() {
    const payment = this.currentPayment();
    if (!payment) return '';
    return `https://img.vietqr.io/image/MB-110605043105-compact2.png?amount=${Number(payment.amount)}&addInfo=${encodeURIComponent(payment.paymentReference)}&accountName=NGUYEN%20DOAN%20PHUC`;
  }
  private async ensurePayment(plan: PaidPlan) {
    const existing = this.currentPayment();
    if (existing && existing.plan === plan && existing.status === 'PENDING') return;
    this.paymentLoading.set(true);
    this.message.set('');
    try {
      this.currentPayment.set(await this.membership.createPayment(plan));
      this.startAutomaticPaymentCheck();
    } catch (e) {
      this.message.set(e instanceof Error ? e.message : 'Không thể tạo giao dịch.');
    } finally {
      this.paymentLoading.set(false);
    }
  }
  private async pollPayment(id: string, attempts = 8, delayMs = 2000): Promise<MembershipPayment> {
    for (let i = 0; i < attempts; i++) {
      const payment = await this.membership.getPayment(id);
      if (payment.status !== 'PENDING') return payment;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return this.membership.getPayment(id);
  }

  private startAutomaticPaymentCheck() {
    this.stopAutomaticPaymentCheck();
    this.updatePaymentCountdown();
    this.automaticPaymentTimer = setInterval(() => void this.checkPaymentAutomatically(), 3_000);
    this.paymentCountdownTimer = setInterval(() => this.updatePaymentCountdown(), 1_000);
  }

  private updatePaymentCountdown() {
    const payment = this.currentPayment();
    if (!payment) return;
    const seconds = Math.max(
      0,
      Math.ceil((new Date(payment.createdAt).getTime() + 300_000 - Date.now()) / 1000),
    );
    this.qrSecondsLeft.set(seconds);
    this.qrExpired.set(seconds === 0);
    if (seconds === 0) this.stopAutomaticPaymentCheck();
  }

  qrCountdown(): string {
    const seconds = this.qrSecondsLeft();
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private stopAutomaticPaymentCheck() {
    if (this.automaticPaymentTimer) clearInterval(this.automaticPaymentTimer);
    if (this.paymentCountdownTimer) clearInterval(this.paymentCountdownTimer);
    this.automaticPaymentTimer = undefined;
    this.paymentCountdownTimer = undefined;
  }

  private async checkPaymentAutomatically() {
    const payment = this.currentPayment();
    const plan = this.selectedPlan();
    if (
      !payment ||
      !plan ||
      this.method() !== 'bank' ||
      this.processing() ||
      this.automaticCheckInFlight
    )
      return;
    this.automaticCheckInFlight = true;
    try {
      const latest = await this.membership.getPayment(payment.id);
      this.currentPayment.set(latest);
      if (latest.status !== 'PAID') return;
      this.stopAutomaticPaymentCheck();
      this.processing.set(true);
      await this.membership.load();
      this.selectedPlan.set(null);
      this.currentPayment.set(null);
      document.body.style.overflow = '';
      const planName = plan === 'PRO' ? 'Pro' : 'Plus';
      await this.dialogService.confirm({
        variant: 'information',
        size: 'large',
        title: `Đã kích hoạt gói ${planName}`,
        description:
          'Thanh toán đã được SePay xác nhận. Toàn bộ quyền lợi của gói đã sẵn sàng để sử dụng.',
        confirmLabel: 'Bắt đầu trải nghiệm',
      });
    } catch {
      // Lỗi mạng tạm thời không làm gián đoạn checkout; vòng tiếp theo sẽ thử lại.
    } finally {
      this.processing.set(false);
      this.automaticCheckInFlight = false;
    }
  }

  ngOnDestroy() {
    this.stopAutomaticPaymentCheck();
    document.body.style.overflow = '';
  }
  private luhnValid(value: string) {
    let sum = 0;
    let double = false;
    for (let i = value.length - 1; i >= 0; i--) {
      let digit = Number(value[i]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  }
  private collectCardErrors() {
    const errors: Record<string, string> = {};
    const digits = this.cardNumber.replace(/\s/g, '');
    const name = this.cardName.trim();
    if (!/^[\p{L}]+(?:[ '\-][\p{L}]+)+$/u.test(name))
      errors['cardName'] = 'Nhập đầy đủ họ tên bằng chữ như trên thẻ.';
    if (!/^\d{15,19}$/.test(digits)) errors['cardNumber'] = 'Số thẻ phải có từ 15–19 chữ số.';
    else if (!/^(4|5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720))/.test(digits))
      errors['cardNumber'] = 'Hiện chỉ hỗ trợ thẻ Visa hoặc Mastercard.';
    else if (!this.luhnValid(digits))
      errors['cardNumber'] = 'Số thẻ không hợp lệ. Vui lòng kiểm tra lại.';
    if (!/^\d{2}\/\d{2}$/.test(this.expiry)) errors['expiry'] = 'Nhập ngày theo định dạng MM/YY.';
    else {
      const [month, year] = this.expiry.split('/').map(Number);
      const now = new Date();
      const fullYear = 2000 + year;
      if (month < 1 || month > 12) errors['expiry'] = 'Tháng hết hạn phải từ 01 đến 12.';
      else if (
        fullYear < now.getFullYear() ||
        (fullYear === now.getFullYear() && month < now.getMonth() + 1)
      )
        errors['expiry'] = 'Thẻ đã hết hạn.';
    }
    if (!/^\d{3}$/.test(this.cvv)) errors['cvv'] = 'CVV của Visa/Mastercard phải có đúng 3 số.';
    return errors;
  }
  private validateCard() {
    const errors = this.collectCardErrors();
    this.fieldErrors.set(errors);
    return Object.keys(errors).length === 0;
  }
  async confirmPayment() {
    const plan = this.selectedPlan();
    if (!plan) return;
    if (this.method() !== 'bank') {
      if (this.method() === 'card' && !this.validateCard()) {
        this.message.set('Vui lòng kiểm tra các trường được đánh dấu đỏ.');
        return;
      }
      this.message.set(
        'Phương thức này chưa kết nối cổng thanh toán thật. Vui lòng dùng chuyển khoản ngân hàng.',
      );
      return;
    }
    const payment = this.currentPayment();
    if (!payment) {
      this.message.set('Không tìm thấy giao dịch, vui lòng đóng và mở lại.');
      return;
    }
    this.stopAutomaticPaymentCheck();
    this.processing.set(true);
    this.message.set('Đang kiểm tra trạng thái giao dịch…');
    try {
      const result = await this.pollPayment(payment.id);
      this.currentPayment.set(result);
      const paid = result.status === 'PAID';
      if (paid) await this.membership.load();
      this.selectedPlan.set(null);
      document.body.style.overflow = '';
      const planName = plan === 'PRO' ? 'Pro' : 'Plus';
      if (paid) {
        await this.dialogService.confirm({
          variant: 'information',
          title: `Đã kích hoạt gói ${planName}`,
          description: 'Hệ thống đã xác nhận giao dịch và nâng gói của bạn ngay lập tức.',
          confirmLabel: 'Tuyệt vời',
        });
      } else {
        await this.dialogService.confirm({
          variant: 'warning',
          title: 'Bạn chưa thanh toán',
          description: `Hệ thống chưa nhận được xác nhận tiền cho gói ${planName}. Gói của bạn chưa thay đổi. Ngân hàng có thể mất vài phút để báo giao dịch — vui lòng vào lại trang này sau ít phút để kiểm tra lại.`,
          confirmLabel: 'Đã hiểu',
        });
      }
      this.currentPayment.set(null);
    } catch (e) {
      this.message.set(e instanceof Error ? e.message : 'Không thể kiểm tra giao dịch.');
    } finally {
      this.processing.set(false);
      this.cardNumber = '';
      this.cvv = '';
    }
  }
  private async activate(plan: MembershipPlan) {
    this.processing.set(true);
    try {
      await this.membership.subscribe(plan);
      this.message.set(`Đã chuyển sang gói ${plan}.`);
    } finally {
      this.processing.set(false);
    }
  }
}
