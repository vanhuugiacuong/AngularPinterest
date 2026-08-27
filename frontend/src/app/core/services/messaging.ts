import { Injectable, effect, inject } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BehaviorSubject, Subject, timer } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { API_BASE_URL } from '../api-base';
import { safeFetch } from '../utils/http-error';
import { SupabaseService } from './supabase';
import { ToastService } from './toast';
import type { MembershipPlan } from '../models/membership-plan';

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
  plan: MembershipPlan;
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

interface RealtimeMessagePayload {
  conversationId: string;
  message: ConversationMessage;
  sender: PublicUserSummary;
}

@Injectable({ providedIn: 'root' })
export class MessagingService {
  private readonly requestsUrl = `${API_BASE_URL}/api/message-requests`;
  private readonly conversationsUrl = `${API_BASE_URL}/api/conversations`;
  private auth = inject(SupabaseService);
  private toast = inject(ToastService);

  private unreadCountSubject = new BehaviorSubject<number>(0);
  unreadCount$ = this.unreadCountSubject.asObservable();
  private lastConversations: ConversationSummary[] = [];
  private conversationUnreadCount = 0;
  private pendingIncomingRequestIds = new Set<string>();

  /** Fires the moment a new incoming message request is pushed over
   * realtime — MessagesComponent subscribes to trigger an immediate
   * refresh of its requests queue instead of waiting for the next poll
   * tick (see connectRealtime's 'message_request' broadcast handler). */
  private incomingRequestSubject = new Subject<MessageRequestRecord>();
  incomingRequest$ = this.incomingRequestSubject.asObservable();

  private realtimeChannel: RealtimeChannel | null = null;
  private realtimeUserId: string | null = null;
  /** Conversation currently open in the messages feature — set by
   * MessagesComponent. Suppresses the global toast/badge-bump for a message
   * the user is already looking at (that page has its own per-conversation
   * realtime channel + immediate markRead for that case). */
  activeConversationId: string | null = null;

  constructor() {
    this.startPolling();
    // Instant push — a per-user Supabase Realtime channel the backend
    // broadcasts to right after creating a message (see
    // ConversationsService.sendMessage). Polling stays on as a silent
    // reconciliation fallback in case a broadcast is missed.
    effect(() => {
      const userId = this.auth.user()?.id ?? null;
      this.connectRealtime(userId);
    });
  }

  private connectRealtime(userId: string | null): void {
    if (this.realtimeUserId === userId) return;
    if (this.realtimeChannel) {
      this.auth.getRealtimeClient().removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.realtimeUserId = userId;
    if (!userId) return;

    this.realtimeChannel = this.auth
      .getRealtimeClient()
      .channel(`user:${userId}`)
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        this.handleRealtimeMessage(payload as RealtimeMessagePayload);
      })
      .on('broadcast', { event: 'message_request' }, ({ payload }) => {
        this.handleRealtimeMessageRequest(payload as { request: MessageRequestRecord });
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.debug(`[MessagingService] Realtime kết nối OK — kênh user:${userId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.error(`[MessagingService] Realtime lỗi (${status}) trên kênh user:${userId}`, err);
        }
      });
  }

  private handleRealtimeMessage(payload: RealtimeMessagePayload): void {
    const { conversationId, message, sender } = payload;

    const existing = this.lastConversations.find((c) => c.id === conversationId);
    if (existing) {
      existing.lastMessage = { content: message.content, createdAt: message.createdAt, senderId: message.senderId };
      existing.updatedAt = message.createdAt;
      if (conversationId !== this.activeConversationId) existing.unreadCount += 1;
    }

    // Already looking at this conversation — its own realtime channel
    // renders the message and marks it read; no toast/badge needed here.
    if (conversationId === this.activeConversationId) return;

    this.conversationUnreadCount += 1;
    this.emitUnreadTotal();
    this.toast.notify(`${sender.username}: ${message.content}`);
  }

  private handleRealtimeMessageRequest(payload: { request: MessageRequestRecord }): void {
    const { request } = payload;
    this.incomingRequestSubject.next(request);
    if (!this.pendingIncomingRequestIds.has(request.id)) {
      this.pendingIncomingRequestIds.add(request.id);
      this.emitUnreadTotal();
    }
    const senderName = request.sender?.username ?? 'Ai đó';
    this.toast.notify(`${senderName} đã gửi cho bạn một yêu cầu nhắn tin.`);
  }

  /** Optimistically zeroes this conversation's contribution to the global
   * unread badge — called right after a successful markRead so the badge
   * clears the moment the user reads, not on the next 30s poll. */
  markConversationRead(conversationId: string): void {
    const conversation = this.lastConversations.find((c) => c.id === conversationId);
    if (!conversation || conversation.unreadCount === 0) return;
    const delta = conversation.unreadCount;
    conversation.unreadCount = 0;
    this.conversationUnreadCount = Math.max(0, this.conversationUnreadCount - delta);
    this.emitUnreadTotal();
  }

  /** Keeps the global message badge aligned with the actionable incoming
   * request queue. MessagesComponent calls this after each queue refresh;
   * the service poll below provides the same reconciliation app-wide. */
  syncIncomingRequests(requests: MessageRequestRecord[]): void {
    this.pendingIncomingRequestIds = new Set(
      requests.filter((request) => request.status === 'PENDING').map((request) => request.id),
    );
    this.emitUnreadTotal();
  }

  private markIncomingRequestHandled(requestId: string): void {
    if (!this.pendingIncomingRequestIds.delete(requestId)) return;
    this.emitUnreadTotal();
  }

  private emitUnreadTotal(): void {
    this.unreadCountSubject.next(this.conversationUnreadCount + this.pendingIncomingRequestIds.size);
  }

  private startPolling(): void {
    // timer(0, 30000) fires immediately (establishing the baseline) and then
    // every 30s after, mirroring NotificationService's cadence.
    timer(0, 30000)
      .pipe(
        switchMap(() => this.fetchUnreadState()),
        tap(({ conversationTotal, conversations, incomingRequests }) => {
          this.lastConversations = conversations;
          this.conversationUnreadCount = conversationTotal;
          this.syncIncomingRequests(incomingRequests);
        }),
        catchError(() =>
          of({
            conversationTotal: 0,
            conversations: [] as ConversationSummary[],
            incomingRequests: [] as MessageRequestRecord[],
          }),
        ),
      )
      .subscribe();
  }

  private async fetchUnreadState(): Promise<{
    conversationTotal: number;
    conversations: ConversationSummary[];
    incomingRequests: MessageRequestRecord[];
  }> {
    const token = await this.auth.getSessionToken();
    if (!token) return { conversationTotal: 0, conversations: [], incomingRequests: [] };
    const [conversations, incomingRequests] = await Promise.all([
      this.listConversations(token),
      this.listIncomingRequests(token),
    ]);
    const conversationTotal = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
    return { conversationTotal, conversations, incomingRequests };
  }

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
    const result = await this.request<AcceptRequestResult>(`${this.requestsUrl}/${id}/accept`, token, {
      method: 'PATCH',
    });
    this.markIncomingRequestHandled(id);
    return result;
  }

  async rejectRequest(id: string, token: string): Promise<MessageRequestRecord> {
    const result = await this.request<MessageRequestRecord>(`${this.requestsUrl}/${id}/reject`, token, {
      method: 'PATCH',
    });
    this.markIncomingRequestHandled(id);
    return result;
  }

  async reportRequest(
    id: string,
    reason: ReportReason,
    details: string | undefined,
    token: string,
  ): Promise<{ request: MessageRequestRecord }> {
    const result = await this.request<{ request: MessageRequestRecord }>(`${this.requestsUrl}/${id}/report`, token, {
      method: 'PATCH',
      body: JSON.stringify({ reason, details }),
    });
    this.markIncomingRequestHandled(id);
    return result;
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
