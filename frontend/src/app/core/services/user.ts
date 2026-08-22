import { Injectable } from '@angular/core';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import type { MembershipPlan } from '../models/membership-plan';

export interface ProfileUser {
  id: string;
  username: string;
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt: string;
  plan: MembershipPlan;
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

export interface ProfileViewerState {
  isOwnProfile: boolean;
  isFollowing: boolean;
  isFollowedBy: boolean;
  isMutualFollow: boolean;
  canViewFavorites: boolean;
  canViewPrivateBoards: boolean;
  messageRequestStatus: MessageRequestRelationshipStatus;
  conversationId: string | null;
  isBlocked: boolean;
  isBlockedByTarget: boolean;
  canMessage: boolean;
  canSendMessageRequest: boolean;
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
  ): Promise<{ followed: boolean; followerCount: number; followingCount: number }> {
    return this.request<{ followed: boolean; followerCount: number; followingCount: number }>(
      `${this.baseUrl}/${id}/follow`,
      token,
      { method: 'POST' },
    );
  }

  private async request<T>(url: string, token?: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body) {
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
    return response.json() as Promise<T>;
  }
}
