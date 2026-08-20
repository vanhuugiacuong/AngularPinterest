import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Navbar } from '../../components/navbar/navbar';
import { MembershipPlan, MembershipService } from '../../core/services/membership';
type PaidPlan = 'PLUS' | 'PRO'; type PaymentMethod = 'bank' | 'momo' | 'card';
@Component({ selector: 'app-pricing', standalone: true, imports: [CommonModule, FormsModule, Navbar], templateUrl: './pricing.html', styleUrls: ['./pricing.css', './payment-feedback.css', './qr-fix.css'] })
export class Pricing implements OnInit {
  membership = inject(MembershipService); selectedPlan = signal<PaidPlan | null>(null); method = signal<PaymentMethod>('bank'); processing = signal(false); message = signal('');
  fieldErrors = signal<Record<string, string>>({}); successDialog = signal(false); paidPlan = signal<PaidPlan | null>(null);
  membershipLoading = signal(true);
  cardNumber = ''; cardName = ''; expiry = ''; cvv = '';
  readonly plans = [
    { id: 'FREE' as const, name: 'Free', price: 0, kicker: 'Khởi đầu', description: 'Dành cho những ý tưởng đầu tiên.', features: ['3 lượt tạo AI mỗi ngày', 'Đăng, lưu và khám phá tác phẩm', 'Tải ảnh tiêu chuẩn'] },
    { id: 'PLUS' as const, name: 'Plus', price: 99000, kicker: 'Được yêu thích', description: 'Không gian rộng hơn cho người sáng tạo.', features: ['10 lượt tạo AI mỗi ngày', 'Tải ảnh nguyên bản, không watermark', 'Không chèn tên hoặc ID tác giả'] },
    { id: 'PRO' as const, name: 'Pro', price: 199000, kicker: 'Studio chuyên nghiệp', description: 'Biến tác phẩm thành một cửa hàng.', features: ['20 lượt tạo AI mỗi ngày', 'Toàn bộ quyền lợi Plus', 'Đặt giá và bán ảnh của bạn', 'Theo dõi giao dịch mua tác phẩm'] }
  ];
  async ngOnInit() { try { await this.membership.load(); } finally { this.membershipLoading.set(false); } }
  openCheckout(plan: PaidPlan) { this.selectedPlan.set(plan); this.method.set('bank'); this.message.set(''); this.fieldErrors.set({}); document.body.style.overflow = 'hidden'; }
  closeCheckout() { if (this.processing()) return; this.selectedPlan.set(null); document.body.style.overflow = ''; }
  priceOf(plan: PaidPlan | null) { return plan === 'PRO' ? 199000 : 99000; }
  chooseFree() { void this.activate('FREE'); }
  ownsPlan(plan: PaidPlan) { return this.membership.status()?.ownedPlans?.includes(plan) === true; }
  choosePaid(plan: PaidPlan) { if (this.ownsPlan(plan)) void this.activate(plan); else this.openCheckout(plan); }
  paidButtonText(plan: PaidPlan, name: string) { if (this.membershipLoading()) return 'Đang kiểm tra gói…'; if (this.membership.status()?.plan === plan) return 'Gói hiện tại'; return this.ownsPlan(plan) ? `Dùng lại ${name}` : `Chọn ${name}`; }
  selectMethod(method: PaymentMethod) { this.method.set(method); this.message.set(''); }
  clearError(field: string) { const next = { ...this.fieldErrors() }; delete next[field]; this.fieldErrors.set(next); this.message.set(''); }
  hasErrors() { return Object.keys(this.fieldErrors()).length > 0; }
  formatCard() { this.clearError('cardNumber'); this.cardNumber = this.cardNumber.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); }
  formatExpiry() { this.clearError('expiry'); const digits = this.expiry.replace(/\D/g, '').slice(0, 4); this.expiry = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits; }
  formatCvv() { this.clearError('cvv'); this.cvv = this.cvv.replace(/\D/g, '').slice(0, 4); }
  validateField(field: string) { const errors = this.collectCardErrors(); const next = { ...this.fieldErrors() }; if (errors[field]) next[field] = errors[field]; else delete next[field]; this.fieldErrors.set(next); }
  bankQr(plan: PaidPlan) { const amount = this.priceOf(plan); return `https://img.vietqr.io/image/MB-0777920079-compact2.png?amount=${amount}&addInfo=NOVAFRAME%20${plan}&accountName=HUA%20DUY%20KHAI`; }
  private luhnValid(value: string) { let sum = 0; let double = false; for (let i = value.length - 1; i >= 0; i--) { let digit = Number(value[i]); if (double) { digit *= 2; if (digit > 9) digit -= 9; } sum += digit; double = !double; } return sum % 10 === 0; }
  private collectCardErrors() {
    const errors: Record<string, string> = {}; const digits = this.cardNumber.replace(/\s/g, ''); const name = this.cardName.trim();
    if (!/^[\p{L}]+(?:[ '\-][\p{L}]+)+$/u.test(name)) errors['cardName'] = 'Nhập đầy đủ họ tên bằng chữ như trên thẻ.';
    if (!/^\d{15,19}$/.test(digits)) errors['cardNumber'] = 'Số thẻ phải có từ 15–19 chữ số.';
    else if (!/^(4|5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) errors['cardNumber'] = 'Hiện chỉ hỗ trợ thẻ Visa hoặc Mastercard.';
    else if (!this.luhnValid(digits)) errors['cardNumber'] = 'Số thẻ không hợp lệ. Vui lòng kiểm tra lại.';
    if (!/^\d{2}\/\d{2}$/.test(this.expiry)) errors['expiry'] = 'Nhập ngày theo định dạng MM/YY.';
    else { const [month, year] = this.expiry.split('/').map(Number); const now = new Date(); const fullYear = 2000 + year; if (month < 1 || month > 12) errors['expiry'] = 'Tháng hết hạn phải từ 01 đến 12.'; else if (fullYear < now.getFullYear() || (fullYear === now.getFullYear() && month < now.getMonth() + 1)) errors['expiry'] = 'Thẻ đã hết hạn.'; }
    if (!/^\d{3}$/.test(this.cvv)) errors['cvv'] = 'CVV của Visa/Mastercard phải có đúng 3 số.';
    return errors;
  }
  private validateCard() { const errors = this.collectCardErrors(); this.fieldErrors.set(errors); return Object.keys(errors).length === 0; }
  async confirmPayment() {
    const plan = this.selectedPlan(); if (!plan) return;
    if (this.method() === 'card' && !this.validateCard()) { this.message.set('Vui lòng kiểm tra các trường được đánh dấu đỏ.'); return; }
    this.processing.set(true); this.message.set('Đang kiểm tra trạng thái giao dịch…');
    try {
      await new Promise(r => setTimeout(r, 900));
      // Client không được tự nâng gói. Chỉ webhook thanh toán đã được
      // nhà cung cấp xác thực mới được phép kích hoạt quyền lợi.
      this.paidPlan.set(plan); this.selectedPlan.set(null); this.successDialog.set(true);
    }
    catch (e) { this.message.set(e instanceof Error ? e.message : 'Không thể kiểm tra giao dịch.'); }
    finally { this.processing.set(false); this.cardNumber = ''; this.cvv = ''; }
  }
  closeSuccess() { this.successDialog.set(false); this.paidPlan.set(null); document.body.style.overflow = ''; }
  private async activate(plan: MembershipPlan) { this.processing.set(true); try { await this.membership.subscribe(plan); this.message.set(`Đã chuyển sang gói ${plan}.`); } finally { this.processing.set(false); } }
}
