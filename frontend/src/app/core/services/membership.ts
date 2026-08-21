import { Injectable, inject, signal } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { SupabaseService } from './supabase';
export type MembershipPlan = 'FREE' | 'PLUS' | 'PRO';
export interface MembershipStatus { plan: MembershipPlan; ownedPlans: MembershipPlan[]; aiUsed: number; aiLimit: number; aiRemaining: number; canDownloadClean: boolean; canSell: boolean; }
@Injectable({ providedIn: 'root' })
export class MembershipService {
  private auth = inject(SupabaseService);
  status = signal<MembershipStatus | null>(null);
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await this.auth.getSessionToken();
    const response = await fetch(`${API_BASE_URL}/api/memberships${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Yêu cầu không thành công.');
    return data;
  }
  async load() { const value = await this.request<MembershipStatus>('/me'); this.status.set(value); return value; }
  async subscribe(plan: MembershipPlan) { const value = await this.request<MembershipStatus>('/subscribe', 'POST', { plan }); this.status.set(value); return value; }
  async consumeAi() { const value = await this.request<{ used: number; limit: number; remaining: number }>('/ai/consume', 'POST'); this.status.update(s => s ? { ...s, aiUsed: value.used, aiLimit: value.limit, aiRemaining: value.remaining } : s); return value; }
  purchase(pinId: string) { return this.request<{ imageUrl: string; paid: boolean }>(`/pins/${pinId}/purchase`, 'POST'); }
}
