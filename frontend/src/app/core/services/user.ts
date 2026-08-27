import { Injectable } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import type { MembershipPlan } from '../models/membership-plan';

export interface ProfileUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt: string;
  plan: MembershipPlan;
  isPrivate?: boolean;
}

export interface ProfileCounts {
  posts: number;
  albums: number;
  followers: number;
  following: number;
  favorites: number | null;
  privateBoards: number | null;
}

/** Mirrors backend MessageRequestStatus, but from the viewer's point of
 * view: PENDING is split into outgoing/incoming so the profile action
 * button can render the right label without knowing who sent it. */
export type MessageRequestRelationshipStatus =
  | 'NONE'
  | 'PENDING_OUTGOING'
  | 'PENDING_INCOMING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'REPORTED';

/** Mirrors backend FollowStatus, but from the viewer's point of view —
 * PENDING is split into outgoing/incoming, matching MessageRequestRelationshipStatus. */
export type FollowRelationshipStatus = 'NONE' | 'PENDING_OUTGOING' | 'PENDING_INCOMING' | 'ACCEPTED';

export interface ProfileViewerState {
  isOwnProfile: boolean;
  isFollowing: boolean;
  isFollowedBy: boolean;
  isMutualFollow: boolean;
  hasPendingFollowRequest?: boolean;
  followRequestStatus: FollowRelationshipStatus;
  canViewFavorites: boolean;
  canViewPrivateBoards: boolean;
  messageRequestStatus: MessageRequestRelationshipStatus;
  conversationId: string | null;
  isBlocked: boolean;
  isBlockedByTarget: boolean;
  canMessage: boolean;
  canSendMessageRequest: boolean;
  /** false when the profile owner has a private account and the viewer is
   * neither the owner nor an accepted follower — the posts/albums grid must
   * not be requested or rendered in this case (backend also enforces this,
   * this flag only decides what the UI should even attempt to show). */
  canViewPosts: boolean;
}

export interface ProfileSummary {
  user: ProfileUser;
  counts: ProfileCounts;
  viewer: ProfileViewerState;
}

export interface ProfilePin {
  id: string;
  title: string;
  description?: string | null;
  imageUrl: string;
  sourceUrl?: string | null;
  userId: string;
  createdAt: string;
  favoritedAt?: string;
  isAiGenerated: boolean;
  promptUsed?: string | null;
  negativePrompt?: string | null;
  generationModel?: string | null;
  category: string;
  isLiked: boolean;
  user: {
    id: string;
    username: string;
    avatarUrl?: string | null;
    plan: MembershipPlan;
  };
  _count: {
    likes: number;
    comments: number;
  };
}

export interface ProfileAlbumThumbnail {
  id: string;
  title: string;
  imageUrl: string;
  isAiGenerated: boolean;
}

export interface ProfileAlbum {
  id: string;
  name: string;
  description?: string | null;
  isSecret: boolean;
  userId: string;
  createdAt: string;
  pinCount: number;
  thumbnails: ProfileAlbumThumbnail[];
}

export interface PagedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/** Public-safe account match for search — never carries email or other
 * private profile data (see UsersService.searchUsers on the backend). */
export interface UserSearchResult {
  id: string;
  username: string;
  avatarUrl?: string | null;
  plan: MembershipPlan;
}

/** One row in a followers/following list — includes the viewer's relationship
 * to this person so the row can render the right follow-button state without
 * a second round-trip. */
export interface UserConnection {
  id: string;
  username: string;
  avatarUrl?: string | null;
  bio?: string | null;
  plan: MembershipPlan;
  viewerIsFollowing: boolean;
  followsViewer: boolean;
}

/** A pending request to follow a private account, from the receiver's
 * point of view (list of people asking to follow them). */
export interface FollowRequestRecord {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
  respondedAt: string | null;
  sender: {
    id: string;
    username: string;
    avatarUrl?: string | null;
    plan: MembershipPlan;
  };
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly baseUrl = `${API_BASE_URL}/api/users`;

  async getUserProfile(username: string, token?: string): Promise<ProfileSummary> {
    return this.request<ProfileSummary>(`${this.baseUrl}/${encodeURIComponent(username)}`, token);
  }

  async getUserPosts(
    username: string,
    page: number,
    limit: number,
    token?: string,
  ): Promise<PagedResponse<ProfilePin>> {
    return this.request<PagedResponse<ProfilePin>>(
      `${this.baseUrl}/${encodeURIComponent(username)}/posts?page=${page}&limit=${limit}`,
      token,
    );
  }

  async getUserAlbums(
    username: string,
    page: number,
    limit: number,
    token?: string,
  ): Promise<PagedResponse<ProfileAlbum>> {
    return this.request<PagedResponse<ProfileAlbum>>(
      `${this.baseUrl}/${encodeURIComponent(username)}/boards?page=${page}&limit=${limit}`,
      token,
    );
  }

  async getPrivateBoards(
    page: number,
    limit: number,
    token: string,
  ): Promise<PagedResponse<ProfileAlbum>> {
    return this.request<PagedResponse<ProfileAlbum>>(
      `${this.baseUrl}/me/private-boards?page=${page}&limit=${limit}`,
      token,
    );
  }

  async getFavorites(
    page: number,
    limit: number,
    token: string,
  ): Promise<PagedResponse<ProfilePin>> {
    return this.request<PagedResponse<ProfilePin>>(
      `${this.baseUrl}/me/favorites?page=${page}&limit=${limit}`,
      token,
    );
  }

  /** Sửa hồ sơ của chính người dùng đang đăng nhập - tên hiển thị/ID, tiểu sử,
   * và tuỳ chọn ảnh đại diện mới. Trả về bản ghi User đầy đủ (khớp DbUser)
   * để gọi nơi cập nhật ngay SupabaseService.dbUser mà không cần tải lại. */
  async updateProfile(
    input: { displayName?: string; username?: string; bio?: string; avatar?: File },
    token: string,
  ): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
    createdAt: string;
    plan: MembershipPlan;
  }> {
    const formData = new FormData();
    if (input.displayName !== undefined) formData.append('displayName', input.displayName);
    if (input.username !== undefined) formData.append('username', input.username);
    if (input.bio !== undefined) formData.append('bio', input.bio);
    if (input.avatar) formData.append('avatar', input.avatar);
    return this.request(`${this.baseUrl}/me`, token, { method: 'PATCH', body: formData });
  }

  async updatePrivacy(isPrivate: boolean, token: string): Promise<{ isPrivate: boolean }> {
    return this.request(`${this.baseUrl}/me/privacy`, token, {
      method: 'PATCH',
      body: JSON.stringify({ isPrivate }),
    });
  }

  async searchUsers(query: string, limit = 8): Promise<UserSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const result = await this.request<{ items: UserSearchResult[] }>(
      `${this.baseUrl}/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`,
    );
    return result.items || [];
  }

  async getFollowers(
    username: string,
    page: number,
    limit: number,
    token?: string,
  ): Promise<PagedResponse<UserConnection>> {
    return this.request<PagedResponse<UserConnection>>(
      `${this.baseUrl}/${encodeURIComponent(username)}/followers?page=${page}&limit=${limit}`,
      token,
    );
  }

  async getFollowing(
    username: string,
    page: number,
    limit: number,
    token?: string,
  ): Promise<PagedResponse<UserConnection>> {
    return this.request<PagedResponse<UserConnection>>(
      `${this.baseUrl}/${encodeURIComponent(username)}/following?page=${page}&limit=${limit}`,
      token,
    );
  }

  async toggleFollow(
    id: string,
    token: string,
  ): Promise<{ followRequestStatus: FollowRelationshipStatus; followerCount: number; followingCount: number }> {
    return this.request(`${this.baseUrl}/${id}/follow`, token, { method: 'POST' });
  }

  async getIncomingFollowRequests(token: string): Promise<FollowRequestRecord[]> {
    return this.request<FollowRequestRecord[]>(`${this.baseUrl}/me/follow-requests`, token);
  }

  async acceptFollowRequest(requesterId: string, token: string): Promise<{ accepted: boolean }> {
    return this.request(`${this.baseUrl}/follow-requests/${requesterId}/accept`, token, { method: 'PATCH' });
  }

  async rejectFollowRequest(requesterId: string, token: string): Promise<{ rejected: boolean }> {
    return this.request(`${this.baseUrl}/follow-requests/${requesterId}/reject`, token, { method: 'PATCH' });
  }

  private async request<T>(url: string, token?: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    const response = await safeFetch(url, { ...init, headers });
    if (!response.ok) {
      let message = `Yêu cầu thất bại (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || message;
      } catch {
        // Keep the status-based message when the server does not return JSON.
      }
      throw new Error(message);
    }
    const payload = await response.json();
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
}
