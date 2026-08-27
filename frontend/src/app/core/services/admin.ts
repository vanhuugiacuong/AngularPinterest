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
  proCount: number;
  creditsCirculating: number;
  creditsEarnedTotal: number;
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

  private async token(): Promise<string | null> {
    try {
      return await this.supa.getSessionToken();
    } catch {
      return null;
    }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const token = await this.token();
    if (!token) return null;
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      if (init.body) headers.set('Content-Type', 'application/json');
      const res = await fetch(`${this.api}${path}`, { ...init, headers });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** Kiểm tra quyền để hiện/ẩn mục menu. Kết quả thật do backend quyết. */
  async checkAdmin(): Promise<boolean> {
    const r = await this.req<{ isAdmin: boolean }>('/check');
    const ok = !!r?.isAdmin;
    this.isAdmin.set(ok);
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
