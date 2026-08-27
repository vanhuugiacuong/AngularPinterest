import { Injectable, inject, signal } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import { SupabaseService } from './supabase';

export interface NovaTokenEntry {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  description: string;
  createdAt: string;
}
export interface NovaTokenTopUp {
  id: string;
  tokenAmount: string;
  vndAmount: string;
  paymentReference: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  createdAt: string;
}
export interface NovaTokenWallet {
  balance: string;
  rateVnd: number;
  packages: { tokens: number; vndAmount: number }[];
  entries: NovaTokenEntry[];
  topUps: NovaTokenTopUp[];
  withdrawableBalance: string;
  payoutAccount: { bankCode: string; accountNumber: string; accountName: string } | null;
  withdrawals: DemoWithdrawal[];
}
export interface DemoWithdrawal {
  id: string;
  amount: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  status: 'DEMO_COMPLETED';
  note: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NovaTokenService {
  private auth = inject(SupabaseService);
  wallet = signal<NovaTokenWallet | null>(null);

  private async request<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
    const token = await this.auth.getSessionToken();
    const response = await safeFetch(`${API_BASE_URL}/api/novatoken${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Không thể xử lý giao dịch ví.');
    return data as T;
  }

  async load() {
    const value = await this.request<NovaTokenWallet>();
    this.wallet.set(value);
    return value;
  }
  createTopUp(tokens: number) {
    return this.request<NovaTokenTopUp>('/topups', 'POST', { tokens });
  }
  getTopUp(id: string) {
    return this.request<NovaTokenTopUp>(`/topups/${id}`);
  }
  async createDemoWithdrawal(amount: number) {
    const value = await this.request<DemoWithdrawal>('/withdrawals/demo', 'POST', { amount });
    await this.load();
    return value;
  }
  async purchase(pinId: string) {
    const purchase = await this.request<{
      id: string;
      status: string;
      amount: string;
      currency: 'VND';
    }>(`/purchase/${pinId}`, 'POST');
    await this.load();
    return purchase;
  }
}
