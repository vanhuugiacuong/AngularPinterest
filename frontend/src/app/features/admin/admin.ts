import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Icon } from '../../shared/icon/icon';
import { ProAvatar } from '../../shared/pro-avatar/pro-avatar';
import { ToastService } from '../../core/services/toast';
import { badgeCount } from '../../shared/badge-count';
import { CountUp } from '../../shared/count-up/count-up';
import { ConfirmService } from '../../core/services/confirm';
import { BillingService } from '../../core/services/billing';
import {
  AdminService,
  AdminStats,
  AdminPayout,
  AdminReportGroup,
  AdminPaymentReport,
  AdminUser,
  AdminPayment,
  AdminWalletRow,
  AdminPin,
} from '../../core/services/admin';

/** `txreports` = sự cố chuyển khoản (tiền), tách hẳn khỏi `reports` = báo cáo
    ảnh vi phạm (nội dung). Hai loại việc khác nhau hoàn toàn, gộp chung một
    trang thì phải cuộn qua danh sách rút tiền mới thấy được sự cố. */
type Tab = 'overview' | 'payouts' | 'txreports' | 'reports' | 'users' | 'revenue' | 'content';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, Icon, ProAvatar, CountUp],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  // public vì thẻ báo lỗi trong template đọc `admin.lastError()` để hiện chi
  // tiết hỏng ở đâu (mã HTTP, URL) thay vì chỉ báo chung chung.
  public admin = inject(AdminService);
  private toast = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private router = inject(Router);
  public billing = inject(BillingService);

  /** Số trên huy hiệu tab — quá 9 thì hiện "9+" (xem shared/badge-count.ts). */
  public badgeCount = badgeCount;

  public tab = signal<Tab>('overview');
  public loading = signal(true);
  public allowed = signal<boolean | null>(null);
  public busy = signal(false);
  /** AdminService nuốt lỗi và trả null, nên nếu không tự bắt thì API hỏng =
      trang trắng trơn, không phân biệt được với "chưa có dữ liệu". */
  public loadError = signal<string | null>(null);

  public stats = signal<AdminStats | null>(null);
  public payouts = signal<AdminPayout[]>([]);
  public reports = signal<AdminReportGroup[]>([]);
  public paymentReports = signal<AdminPaymentReport[]>([]);
  public users = signal<AdminUser[]>([]);
  public payments = signal<AdminPayment[]>([]);
  public wallets = signal<AdminWalletRow[]>([]);
  public revenueDaily = signal<{ date: string; amountVnd: number }[]>([]);
  public pins = signal<AdminPin[]>([]);

  public userQuery = '';
  public pinQuery = '';
  public pinFilter = signal<'all' | 'premium' | 'ai'>('all');
  public payoutFilter = signal<'ALL' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED'>('ALL');
  /**
   * 'ACTIVE' = chỉ Chờ + Đã trả (mặc định). Đơn Hết hạn là QR bị bỏ ngang
   * (người dùng thoát trang, không hề nói lên chuyện gì đang xảy ra) nên xen
   * vào danh sách chỉ gây nhiễu — chừa lại 'Xem thêm' cho ai thật sự cần soát.
   */
  public paymentFilter = signal<'ACTIVE' | 'ALL' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED'>('ACTIVE');

  visiblePayments(): AdminPayment[] {
    const f = this.paymentFilter();
    const all = this.payments();
    if (f === 'ALL') return all;
    if (f === 'ACTIVE') return all.filter((p) => p.status === 'PENDING' || p.status === 'PAID');
    return all.filter((p) => p.status === f);
  }

  async ngOnInit() {
    // Backend mới là nơi chặn thật; đây chỉ để chuyển hướng cho gọn giao diện.
    const verdict = await this.admin.checkAdminDetailed();

    // CHỈ đá về trang chủ khi backend nói rõ là không có quyền. Nếu chỉ là
    // không hỏi được (máy chủ chập chờn) thì ở lại và hiện thẻ báo lỗi có nút
    // thử lại — trước đây gộp hai trường hợp nên máy chủ trục trặc là bị đẩy ra
    // ngoài, không thấy lỗi gì, tưởng như mất quyền admin.
    if (verdict === 'no') {
      this.allowed.set(false);
      this.loading.set(false);
      this.toast.error('Bạn không có quyền truy cập khu vực quản trị.');
      this.router.navigate(['/feed']);
      return;
    }

    if (verdict === 'unknown') {
      this.allowed.set(null);
      this.loadError.set('Không kết nối được máy chủ');
      this.loading.set(false);
      return;
    }

    this.allowed.set(true);
    await this.loadTab('overview');
    this.loading.set(false);
  }

  async setTab(t: Tab) {
    this.tab.set(t);
    await this.loadTab(t);
  }

  /**
   * Tiêu đề hero đổi theo mục đang mở — mỗi mục là một loại việc khác hẳn
   * nhau, nên hero nói đúng việc đang làm thay vì một dòng "Khu vực quản trị"
   * chung chung cho cả bảy mục. Phần `accent` được tô gradient theo --ad-accent
   * của mục đó (xem .ad-accent trong admin.css).
   */
  heroTitle(): { lead: string; accent: string; sub: string } {
    switch (this.tab()) {
      case 'payouts':
        return { lead: 'Duyệt', accent: 'rút tiền', sub: 'Đối chiếu tài khoản, chuyển khoản rồi chốt sổ từng yêu cầu.' };
      case 'txreports':
        return { lead: 'Sự cố', accent: 'chuyển khoản', sub: 'Người dùng báo đã chuyển nhưng chưa nhận — đối chiếu sao kê.' };
      case 'reports':
        return { lead: 'Nội dung bị', accent: 'báo cáo', sub: 'Ảnh vi phạm do cộng đồng báo cáo, chờ bạn gỡ hoặc bỏ qua.' };
      case 'users':
        return { lead: 'Quản lý', accent: 'người dùng', sub: 'Tìm kiếm, xem gói và khoá tài khoản vi phạm.' };
      case 'revenue':
        return { lead: 'Dòng tiền', accent: 'toàn hệ thống', sub: 'Doanh thu theo ngày, giao dịch và số dư credit của từng người.' };
      case 'content':
        return { lead: 'Kho', accent: 'nội dung', sub: 'Toàn bộ ảnh trên nền tảng, lọc theo Premium hoặc ảnh AI.' };
      default:
        return { lead: 'Điều hành', accent: 'PinHub', sub: 'Toàn cảnh người dùng, doanh thu và những việc đang chờ bạn.' };
    }
  }

  /** Tổng số việc đang chờ xử lý — hiện trên chip "còn N việc" ở hero. */
  pendingWork(): number {
    const s = this.stats();
    if (!s) return 0;
    return s.pendingPayouts + s.openReports + s.openPaymentReports;
  }

  private async loadTab(t: Tab) {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      switch (t) {
        case 'overview': {
          // Gọi song song: mỗi endpoint tự tuần tự hoá bên trong nên chỉ tốn
          // 2 kết nối ngắn hạn, không phải kiểu Promise.all(10 query) từng gây
          // sập tab này.
          const [s, rd] = await Promise.all([this.admin.stats(), this.admin.revenueDaily()]);
          if (!s) return this.fail('số liệu tổng quan');
          this.stats.set(s);
          if (rd) this.revenueDaily.set(rd);
          break;
        }
        case 'payouts': {
          const ps = await this.admin.payouts(this.payoutFilter());
          if (!ps) return this.fail('danh sách rút tiền');
          this.payouts.set(ps);
          break;
        }
        case 'txreports': {
          const prs = await this.admin.paymentReports('OPEN');
          if (!prs) return this.fail('danh sách sự cố chuyển khoản');
          this.paymentReports.set(prs);
          break;
        }
        case 'reports': {
          const rs = await this.admin.reports('OPEN');
          if (!rs) return this.fail('danh sách báo cáo');
          this.reports.set(rs);
          break;
        }
        case 'users': {
          const us = await this.admin.users(this.userQuery);
          if (!us) return this.fail('danh sách người dùng');
          this.users.set(us);
          break;
        }
        case 'revenue': {
          const [pm, wl, rd] = await Promise.all([
            this.admin.payments('ALL'),
            this.admin.wallets(),
            this.admin.revenueDaily(),
          ]);
          if (!pm || !wl || !rd) return this.fail('dữ liệu doanh thu');
          this.payments.set(pm);
          this.wallets.set(wl);
          this.revenueDaily.set(rd);
          break;
        }
        case 'content': {
          const ps = await this.admin.pins(this.pinFilter(), this.pinQuery);
          if (!ps) return this.fail('danh sách ảnh');
          this.pins.set(ps);
          break;
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  private fail(what: string) {
    this.loadError.set(`Không tải được ${what}.`);
  }

  /**
   * Bấm "Thử lại" ở thẻ báo lỗi. Nếu lần trước hỏng ngay ở bước kiểm quyền
   * (allowed vẫn là null) thì phải kiểm lại quyền chứ không chỉ tải lại dữ
   * liệu — nếu không, bấm mãi cũng không qua được bước đầu tiên.
   */
  async retry() {
    if (this.allowed() === null) {
      await this.ngOnInit();
      return;
    }
    await this.loadTab(this.tab());
  }

  // ── Rút tiền ────────────────────────────────────────────────────────────────
  async setPayoutFilter(f: typeof this.payoutFilter extends never ? never : 'ALL' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED') {
    this.payoutFilter.set(f);
    this.payouts.set((await this.admin.payouts(f)) ?? []);
  }

  async approvePayout(p: AdminPayout) {
    const ok = await this.confirmService.ask(
      `Duyệt yêu cầu rút ${p.credits} credit (${this.billing.formatVnd(p.amountVnd)}) của ${p.user?.username ?? '?'}?\n` +
        `Sau khi duyệt, bạn cần tự chuyển khoản rồi bấm "Đã chuyển".`,
      { title: 'Duyệt yêu cầu rút tiền', confirmLabel: 'Duyệt' },
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.admin.approvePayout(p.id);
      this.toast.success('Đã duyệt. Hãy chuyển khoản rồi đánh dấu "Đã chuyển".');
      await this.loadTab('payouts');
    } finally {
      this.busy.set(false);
    }
  }

  public bankRefInput: Record<string, string> = {};

  async markPaid(p: AdminPayout) {
    const ref = (this.bankRefInput[p.id] || '').trim();
    const ok = await this.confirmService.ask(
      `Xác nhận ĐÃ chuyển ${this.billing.formatVnd(p.amountVnd)} cho ${p.user?.username ?? '?'} ` +
        `qua ${p.bankName} — ${p.accountNumber}?`,
      { title: 'Đánh dấu đã chuyển', confirmLabel: 'Đã chuyển' },
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.admin.markPayoutPaid(p.id, ref);
      this.toast.success('Đã ghi nhận chuyển khoản.');
      await this.loadTab('payouts');
    } finally {
      this.busy.set(false);
    }
  }

  public rejectReasonInput: Record<string, string> = {};

  /** Id đơn đang mở ô nhập lý do từ chối (mỗi lúc chỉ mở một đơn). */
  public rejectOpen = signal<string | null>(null);

  toggleReject(id: string) {
    this.rejectOpen.set(this.rejectOpen() === id ? null : id);
  }

  async rejectPayout(p: AdminPayout) {
    const reason = (this.rejectReasonInput[p.id] || '').trim();
    if (!reason) {
      this.toast.error('Nhập lý do từ chối trước đã.');
      return;
    }
    const ok = await this.confirmService.ask(
      `Từ chối yêu cầu này? ${p.credits} credit sẽ được hoàn lại ví của ${p.user?.username ?? '?'}.`,
      { title: 'Từ chối yêu cầu', confirmLabel: 'Từ chối', danger: true },
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.admin.rejectPayout(p.id, reason);
      this.toast.success('Đã từ chối và hoàn credit.');
      this.rejectOpen.set(null);
      await this.loadTab('payouts');
    } finally {
      this.busy.set(false);
    }
  }

  async resolvePaymentReport(r: AdminPaymentReport) {
    this.busy.set(true);
    try {
      await this.admin.resolvePaymentReport(r.id);
      this.toast.success('Đã đánh dấu xử lý xong.');
      await this.loadTab('txreports');
    } finally {
      this.busy.set(false);
    }
  }

  // ── Báo cáo ảnh ─────────────────────────────────────────────────────────────
  async resolveReport(g: AdminReportGroup) {
    this.busy.set(true);
    try {
      await this.admin.resolveReports(g.pin.id);
      this.toast.success('Đã bỏ qua báo cáo.');
      await this.loadTab('reports');
    } finally {
      this.busy.set(false);
    }
  }

  async deletePin(pinId: string, title: string, author: string, back: Tab) {
    const ok = await this.confirmService.ask(
      `Gỡ vĩnh viễn ảnh "${title}" của ${author}? Hành động này không hoàn tác được.`,
      { title: 'Gỡ ảnh vi phạm', confirmLabel: 'Gỡ ảnh', danger: true },
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.admin.deletePin(pinId);
      this.toast.success('Đã gỡ ảnh.');
      await this.loadTab(back);
    } finally {
      this.busy.set(false);
    }
  }

  /** Gộp lý do trùng nhau: ["Spam", "Spam", "Bạo lực"] -> "Spam ×2, Bạo lực" */
  reasonSummary(reasons: string[]): string {
    const counts = new Map<string, number>();
    for (const r of reasons) {
      const key = r.split('—')[0].trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
      .join(', ');
  }

  // ── Người dùng ──────────────────────────────────────────────────────────────
  private userSearchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Danh sách hiện ra sau khi lọc TẠI CHỖ theo ô tìm kiếm.
   *
   * Có hai tầng lọc và cả hai đều cần:
   *  - Tầng này lọc ngay trên dữ liệu đã tải nên gõ tới đâu thấy tới đó, không
   *    phải chờ mạng.
   *  - Server (searchUsers, có hoãn) tìm trong TOÀN BỘ người dùng, nên người
   *    nằm ngoài 100 dòng đang tải vẫn ra.
   *
   * Lọc tại chỗ còn chặn luôn lỗi phản hồi về trái thứ tự: gõ "h" rồi "ho",
   * nếu kết quả của "h" về sau thì danh sách vẫn được lọc lại theo "ho".
   */
  visibleUsers(): AdminUser[] {
    const q = this.userQuery.trim().toLowerCase();
    if (!q) return this.users();
    return this.users().filter(
      (u) =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q),
    );
  }

  /** Gõ tới đâu tìm tới đó. Hoãn 300ms để không bắn một request mỗi phím. */
  onUserQueryChange() {
    if (this.userSearchTimer) clearTimeout(this.userSearchTimer);
    this.userSearchTimer = setTimeout(() => void this.searchUsers(), 300);
  }

  clearUserQuery() {
    this.userQuery = '';
    if (this.userSearchTimer) clearTimeout(this.userSearchTimer);
    void this.searchUsers();
  }

  async searchUsers() {
    // KHÔNG bật loading(): cờ đó làm trắng cả bảng, mỗi lần gõ một chữ lại chớp
    // một cái. Danh sách cũ cứ để nguyên, có kết quả mới thì thay.
    this.users.set((await this.admin.users(this.userQuery)) ?? []);
  }

  async toggleBan(u: AdminUser) {
    const next = !u.isPinhubBanned;
    const ok = await this.confirmService.ask(
      next
        ? `Khoá tài khoản ${u.username}? Họ sẽ không đăng nhập được nữa.`
        : `Mở khoá cho ${u.username}?`,
      { title: next ? 'Khoá tài khoản' : 'Mở khoá', confirmLabel: next ? 'Khoá' : 'Mở khoá', danger: next },
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.admin.banUser(u.id, next);
      if (res) {
        this.toast.success(next ? 'Đã khoá tài khoản.' : 'Đã mở khoá.');
        await this.loadTab('users');
      } else {
        this.toast.error('Không thực hiện được (có thể là tài khoản quản trị).');
      }
    } finally {
      this.busy.set(false);
    }
  }

  // ── Nội dung ────────────────────────────────────────────────────────────────
  async setPinFilter(f: 'all' | 'premium' | 'ai') {
    this.pinFilter.set(f);
    this.pins.set((await this.admin.pins(f, this.pinQuery)) ?? []);
  }

  async searchPins() {
    this.pins.set((await this.admin.pins(this.pinFilter(), this.pinQuery)) ?? []);
  }

  // ── Tiện ích hiển thị ───────────────────────────────────────────────────────
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
      case 'PAID': return 'st-paid';
      case 'REJECTED': return 'st-rejected';
      // st-processing (xanh dương), KHÔNG phải st-approved (tím) — tím dành
      // riêng cho huy hiệu ADMIN/AI. Màu này trùng khít wallet.css để cùng một
      // đơn không hiện hai màu ở hai trang.
      case 'APPROVED': return 'st-processing';
      default: return 'st-pending';
    }
  }

  paymentStatusLabel(s: string): string {
    switch (s) {
      case 'PAID': return 'Đã trả';
      case 'PENDING': return 'Chờ';
      case 'FAILED': return 'Huỷ';
      case 'EXPIRED': return 'Hết hạn';
      default: return s;
    }
  }

  purposeLabel(p: string, plan?: string | null, pack?: string | null): string {
    if (p === 'PRO_SUB') return plan === 'YEARLY' ? 'Pro năm' : 'Pro tháng';
    return pack ? `Gói credit ${pack}` : 'Credit';
  }

  /** Chiều cao cột biểu đồ theo % so với ngày cao nhất. */
  barHeight(v: number): number {
    const max = Math.max(1, ...this.revenueDaily().map((d) => d.amountVnd));
    return Math.max(2, Math.round((v / max) * 100));
  }

  /** Tổng doanh thu trong khoảng biểu đồ đang hiện (30 ngày). */
  chartTotal(): number {
    return this.revenueDaily().reduce((sum, d) => sum + d.amountVnd, 0);
  }

  chartAvg(): number {
    const days = this.revenueDaily();
    return days.length ? Math.round(this.chartTotal() / days.length) : 0;
  }

  /** Ngày doanh thu cao nhất trong khoảng — null nếu cả kỳ đều 0. */
  chartBest(): { date: string; amountVnd: number } | null {
    const days = this.revenueDaily();
    if (!days.length) return null;
    const best = days.reduce((a, b) => (b.amountVnd > a.amountVnd ? b : a));
    return best.amountVnd > 0 ? best : null;
  }

  /** So sánh nửa sau với nửa đầu kỳ — cho biết doanh thu đang lên hay xuống. */
  chartTrendPct(): number | null {
    const days = this.revenueDaily();
    if (days.length < 4) return null;
    const mid = Math.floor(days.length / 2);
    const firstHalf = days.slice(0, mid).reduce((s, d) => s + d.amountVnd, 0);
    const secondHalf = days.slice(mid).reduce((s, d) => s + d.amountVnd, 0);
    if (firstHalf === 0) return secondHalf > 0 ? 100 : null;
    return Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
  }

  /** Nhãn ngày ngắn dd/MM — chỉ hiện ở một vài mốc để trục không rối chữ. */
  shortDate(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** true nếu vị trí `i` trong mảng `total` phần tử nên hiện nhãn ngày dưới cột. */
  showDateLabel(i: number, total: number): boolean {
    if (i === 0 || i === total - 1) return true;
    const step = Math.ceil(total / 6);
    return i % step === 0;
  }

  copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.toast.success('Đã sao chép'),
      () => {},
    );
  }

  goPin(id: string) {
    this.router.navigate(['/pin', id]);
  }
}
