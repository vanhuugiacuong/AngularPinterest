import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import { SupabaseService } from './supabase';
import type { MembershipPlan } from '../models/membership-plan';
import type { PayoutAccount } from './membership';

export type AuctionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export interface AuctionBidder {
  id: string;
  username: string;
  avatarUrl?: string | null;
  plan: MembershipPlan;
}

export interface AuctionBid {
  id: string;
  amount: string;
  createdAt: string;
  bidder: AuctionBidder;
}

export interface AuctionDetail {
  id: string;
  pinId: string;
  pin: { id: string; title: string; imageUrl: string; userId: string };
  sellerId: string;
  status: AuctionStatus;
  currency: 'VND';
  startingPrice: string;
  currentPrice: string;
  minimumIncrement: string;
  startsAt: string;
  endsAt: string;
  bidCount: number;
  winnerId: string | null;
  /** Mốc thời gian server tại lúc trả response — đếm ngược ở frontend phải
   * tính offset dựa vào đây, không dùng trực tiếp đồng hồ máy client. */
  serverNow: string;
  bids: AuctionBid[];
  /** Chỉ có giá trị khi viewer chính là người thắng — thông tin thanh toán
   * (bao gồm QR tài khoản người bán) để hoàn tất giao dịch. */
  myPurchase: {
    id: string;
    status: string;
    paymentReference: string | null;
    amount: string;
    sellerPayout: PayoutAccount | null;
  } | null;
}

export interface AuctionSellingSummary {
  id: string;
  pin: { id: string; title: string; imageUrl: string };
  status: AuctionStatus;
  currency: 'VND';
  startingPrice: string;
  currentPrice: string;
  minimumIncrement: string;
  startsAt: string;
  endsAt: string;
  bidCount: number;
  winner: { id: string; username: string; avatarUrl?: string | null } | null;
  purchaseStatus: string | null;
}

export interface AuctionBiddingSummary {
  auctionId: string;
  pin: { id: string; title: string; imageUrl: string };
  status: AuctionStatus;
  currentPrice: string;
  myLastBid: string;
  endsAt: string;
  isWinning: boolean;
}

export interface CreateAuctionInput {
  pinId: string;
  startingPrice: number;
  minimumIncrement: number;
  startsAt: string;
  endsAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuctionService {
  private auth = inject(SupabaseService);
  private baseUrl = `${API_BASE_URL}/api/auctions`;

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.auth.getSessionToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    const response = await safeFetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      let message = `Yêu cầu thất bại (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || message;
      } catch {
        // Giữ message theo status nếu server không trả JSON.
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  }

  create(body: CreateAuctionInput): Promise<AuctionDetail> {
    return this.request<AuctionDetail>('', { method: 'POST', body: JSON.stringify(body) });
  }

  getById(id: string): Promise<AuctionDetail> {
    return this.request<AuctionDetail>(`/${id}`);
  }

  placeBid(id: string, amount: number, requestKey: string): Promise<AuctionDetail> {
    return this.request<AuctionDetail>(`/${id}/bids`, {
      method: 'POST',
      body: JSON.stringify({ amount, requestKey }),
    });
  }

  cancel(id: string): Promise<AuctionDetail> {
    return this.request<AuctionDetail>(`/${id}/cancel`, { method: 'POST' });
  }

  listSelling(): Promise<AuctionSellingSummary[]> {
    return this.request<AuctionSellingSummary[]>('/me/selling');
  }

  listBidding(): Promise<AuctionBiddingSummary[]> {
    return this.request<AuctionBiddingSummary[]>('/me/bidding');
  }
}
