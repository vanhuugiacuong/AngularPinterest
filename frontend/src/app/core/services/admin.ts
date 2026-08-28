import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase';
import { API_BASE_URL } from '../api-base';

/**
 * Gọi API khu vực quản trị. Mọi endpoint đều được backend chặn bằng AdminGuard
 * (đọc cờ quyền từ DB), nên lớp này chỉ lo gọi và xử lý lỗi — không phải lớp
 * bảo mật.
 */

export interface AdminStats {
  users: number;
  pins: number;
  premiumPins: number;
  openReports: number;
  openPaymentReports: number;
  pendingPayouts: number;
  revenueTotal: number;
  revenueMonth: number;
  revenueWeek: number;
  proCount: number;
  creditsCirculating: number;
  creditsEarnedTotal: number;
  newUsersWeek: number;
  newPinsWeek: number;
  payoutPaidTotal: number;
  bannedUsers: number;
  aiPins: number;
}

export interface AdminUserRef {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface AdminPayout {
  id: string;
  userId: string;
  credits: number;
  amountVnd: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  rejectReason?: string | null;
  bankRef?: string | null;
  createdAt: string;
  processedAt?: string | null;
  user: AdminUserRef | null;
}

export interface AdminReportGroup {
  pin: {
    id: string;
    title: string;
    imageUrl: string;
    isPremium: boolean;
    user: AdminUserRef & { isPinhubBanned?: boolean };
  };
  count: number;
  reasons: string[];
  latest: string;
}

export interface AdminPaymentReport {
  id: string;
  reason: string;
  note?: string | null;
  memo?: string | null;
  status: string;
  createdAt: string;
  user: AdminUserRef | null;
  payment: { id: string; amountVnd: number; status: string; purpose: string; createdAt: string } | null;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string | null;
  createdAt: string;
  proExpiresAt?: string | null;
  pinhubProPlan?: string | null;
  isPinhubAdmin: boolean;
  isPinhubBanned: boolean;
  isProActive: boolean;
  wallet?: { spendable: number; earnings: number } | null;
  _count: { pins: number };
}

export interface AdminPayment {
  id: string;
  amountVnd: number;
  status: string;
  purpose: string;
  planCode?: string | null;
  packCode?: string | null;
  memo: string;
  createdAt: string;
  user: AdminUserRef | null;
}

export interface AdminWalletRow {
  userId: string;
  spendable: number;
  earnings: number;
  vndValue: number;
  user: { username: string; email: string; proExpiresAt?: string | null };
}

export interface AdminPin {
  id: string;
  title: string;
  imageUrl: string;
  isPremium: boolean;
  priceCredits?: number | null;
  isAiGenerated: boolean;
  createdAt: string;
  user: AdminUserRef;
  _count: { likes: number; reports: number };
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private supa = inject(SupabaseService);
  private api = `${API_BASE_URL}/api/admin`;

  /** null = chưa kiểm tra, true/false = kết quả. */
  readonly isAdmin = signal<boolean | null>(null);

  /**
   * Tổng việc đang chờ admin xử lý (rút tiền + báo cáo ảnh + sự cố chuyển
   * khoản) — hiện thành huy hiệu số trên nút Quản trị ở sidebar, để admin biết
   * có việc mới mà không phải mở trang ra xem.
   */
  readonly pendingWork = signal<number>(0);

  /** Nạp số việc tồn cho huy hiệu. Nuốt lỗi: hỏng thì để huy hiệu 0, không
      chặn gì cả — đây chỉ là chỉ báo phụ. */
  async refreshPendingWork(): Promise<void> {
    const s = await this.stats();
    if (!s) return;
    this.pendingWork.set(
      (s.pendingPayouts ?? 0) + (s.openReports ?? 0) + (s.openPaymentReports ?? 0),
    );
  }

  /** Nhớ kết quả lần trước theo từng tài khoản, để lúc tải lại trang nút Quản
      trị hiện ngay thay vì biến mất cho tới khi /check trả lời. Chỉ là chuyện
      hiển thị — chặn thật vẫn nằm ở AdminGuard phía backend, nên giá trị cũ có
      sai cũng không mở thêm được quyền gì. Gắn theo userId để máy dùng chung
      không hiện nút của người trước. */
  private cacheKey(): string | null {
    const id = this.supa.user()?.id;
    return id ? `pinhub.isAdmin.${id}` : null;
  }

  private readCache(): boolean | null {
    const k = this.cacheKey();
    if (!k) return null;
    try {
      const v = localStorage.getItem(k);
      return v === null ? null : v === '1';
    } catch {
      return null;
    }
  }

  private writeCache(ok: boolean) {
    const k = this.cacheKey();
    if (!k) return;
    try {
      localStorage.setItem(k, ok ? '1' : '0');
    } catch {
      /* chế độ ẩn danh chặn localStorage — bỏ qua, chỉ mất phần hiện sớm */
    }
  }

  private async token(): Promise<string | null> {
    try {
      return await this.supa.getSessionToken();
    } catch {
      return null;
    }
  }

  /**
   * Lý do hỏng của lần gọi gần nhất, để thẻ báo lỗi nói được CHUYỆN GÌ đã xảy
   * ra thay vì chỉ "không tải được". Trước đây mọi thất bại đều thành `null`
   * như nhau, nên không phân biệt nổi hết hạn đăng nhập, máy chủ 500 hay tắt
   * hẳn — mà ba thứ đó cách xử lý khác hẳn nhau.
   */
  readonly lastError = signal<string | null>(null);

  private async req<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const token = await this.token();
    if (!token) {
      this.lastError.set('Chưa đăng nhập (không lấy được phiên Supabase)');
      return null;
    }
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      if (init.body) headers.set('Content-Type', 'application/json');
      const res = await fetch(`${this.api}${path}`, { ...init, headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.lastError.set(`${path} trả về HTTP ${res.status}${body ? ' — ' + body.slice(0, 160) : ''}`);
        return null;
      }
      this.lastError.set(null);
      return (await res.json()) as T;
    } catch (e) {
      // fetch chỉ ném khi không tới được máy chủ (tắt, sai cổng, CORS chặn).
      this.lastError.set(
        `Không gọi được ${this.api}${path} — ${e instanceof Error ? e.message : 'lỗi mạng'}`,
      );
      return null;
    }
  }

  /**
   * Ba kết quả, KHÔNG phải hai:
   *   'yes'     backend xác nhận là admin
   *   'no'      backend xác nhận KHÔNG phải admin
   *   'unknown' không hỏi được backend (mất mạng, 500, chưa có token)
   *
   * Phân biệt 'no' với 'unknown' mới là điểm chính: gộp chúng làm một thì lúc
   * máy chủ chập chờn, trang admin tưởng bạn không có quyền và đá về trang chủ
   * — không thấy lỗi, không có nút thử lại, chỉ thấy "tự nhiên vào không được".
   */
  async checkAdminDetailed(): Promise<'yes' | 'no' | 'unknown'> {
    const cached = this.readCache();
    if (cached !== null) this.isAdmin.set(cached);

    const r = await this.req<{ isAdmin: boolean }>('/check');
    if (r === null) return 'unknown';

    const ok = !!r.isAdmin;
    this.isAdmin.set(ok);
    this.writeCache(ok);
    return ok ? 'yes' : 'no';
  }

  /** Kiểm tra quyền để hiện/ẩn mục menu. Kết quả thật do backend quyết. */
  async checkAdmin(): Promise<boolean> {
    // Hiện nút ngay từ giá trị nhớ được, khỏi phải chờ mạng. Đặt vô điều kiện:
    // lúc tải lại trang, effect ở app.ts chạy một nhịp với user = null (phiên
    // chưa khôi phục xong) và đã hạ isAdmin xuống false, nên nếu chỉ ghi đè khi
    // đang là null thì giá trị nhớ chẳng bao giờ được dùng. Khoá theo userId
    // nên chỉ áp cho đúng người vừa đăng nhập, và câu trả lời thật ngay bên
    // dưới sẽ sửa lại nếu sai.
    const cached = this.readCache();
    if (cached !== null) this.isAdmin.set(cached);

    const r = await this.req<{ isAdmin: boolean }>('/check');

    // `req` trả null cho CẢ "mất mạng / API 500" lẫn "bị từ chối", nên nếu cứ
    // thấy null là hạ xuống false thì mỗi lần API chớp một cái là nút Quản trị
    // biến mất tới tận lần tải trang sau. Không có câu trả lời thì giữ nguyên
    // thứ đang biết, đừng đoán.
    if (r === null) return this.isAdmin() === true;

    const ok = !!r.isAdmin;
    this.isAdmin.set(ok);
    this.writeCache(ok);
    return ok;
  }

  stats() { return this.req<AdminStats>('/stats'); }

  // ── Rút tiền ────────────────────────────────────────────────────────────────
  payouts(status = 'ALL') { return this.req<AdminPayout[]>(`/payouts?status=${status}`); }
  approvePayout(id: string) { return this.req(`/payouts/${id}/approve`, { method: 'POST' }); }
  markPayoutPaid(id: string, bankRef: string) {
    return this.req(`/payouts/${id}/paid`, { method: 'POST', body: JSON.stringify({ bankRef }) });
  }
  rejectPayout(id: string, reason: string) {
    return this.req(`/payouts/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  }

  // ── Báo cáo ảnh ─────────────────────────────────────────────────────────────
  reports(status = 'OPEN') { return this.req<AdminReportGroup[]>(`/reports?status=${status}`); }
  resolveReports(pinId: string) { return this.req(`/reports/${pinId}/resolve`, { method: 'POST' }); }
  deletePin(id: string) { return this.req(`/pins/${id}`, { method: 'DELETE' }); }

  // ── Sự cố chuyển khoản ──────────────────────────────────────────────────────
  paymentReports(status = 'OPEN') { return this.req<AdminPaymentReport[]>(`/payment-reports?status=${status}`); }
  resolvePaymentReport(id: string) { return this.req(`/payment-reports/${id}/resolve`, { method: 'POST' }); }

  // ── Người dùng ──────────────────────────────────────────────────────────────
  users(q = '') { return this.req<AdminUser[]>(`/users?q=${encodeURIComponent(q)}`); }
  banUser(id: string, banned: boolean) {
    return this.req(`/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) });
  }

  // ── Doanh thu ───────────────────────────────────────────────────────────────
  payments(status = 'ALL') { return this.req<AdminPayment[]>(`/payments?status=${status}`); }
  revenueDaily() { return this.req<{ date: string; amountVnd: number }[]>('/revenue/daily'); }
  wallets() { return this.req<AdminWalletRow[]>('/wallets'); }

  // ── Nội dung ────────────────────────────────────────────────────────────────
  pins(filter = 'all', q = '') {
    return this.req<AdminPin[]>(`/pins?filter=${filter}&q=${encodeURIComponent(q)}`);
  }
}
