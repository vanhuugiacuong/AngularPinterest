import { Component, ElementRef, HostListener, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Icon } from '../../shared/icon/icon';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';
import { BillingService, PackCode, CreditTxnType, PayoutInfo } from '../../core/services/billing';

/** Danh sách ngân hàng phổ biến ở VN để chọn nhanh, đỡ gõ tay và đỡ gõ sai
    tên viết tắt (VD "vietcom" vs "Vietcombank" — admin đối chiếu thủ công nên
    tên càng đúng chuẩn càng đỡ mất công tra). "Khác" để không chặn ai dùng
    ngân hàng ít phổ biến hơn không có trong danh sách. */
const VN_BANKS = [
  'Vietcombank', 'Techcombank', 'BIDV', 'VietinBank', 'Agribank', 'MB Bank',
  'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'SHB', 'VIB', 'OCB',
  'MSB', 'SeABank', 'Eximbank', 'LienVietPostBank', 'Nam A Bank', 'ABBank',
];

/** Mã ngân hàng theo đúng chuẩn VietQR — cdn.vietqr.io/img/{code}.png trả về
    logo THẬT của từng ngân hàng. VietQR là kho logo công khai chuyên dùng cho
    app thanh toán VN (cùng hệ sinh thái QR mà billing.service.ts đang dùng),
    không phải hotlink tuỳ tiện từ nguồn không rõ nguồn gốc. Đã tra đúng từng
    mã qua api.vietqr.io/v2/banks — vài mã KHÔNG trùng viết tắt thường gặp
    (VietinBank là "ICB" chứ không phải "CTG", Agribank là "VBA"). */
const BANK_CODE: Record<string, string> = {
  Vietcombank: 'VCB', Techcombank: 'TCB', BIDV: 'BIDV', VietinBank: 'ICB', Agribank: 'VBA',
  'MB Bank': 'MB', ACB: 'ACB', VPBank: 'VPB', TPBank: 'TPB', Sacombank: 'STB', HDBank: 'HDB',
  SHB: 'SHB', VIB: 'VIB', OCB: 'OCB', MSB: 'MSB', SeABank: 'SEAB', Eximbank: 'EIB',
  LienVietPostBank: 'LPB', 'Nam A Bank': 'NAB', ABBank: 'ABB',
};
const BANK_PALETTE = ['#5b9cff', '#34c17f', '#e8c468', '#f94083', '#8b7bf0', '#ff8a3d', '#4dd0e1', '#c05fe0'];

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

  public banks = VN_BANKS;
  /** true khi người dùng chọn "Khác" trong danh sách — hiện thêm ô gõ tay. */
  public payoutBankOther = signal(false);

  /** Dropdown ngân hàng tự vẽ — <select> gốc để trình duyệt/hệ điều hành vẽ
      phần popup (viền vuông, tô xanh dương mặc định), không style được nên
      trông lạc quẻ với giao diện tối của app. */
  public bankDropdownOpen = signal(false);
  @ViewChild('bankPickerEl') bankPickerEl?: ElementRef<HTMLElement>;

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent) {
    if (!this.bankDropdownOpen()) return;
    const el = this.bankPickerEl?.nativeElement;
    if (el && !el.contains(ev.target as Node)) this.bankDropdownOpen.set(false);
  }

  toggleBankDropdown() {
    this.bankDropdownOpen.update((v) => !v);
  }

  selectBank(value: string) {
    if (value === '__other__') {
      this.payoutBankOther.set(true);
      this.payoutBank = '';
    } else {
      this.payoutBankOther.set(false);
      this.payoutBank = value;
    }
    this.bankDropdownOpen.set(false);
  }

  bankCode(name: string): string {
    return BANK_CODE[name] || name.slice(0, 2).toUpperCase();
  }

  bankColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return BANK_PALETTE[hash % BANK_PALETTE.length];
  }

  /** Logo lưu sẵn trong public/banks/ (tải một lần từ VietQR về local) thay vì
      hotlink CDN ngoài mỗi lần tải trang — nhanh hơn, không phụ thuộc mạng
      ngoài lúc runtime, và không phải tải tay từng cái.
      `?v=2` phá cache: đã sửa file BIDV.png tại chỗ (khử nền trắng) sau khi
      trình duyệt đã lỡ tải bản cũ — cùng tên file thì trình duyệt cứ dùng lại
      bản trong cache, không tự biết nội dung đã đổi. */
  bankLogoUrl(name: string): string | null {
    const code = BANK_CODE[name];
    return code ? `/banks/${code}.png?v=2` : null;
  }

  /** Ảnh lỗi (mạng chập chờn, CDN đổi) thì rơi về huy hiệu chữ thay vì để
      icon vỡ trong ô — theo dõi riêng từng ngân hàng vì có thể chỉ 1-2 mã lỗi. */
  private brokenLogos = signal<Set<string>>(new Set());
  logoBroken(name: string): boolean {
    return this.brokenLogos().has(name);
  }
  onLogoError(name: string) {
    this.brokenLogos.update((s) => new Set(s).add(name));
  }

  /** Chip cộng dồn: bấm "+500" thì CỘNG 500 vào số đang gõ, không phải đặt
      thành 500 — người dùng có thể bấm nhiều chip liên tiếp để ra đúng số họ
      muốn (VD +500 +100 = 600) thay vì gõ tay toàn bộ. */
  payoutCap(info: PayoutInfo): number {
    return Math.min(info.balance, info.maxCredits);
  }

  addPayoutCredits(amount: number, info: PayoutInfo) {
    const next = Math.floor(Number(this.payoutCredits) || 0) + amount;
    this.payoutCredits = Math.max(0, Math.min(this.payoutCap(info), next));
  }

  /** true khi bấm chip này sẽ không cộng thêm được gì nữa (đã ở mức tối đa
      có thể rút) — làm mờ nút thay vì để bấm vô ích. */
  chipDisabled(info: PayoutInfo): boolean {
    return Math.floor(Number(this.payoutCredits) || 0) >= this.payoutCap(info);
  }

  setPayoutMax(info: PayoutInfo) {
    this.payoutCredits = this.payoutCap(info);
  }

  /**
   * Chặn cứng ngay lúc gõ. Dùng (input) thay vì (ngModelChange) và tự ghi
   * thẳng vào `event.target.value` — giữ phím "0" lặp phím tự động nhanh hơn
   * một vòng render của Angular, nên nếu chỉ sửa `payoutCredits` rồi CHỜ
   * Angular vẽ lại thì DOM vẫn kịp phình thêm vài số 0 trước khi kịp sửa
   * (đúng lỗi "83500000000" đã gặp). Ghi trực tiếp vào input thì chặn NGAY
   * trong cùng lần gõ, không có khoảng hở nào để lọt qua.
   */
  onCreditsInput(ev: Event, info: PayoutInfo) {
    const el = ev.target as HTMLInputElement;
    let n = Math.floor(Number(el.value) || 0);
    if (n < 0) n = 0;
    const cap = this.payoutCap(info);
    if (n > cap) {
      n = cap;
      el.value = String(n);
    }
    this.payoutCredits = n;
  }

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

  formatNumber(n: number): string {
    return n.toLocaleString('vi-VN');
  }

  payoutAmountVnd(vndPerCredit: number): number {
    const n = Math.floor(Number(this.payoutCredits) || 0);
    return Math.max(0, n) * vndPerCredit;
  }

  /** Báo lỗi ngay khi gõ (không đợi bấm Gửi yêu cầu) — vượt số dư, dưới mức
      tối thiểu, hoặc vượt trần an toàn (chặn sớm để tránh nhập số khổng lồ
      gây tràn số khi tính "≈ VNĐ", ví dụ 150đ × hàng chục triệu credit). */
  creditInputError(info: PayoutInfo): string | null {
    const n = Math.floor(Number(this.payoutCredits) || 0);
    if (n > info.maxCredits) return `Rút tối đa ${info.maxCredits.toLocaleString('vi-VN')} credit/lần.`;
    if (n > info.balance) return `Vượt số dư — bạn chỉ có ${info.balance} credit.`;
    if (n > 0 && n < info.minCredits) return `Tối thiểu ${info.minCredits} credit.`;
    return null;
  }

  /**
   * Kiểm tra ĐỊNH DẠNG số tài khoản (chỉ số, độ dài hợp lý) — KHÔNG phải xác
   * minh đây có đúng là tài khoản ngân hàng thật hay tên chủ có khớp không.
   * Việc đó cần API tra cứu tài khoản trả phí (VD VietQR Pro, Casso) mà dự án
   * chưa đăng ký — báo rõ trong ghi chú bên dưới để khỏi hiểu lầm là đã có.
   */
  accountNumberError(): string | null {
    const v = this.payoutAccount.trim();
    if (!v) return null;
    if (!/^\d+$/.test(v)) return 'Chỉ được gồm chữ số.';
    if (v.length < 6 || v.length > 19) return 'Số tài khoản thường dài 6–19 số.';
    return null;
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
    // Báo đúng TÊN trường đang thiếu/sai thay vì gộp chung một câu — trước đây
    // "Vui lòng nhập đủ thông tin ngân hàng" không nói thiếu cái gì, người
    // dùng phải tự dò lại cả 3 ô.
    if (!this.payoutBank.trim()) {
      this.payoutError.set('Vui lòng chọn ngân hàng.');
      return;
    }
    if (!this.payoutAccount.trim()) {
      this.payoutError.set('Vui lòng nhập số tài khoản.');
      return;
    }
    if (this.accountNumberError()) {
      this.payoutError.set('Số tài khoản không đúng định dạng — ' + this.accountNumberError());
      return;
    }
    if (!this.payoutName.trim()) {
      this.payoutError.set('Vui lòng nhập tên chủ tài khoản.');
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
