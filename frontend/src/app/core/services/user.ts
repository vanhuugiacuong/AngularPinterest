import { Injectable } from '@angular/core';

export interface ProfileUser {
  id: string;
  username: string;
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt: string;
}

export interface ProfileCounts {
  posts: number;
  albums: number;
  followers: number;
  following: number;
  favorites: number | null;
}

export interface ProfileSummary {
  user: ProfileUser;
  counts: ProfileCounts;
  viewer: {
    isOwnProfile: boolean;
    isFollowing: boolean;
    canViewFavorites: boolean;
  };
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

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly baseUrl = 'http://localhost:3000/api/users';

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

  async toggleFollow(
    id: string,
    token: string,
  ): Promise<{ followed: boolean; followerCount: number }> {
    return this.request<{ followed: boolean; followerCount: number }>(
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

    const response = await fetch(url, { ...init, headers });
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
