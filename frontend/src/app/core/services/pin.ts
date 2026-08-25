import { Injectable } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import type { MembershipPlan } from '../models/membership-plan';

export interface PinAuthor {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string;
  plan: MembershipPlan;
}

export interface PinComment {
  id: string;
  content: string;
  createdAt: string;
  user: PinAuthor;
}

/** Loại niêm yết của pin — suy ra ở backend từ isForSale + phiên đấu giá
 * chưa hủy, không bao giờ do client tự quyết định. */
export type PinListingType = 'NONE' | 'FIXED_PRICE' | 'AUCTION';

export interface PinAuctionSummary {
  id: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  startingPrice: string;
  currentPrice: string;
  minimumIncrement: string;
  currency: 'VND';
  startsAt: string;
  endsAt: string;
  bidCount: number;
}

export interface Pin {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  sourceUrl?: string;
  userId: string;
  createdAt: string;
  isAiGenerated: boolean;
  isLiked?: boolean;
  likeCount?: number;
  _count?: { likes: number; comments?: number };
  comments?: PinComment[];
  user: PinAuthor;
  /** Giá bán cố định — Decimal của backend được serialize thành chuỗi qua JSON. */
  price?: string | number | null;
  isForSale?: boolean;
  currency?: 'VND';
  listingType?: PinListingType;
  auction?: PinAuctionSummary | null;
}

@Injectable({
  providedIn: 'root',
})
export class PinService {
  private baseUrl = `${API_BASE_URL}/api/pins`;

  private async request<T>(url: string, token: string | undefined, init: RequestInit, fallback: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    const response = await safeFetch(url, { ...init, headers });
    if (!response.ok) {
      let message = `${fallback} (${response.status})`;
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

  getPins(page = 1, limit = 20, token?: string, seed?: string): Promise<Pin[]> {
    let url = `${this.baseUrl}?page=${page}&limit=${limit}`;
    if (seed) url += `&seed=${seed}`;
    return this.request<Pin[]>(url, token, {}, 'Không thể tải ảnh');
  }

  searchPins(query: string, page = 1, limit = 20): Promise<Pin[]> {
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
    return this.request<Pin[]>(url, undefined, {}, 'Không thể tìm kiếm');
  }

  /** Reverse image search: uploads a File (not yet a saved Pin) to the CLIP
   * embedding pipeline on the backend and returns real database matches. */
  searchPinsByImage(file: File, limit = 40): Promise<Pin[]> {
    const formData = new FormData();
    formData.append('image', file);
    return this.request<Pin[]>(
      `${this.baseUrl}/search-by-image?limit=${limit}`,
      undefined,
      { method: 'POST', body: formData },
      'Tìm kiếm bằng hình ảnh thất bại',
    );
  }

  /** Same-origin-CORS proxy for a pin's own stored image — used as a
   * canvas-safe fallback by the region-select image search tool when the
   * CDN itself doesn't allow a cross-origin fetch to read the response. */
  getImageProxyUrl(id: string): string {
    return `${this.baseUrl}/${id}/image-proxy`;
  }

  getRelatedPins(id: string, page = 1, limit = 20): Promise<Pin[]> {
    return this.request<Pin[]>(`${this.baseUrl}/${id}/related?page=${page}&limit=${limit}`, undefined, {}, 'Không thể tải ảnh liên quan');
  }

  getPinById(id: string, token?: string): Promise<Pin> {
    return this.request<Pin>(`${this.baseUrl}/${id}`, token, {}, 'Không thể tải chi tiết ảnh');
  }

  toggleLike(id: string, token: string): Promise<{ liked: boolean; likeCount: number }> {
    return this.request(`${this.baseUrl}/${id}/like`, token, { method: 'POST' }, 'Không thể thích ảnh');
  }

  deletePin(id: string, token: string): Promise<{ success: boolean }> {
    return this.request(`${this.baseUrl}/${id}`, token, { method: 'DELETE' }, 'Không thể xoá ảnh');
  }

  addComment(id: string, content: string, token: string): Promise<PinComment> {
    return this.request<PinComment>(
      `${this.baseUrl}/${id}/comment`,
      token,
      { method: 'POST', body: JSON.stringify({ content }) },
      'Không thể thêm bình luận',
    );
  }

  /** Pre-submit NSFW check so the user gets feedback before hitting "Đăng".
   * This is a UX convenience only — createUploadPin() below is checked again
   * server-side, since the backend can never trust a client-reported result. */
  checkImageModeration(file: File, token: string): Promise<{ safe: boolean; message?: string }> {
    const formData = new FormData();
    formData.append('image', file);
    return this.request(
      `${this.baseUrl}/check-image`,
      token,
      { method: 'POST', body: formData },
      'Không thể kiểm tra ảnh lúc này',
    );
  }

  createUploadPin(formData: FormData, token: string): Promise<Pin> {
    return this.request<Pin>(this.baseUrl, token, { method: 'POST', body: formData }, 'Không thể tải ảnh lên');
  }

  saveAiPin(body: unknown, token: string): Promise<Pin> {
    return this.request<Pin>(
      `${this.baseUrl}/ai-save`,
      token,
      { method: 'POST', body: JSON.stringify(body) },
      'Không thể lưu ảnh AI',
    );
  }
}
