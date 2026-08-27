import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Icon } from '../../shared/icon/icon';
import { ProAvatar } from '../../shared/pro-avatar/pro-avatar';
import { ToastService } from '../../core/services/toast';
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

type Tab = 'overview' | 'payouts' | 'reports' | 'users' | 'revenue' | 'content';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, Icon, ProAvatar],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private router = inject(Router);
  public billing = inject(BillingService);

  public tab = signal<Tab>('overview');
  public loading = signal(true);
  public allowed = signal<boolean | null>(null);
  public busy = signal(false);

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

  async ngOnInit() {
    // Backend mới là nơi chặn thật; đây chỉ để chuyển hướng cho gọn giao diện.
    const ok = await this.admin.checkAdmin();
    this.allowed.set(ok);
    if (!ok) {
      this.loading.set(false);
      this.toast.error('Bạn không có quyền truy cập khu vực quản trị.');
      this.router.navigate(['/feed']);
      return;
    }
    await this.loadTab('overview');
    this.loading.set(false);
  }

  async setTab(t: Tab) {
    this.tab.set(t);
    await this.loadTab(t);
  }

  private async loadTab(t: Tab) {
    this.loading.set(true);
    try {
      switch (t) {
        case 'overview':
          this.stats.set(await this.admin.stats());
          break;
        case 'payouts':
          this.payouts.set((await this.admin.payouts(this.payoutFilter())) ?? []);
          this.paymentReports.set((await this.admin.paymentReports('OPEN')) ?? []);
          break;
        case 'reports':
          this.reports.set((await this.admin.reports('OPEN')) ?? []);
          break;
        case 'users':
          this.users.set((await this.admin.users(this.userQuery)) ?? []);
          break;
        case 'revenue':
          this.payments.set((await this.admin.payments('ALL')) ?? []);
          this.wallets.set((await this.admin.wallets()) ?? []);
          this.revenueDaily.set((await this.admin.revenueDaily()) ?? []);
          break;
        case 'content':
          this.pins.set((await this.admin.pins(this.pinFilter(), this.pinQuery)) ?? []);
          break;
      }
    } finally {
      this.loading.set(false);
    }
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
      await this.loadTab('payouts');
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
  async searchUsers() {
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
      case 'APPROVED': return 'st-approved';
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
