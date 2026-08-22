import { Injectable, inject, signal } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { SupabaseService } from './supabase';
import { safeFetch } from '../utils/http-error';
import type { MembershipPlan } from '../models/membership-plan';
export type { MembershipPlan } from '../models/membership-plan';
export interface MembershipStatus {
  plan: MembershipPlan; ownedPlans: MembershipPlan[]; planStartedAt: string | null; planExpiresAt: string | null;
  aiUsed: number; aiLimit: number; aiRemaining: number; aiResetAt: string;
  aiDailyLimit: number; cleanDownload: boolean; customWatermark: boolean; advancedWatermark: boolean; maxWatermarkPresets: number;
  canDownloadClean: boolean; canSell: boolean;
}
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
export interface MembershipPayment {
  id: string; userId: string; plan: MembershipPlan; amount: string; paymentReference: string;
  status: PaymentStatus; provider: string; createdAt: string; verifiedAt: string | null;
}
@Injectable({ providedIn: 'root' })
export class MembershipService {
  private auth = inject(SupabaseService);
  status = signal<MembershipStatus | null>(null);
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await this.auth.getSessionToken();
    const response = await safeFetch(`${API_BASE_URL}/api/memberships${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Yêu cầu không thành công.');
    return data;
  }
  async load() { const value = await this.request<MembershipStatus>('/me'); this.status.set(value); return value; }
  async subscribe(plan: MembershipPlan) { const value = await this.request<MembershipStatus>('/subscribe', 'POST', { plan }); this.status.set(value); return value; }
  async consumeAi() { const value = await this.request<{ used: number; limit: number; remaining: number }>('/ai/consume', 'POST'); this.status.update(s => s ? { ...s, aiUsed: value.used, aiLimit: value.limit, aiRemaining: value.remaining } : s); return value; }
  purchase(pinId: string) {
    return this.request<{ id: string; status: PaymentStatus; paymentReference: string; amount: string }>(
      `/pins/${pinId}/purchase`,
      'POST',
    );
  }
  createPayment(plan: MembershipPlan) { return this.request<MembershipPayment>('/payments', 'POST', { plan }); }
  getPayment(id: string) { return this.request<MembershipPayment>(`/payments/${id}`); }
  listPayments() { return this.request<MembershipPayment[]>('/payments'); }
  listSales() {
    return this.request<{ sales: MarketplaceSale[]; revenue: number }>('/marketplace/sales');
  }
  listPurchases() { return this.request<MarketplaceSale[]>('/marketplace/purchases'); }
}

export interface MarketplaceSale {
  id: string;
  pinId: string;
  amount: string;
  status: PaymentStatus;
  paymentReference: string | null;
  createdAt: string;
  verifiedAt: string | null;
  pin: { id: string; title: string; imageUrl: string };
  buyer?: { username: string };
  seller?: { username: string };
}
