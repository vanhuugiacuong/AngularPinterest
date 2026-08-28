import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import type { MembershipPlan } from '../models/membership-plan';

export interface PinAuthor {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string;
  plan: MembershipPlan;
  isAdmin?: boolean;
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
  hasPurchased?: boolean;
  category?: string;
  promptUsed?: string | null;
  negativePrompt?: string | null;
  generationModel?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class PinService {
  private baseUrl = `${API_BASE_URL}/api/pins`;
  private readonly createdPinsSubject = new ReplaySubject<Pin>(20);
  readonly createdPins$ = this.createdPinsSubject.asObservable();

  /** Shares successful creates with profile views, including views created
   * only after the router leaves /create. Replay keeps recent session
   * creates available across that component boundary. */
  notifyPinCreated(pin: Pin): void {
    this.createdPinsSubject.next(pin);
  }

  private async request<T>(
    url: string,
    token: string | undefined,
    init: RequestInit,
    fallback: string,
  ): Promise<T> {
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
    const payload = await response.json();
    // The backend uses same-origin paths for protected/blurred image
    // endpoints. Prefix them in local development, where Angular and Nest run
    // on different ports; production remains same-origin.
    const normalizeImageUrls = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(normalizeImageUrls);
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record['imageUrl'] === 'string' && record['imageUrl'].startsWith('/api/')) {
        record['imageUrl'] = `${API_BASE_URL}${record['imageUrl']}`;
      }
      Object.values(record).forEach(normalizeImageUrls);
    };
    normalizeImageUrls(payload);
    return payload as T;
  }

  getPins(
    page = 1,
    limit = 20,
    token?: string,
    seed?: string,
    category?: string | null,
  ): Promise<Pin[]> {
    let url = `${this.baseUrl}?page=${page}&limit=${limit}`;
    if (seed) url += `&seed=${seed}`;
    // Lọc ở server: nếu lọc trên mảng đã tải thì infinite scroll không giữ được
    // filter và sẽ kéo cạn feed để nhặt vài tấm khớp danh mục.
    if (category) url += `&category=${encodeURIComponent(category)}`;
    return this.request<Pin[]>(url, token, {}, 'Không thể tải ảnh');
  }

  /** Danh mục có thật trong feed, kèm số pin. Nguồn để dựng chip lọc — dựng từ
   * pin đã tải thì chip bật ra giữa lúc cuộn và danh mục ở trang chưa tải sẽ
   * không chọn tới được. */
  getFeedCategories(token?: string): Promise<{ code: string; count: number }[]> {
    return this.request<{ code: string; count: number }[]>(
      `${this.baseUrl}/categories`,
      token,
      {},
      'Không thể tải danh mục',
    );
  }

  searchPins(query: string, page = 1, limit = 20): Promise<Pin[]> {
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
    return this.request<Pin[]>(url, undefined, {}, 'Không thể tìm kiếm');
  }

  /** Reverse image search: uploads a File (not yet a saved Pin) to the CLIP
   * embedding pipeline on the backend and returns real database matches. */
  /** limit 120, khong phai 40.
   *
   * Endpoint nay CO ho tro phan trang (page + limit, xem PinsService), nhung
   * phan trang o day dat: moi trang phai UPLOAD LAI ca tam anh, roi chay lai
   * CLIP embedding va kiem duyet NSFW cho dung mot ket qua da tinh o trang
   * truoc. Xin mot trang lon ngay tu dau re hon han, va nguong loc phia
   * backend (imageSearchMaxSimilarityGap) van la thu quyet dinh bao nhieu tam
   * that su du gan de hien — 120 chi la tran, khong phai chi tieu. */
  searchPinsByImage(file: File, limit = 120): Promise<Pin[]> {
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
    return this.request<Pin[]>(
      `${this.baseUrl}/${id}/related?page=${page}&limit=${limit}`,
      undefined,
      {},
      'Không thể tải ảnh liên quan',
    );
  }

  getPinById(id: string, token?: string): Promise<Pin> {
    return this.request<Pin>(`${this.baseUrl}/${id}`, token, {}, 'Không thể tải chi tiết ảnh');
  }

  /** Trang "Giá cố định" công khai — duyệt được kể cả chưa đăng nhập. */
  listFixedPrice(
    token?: string,
    skip = 0,
    take = 24,
  ): Promise<{ items: Pin[]; total: number; skip: number; take: number }> {
    return this.request(
      `${this.baseUrl}/fixed-price?skip=${skip}&take=${take}`,
      token,
      {},
      'Không thể tải danh sách sản phẩm',
    );
  }

  toggleLike(id: string, token: string): Promise<{ liked: boolean; likeCount: number }> {
    return this.request(
      `${this.baseUrl}/${id}/like`,
      token,
      { method: 'POST' },
      'Không thể thích ảnh',
    );
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
    return this.request<Pin>(
      this.baseUrl,
      token,
      { method: 'POST', body: formData },
      'Không thể tải ảnh lên',
    );
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
