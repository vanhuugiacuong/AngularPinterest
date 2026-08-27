import { Injectable, signal } from '@angular/core';
import { API_BASE_URL } from '../api-base';

export type MessageContentType = 'TEXT' | 'IMAGE' | 'GIF' | 'PIN';

export interface PublicUserSummary {
  id: string;
  username: string;
  avatarUrl?: string | null;
  isPro?: boolean;
}

export interface MessagePinPreview {
  id: string;
  title: string;
  imageUrl: string;
  user?: PublicUserSummary;
}

export interface ConversationSummary {
  id: string;
  otherUser: PublicUserSummary;
  lastMessage: { type: MessageContentType; content: string | null; createdAt: string; senderId: string } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface MessageReplyPreview {
  id: string;
  type: MessageContentType;
  content: string | null;
  imageUrl?: string | null;
  gifUrl?: string | null;
  senderId: string;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageContentType;
  content: string | null;
  imageUrl?: string | null;
  gifUrl?: string | null;
  pinId?: string | null;
  pin?: MessagePinPreview | null;
  replyToId?: string | null;
  replyTo?: MessageReplyPreview | null;
  reactions?: MessageReaction[];
  createdAt: string;
  readAt?: string | null;
  deletedAt?: string | null;
  pinnedAt?: string | null;
}

export interface PagedMessages {
  items: ChatMessage[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface SendMessageInput {
  type?: MessageContentType;
  content?: string;
  imageUrl?: string;
  gifUrl?: string;
  pinId?: string;
  replyToId?: string;
}

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly baseUrl = `${API_BASE_URL}/api/conversations`;

  /** conversationId currently open on the Chat page, or null when the user isn't
   * looking at any conversation (including not being on /chat at all). Set/cleared
   * by the Chat component's route subscription — read by Navbar to decide whether
   * an incoming message needs a toast/badge bump or is already being seen live. */
  readonly activeConversationId = signal<string | null>(null);

  async listConversations(token: string): Promise<ConversationSummary[]> {
    return this.request<ConversationSummary[]>(this.baseUrl, token);
  }

  async openDirectConversation(userId: string, token: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(`${this.baseUrl}/direct/${userId}`, token, { method: 'POST' });
  }

  async searchUsers(query: string, token: string): Promise<PublicUserSummary[]> {
    return this.request<PublicUserSummary[]>(`${this.baseUrl}/users/search?q=${encodeURIComponent(query)}`, token);
  }

  async getMessages(conversationId: string, page: number, limit: number, token: string): Promise<PagedMessages> {
    return this.request<PagedMessages>(
      `${this.baseUrl}/${conversationId}/messages?page=${page}&limit=${limit}`,
      token,
    );
  }

  async sendMessage(conversationId: string, input: SendMessageInput, token: string): Promise<ChatMessage> {
    return this.request<ChatMessage>(`${this.baseUrl}/${conversationId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async markRead(conversationId: string, token: string): Promise<{ success: boolean }> {
    return this.request(`${this.baseUrl}/${conversationId}/read`, token, { method: 'PATCH' });
  }

  async toggleReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
    token: string,
  ): Promise<{ emoji: string | null; reactions: MessageReaction[] }> {
    return this.request(`${this.baseUrl}/${conversationId}/messages/${messageId}/react`, token, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  async unsendMessage(conversationId: string, messageId: string, token: string): Promise<ChatMessage> {
    return this.request(`${this.baseUrl}/${conversationId}/messages/${messageId}/unsend`, token, { method: 'POST' });
  }

  async togglePin(conversationId: string, messageId: string, token: string): Promise<ChatMessage> {
    return this.request(`${this.baseUrl}/${conversationId}/messages/${messageId}/pin`, token, { method: 'POST' });
  }

  async getPinnedMessage(conversationId: string, token: string): Promise<ChatMessage | null> {
    return this.request(`${this.baseUrl}/${conversationId}/pinned-message`, token);
  }

  /** Uploads a chat image and returns its public URL — call before sendMessage(type: 'IMAGE'). */
  async uploadChatImage(file: File, token: string): Promise<{ imageUrl: string }> {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${this.baseUrl}/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Tải ảnh lên thất bại'));
    }
    return response.json();
  }

  async searchGifs(query: string, token: string): Promise<GifResult[]> {
    return this.request<GifResult[]>(`${this.baseUrl}/gif/search?q=${encodeURIComponent(query)}`, token);
  }

  async trendingGifs(token: string): Promise<GifResult[]> {
    return this.request<GifResult[]>(`${this.baseUrl}/gif/trending`, token);
  }

  private async request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, `Yêu cầu thất bại (${response.status})`));
    }
    return response.json() as Promise<T>;
  }

  private async errorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const body = await response.json();
      return body.message || fallback;
    } catch {
      return fallback;
    }
  }
}
