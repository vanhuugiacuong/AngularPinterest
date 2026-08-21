import { Injectable } from '@angular/core';
import { API_BASE_URL } from '../api-base';

export type MessageRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REPORTED';

export type ReportReason =
  | 'SPAM'
  | 'HARASSMENT'
  | 'HATE_SPEECH'
  | 'IMPERSONATION'
  | 'INAPPROPRIATE_CONTENT'
  | 'OTHER';

export interface PublicUserSummary {
  id: string;
  username: string;
  avatarUrl?: string | null;
}

export interface MessageRequestRecord {
  id: string;
  senderId: string;
  receiverId: string;
  status: MessageRequestStatus;
  createdAt: string;
  respondedAt?: string | null;
  sender?: PublicUserSummary;
  receiver?: PublicUserSummary;
}

export interface AcceptRequestResult {
  request: MessageRequestRecord;
  conversationId: string;
}

export interface ConversationSummary {
  id: string;
  otherUser: PublicUserSummary;
  lastMessage: { content: string; createdAt: string; senderId: string } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt?: string | null;
}

export interface PagedMessages {
  items: ConversationMessage[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class MessagingService {
  private readonly requestsUrl = `${API_BASE_URL}/api/message-requests`;
  private readonly conversationsUrl = `${API_BASE_URL}/api/conversations`;

  async sendMessageRequest(receiverId: string, token: string): Promise<MessageRequestRecord> {
    return this.request<MessageRequestRecord>(`${this.requestsUrl}/${receiverId}`, token, {
      method: 'POST',
    });
  }

  async listIncomingRequests(token: string): Promise<MessageRequestRecord[]> {
    return this.request<MessageRequestRecord[]>(`${this.requestsUrl}/incoming`, token);
  }

  async listOutgoingRequests(token: string): Promise<MessageRequestRecord[]> {
    return this.request<MessageRequestRecord[]>(`${this.requestsUrl}/outgoing`, token);
  }

  async acceptRequest(id: string, token: string): Promise<AcceptRequestResult> {
    return this.request<AcceptRequestResult>(`${this.requestsUrl}/${id}/accept`, token, {
      method: 'PATCH',
    });
  }

  async rejectRequest(id: string, token: string): Promise<MessageRequestRecord> {
    return this.request<MessageRequestRecord>(`${this.requestsUrl}/${id}/reject`, token, {
      method: 'PATCH',
    });
  }

  async reportRequest(
    id: string,
    reason: ReportReason,
    details: string | undefined,
    token: string,
  ): Promise<{ request: MessageRequestRecord }> {
    return this.request(`${this.requestsUrl}/${id}/report`, token, {
      method: 'PATCH',
      body: JSON.stringify({ reason, details }),
    });
  }

  async listConversations(token: string): Promise<ConversationSummary[]> {
    return this.request<ConversationSummary[]>(this.conversationsUrl, token);
  }

  async openDirectConversation(userId: string, token: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(`${this.conversationsUrl}/direct/${userId}`, token, {
      method: 'POST',
    });
  }

  async getMessages(
    conversationId: string,
    page: number,
    limit: number,
    token: string,
  ): Promise<PagedMessages> {
    return this.request<PagedMessages>(
      `${this.conversationsUrl}/${conversationId}/messages?page=${page}&limit=${limit}`,
      token,
    );
  }

  async sendMessage(
    conversationId: string,
    content: string,
    token: string,
  ): Promise<ConversationMessage> {
    return this.request<ConversationMessage>(`${this.conversationsUrl}/${conversationId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async markRead(conversationId: string, token: string): Promise<{ success: boolean }> {
    return this.request(`${this.conversationsUrl}/${conversationId}/read`, token, {
      method: 'PATCH',
    });
  }

  private async request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
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
