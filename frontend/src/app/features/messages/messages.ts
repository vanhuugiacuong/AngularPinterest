import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Navbar } from '../../components/navbar/navbar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { SupabaseService } from '../../core/services/supabase';
import {
  ConversationMessage,
  ConversationSummary,
  MessageRequestRecord,
  MessagingService,
  ReportReason,
} from '../../core/services/messaging';

type Section = 'chats' | 'requests';
type RequestsTab = 'incoming' | 'outgoing';

const MAX_MESSAGE_LENGTH = 4000;

@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, UserAvatar],
  templateUrl: './messages.html',
  styleUrl: './messages.css',
})
export class Messages implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly messagingService = inject(MessagingService);
  private readonly supabaseService = inject(SupabaseService);

  @ViewChild('messageList') messageListRef?: ElementRef<HTMLDivElement>;

  readonly maxMessageLength = MAX_MESSAGE_LENGTH;

  readonly activeSection = signal<Section>('chats');
  readonly requestsTab = signal<RequestsTab>('incoming');

  readonly conversations = signal<ConversationSummary[]>([]);
  readonly conversationsLoading = signal(true);
  readonly conversationsError = signal<string | null>(null);

  readonly incomingRequests = signal<MessageRequestRecord[]>([]);
  readonly outgoingRequests = signal<MessageRequestRecord[]>([]);
  readonly requestsLoading = signal(true);
  readonly requestsError = signal<string | null>(null);
  readonly pendingRequestIds = signal<Set<string>>(new Set());

  readonly selectedConversationId = signal<string | null>(null);
  readonly messages = signal<ConversationMessage[]>([]);
  readonly messagesLoading = signal(true);
  readonly messagesError = signal<string | null>(null);
  readonly messagesHasMore = signal(false);
  readonly messagesLoadingMore = signal(false);

  readonly sendPending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly otherUserTyping = signal(false);
  readonly otherUserOnline = signal(false);
  messageDraft = '';

  readonly reportTarget = signal<MessageRequestRecord | null>(null);
  readonly reportReason = signal<ReportReason>('SPAM');
  readonly reportPending = signal(false);
  readonly reportError = signal<string | null>(null);
  reportDetails = '';

  private routeSubscription?: Subscription;
  private realtimeChannel?: RealtimeChannel;
  private typingTimer?: ReturnType<typeof setTimeout>;
  private messagesRequestVersion = 0;
  private messagesPage = 1;

  get currentUserId(): string | undefined {
    return this.supabaseService.dbUser()?.id || this.supabaseService.user()?.id;
  }

  async ngOnInit() {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const conversationId = params.get('conversationId');
      if (conversationId !== this.selectedConversationId()) {
        this.selectedConversationId.set(conversationId);
        if (conversationId) {
          this.messagesPage = 1;
          void this.loadMessages(conversationId);
          void this.markConversationRead(conversationId);
          void this.connectRealtime(conversationId);
        } else {
          this.messages.set([]);
          void this.disconnectRealtime();
        }
      }
    });

    await Promise.all([this.loadConversations(), this.loadRequests()]);

  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    void this.disconnectRealtime();
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.messagesRequestVersion += 1;
  }

  setSection(section: Section) {
    this.activeSection.set(section);
  }

  setRequestsTab(tab: RequestsTab) {
    this.requestsTab.set(tab);
  }

  selectConversation(id: string) {
    if (id === this.selectedConversationId()) return;
    void this.router.navigate(['/messages', id]);
  }

  backToList() {
    void this.router.navigate(['/messages']);
  }

  navigateToProfile(username: string | undefined | null) {
    if (!username) return;
    void this.router.navigate(['/profile', username]);
  }

  otherUserFor(conversationId: string) {
    return this.conversations().find((c) => c.id === conversationId)?.otherUser;
  }

  async loadConversations(silent = false) {
    if (!silent) {
      this.conversationsLoading.set(true);
      this.conversationsError.set(null);
    }
    try {
      const token = await this.requireToken();
      const list = await this.messagingService.listConversations(token);
      this.conversations.set(list);
    } catch (error) {
      if (!silent) {
        this.conversationsError.set(this.errorMessage(error, 'Không thể tải danh sách trò chuyện.'));
      }
    } finally {
      if (!silent) this.conversationsLoading.set(false);
    }
  }

  async loadRequests() {
    this.requestsLoading.set(true);
    this.requestsError.set(null);
    try {
      const token = await this.requireToken();
      const [incoming, outgoing] = await Promise.all([
        this.messagingService.listIncomingRequests(token),
        this.messagingService.listOutgoingRequests(token),
      ]);
      this.incomingRequests.set(incoming);
      this.outgoingRequests.set(outgoing);
    } catch (error) {
      this.requestsError.set(this.errorMessage(error, 'Không thể tải danh sách yêu cầu.'));
    } finally {
      this.requestsLoading.set(false);
    }
  }

  async loadMessages(conversationId: string, silent = false) {
    const version = ++this.messagesRequestVersion;
    if (!silent) {
      this.messagesLoading.set(true);
      this.messagesError.set(null);
    }
    try {
      const token = await this.requireToken();
      const page = await this.messagingService.getMessages(conversationId, 1, 30, token);
      if (version !== this.messagesRequestVersion) return;
      this.messages.set(page.items);
      this.messagesHasMore.set(page.hasMore);
      this.messagesPage = 1;
      if (!silent) setTimeout(() => this.scrollToBottom());
    } catch (error) {
      if (version !== this.messagesRequestVersion) return;
      if (!silent) {
        this.messagesError.set(this.errorMessage(error, 'Không thể tải tin nhắn.'));
      }
    } finally {
      if (version === this.messagesRequestVersion && !silent) {
        this.messagesLoading.set(false);
      }
    }
  }

  async loadMoreMessages() {
    const conversationId = this.selectedConversationId();
    if (!conversationId || this.messagesLoadingMore() || !this.messagesHasMore()) return;
    this.messagesLoadingMore.set(true);
    const container = this.messageListRef?.nativeElement;
    const previousHeight = container?.scrollHeight ?? 0;
    try {
      const token = await this.requireToken();
      const nextPage = this.messagesPage + 1;
      const page = await this.messagingService.getMessages(conversationId, nextPage, 30, token);
      this.messages.update((current) => [...page.items, ...current]);
      this.messagesHasMore.set(page.hasMore);
      this.messagesPage = nextPage;
      setTimeout(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - previousHeight;
        }
      });
    } catch {
      // Best-effort: leave hasMore as-is so the user can retry the click.
    } finally {
      this.messagesLoadingMore.set(false);
    }
  }

  async sendMessage() {
    const conversationId = this.selectedConversationId();
    const content = this.messageDraft.trim();
    if (!conversationId || !content || this.sendPending()) return;

    this.sendPending.set(true);
    this.sendError.set(null);
    try {
      const token = await this.requireToken();
      const message = await this.messagingService.sendMessage(conversationId, content, token);
      this.messages.update((current) => [...current, message]);
      this.messageDraft = '';
      await this.realtimeChannel?.send({ type: 'broadcast', event: 'message', payload: message });
      await this.broadcastTyping(false);
      setTimeout(() => this.scrollToBottom());
      this.conversations.update((current) =>
        current.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: { content: message.content, createdAt: message.createdAt, senderId: message.senderId },
                updatedAt: message.createdAt,
              }
            : c,
        ),
      );
    } catch (error) {
      this.sendError.set(this.errorMessage(error, 'Không thể gửi tin nhắn.'));
    } finally {
      this.sendPending.set(false);
    }
  }

  onDraftInput() {
    void this.broadcastTyping(this.messageDraft.trim().length > 0);
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => void this.broadcastTyping(false), 1400);
  }

  async acceptRequest(request: MessageRequestRecord) {
    if (this.isRequestPending(request.id)) return;
    this.setRequestPending(request.id, true);
    const previousIncoming = this.incomingRequests();
    this.incomingRequests.set(previousIncoming.filter((r) => r.id !== request.id));
    try {
      const token = await this.requireToken();
      const result = await this.messagingService.acceptRequest(request.id, token);
      await this.loadConversations();
      void this.router.navigate(['/messages', result.conversationId]);
    } catch (error) {
      this.incomingRequests.set(previousIncoming);
      this.requestsError.set(this.errorMessage(error, 'Không thể chấp nhận yêu cầu.'));
    } finally {
      this.setRequestPending(request.id, false);
    }
  }

  async rejectRequest(request: MessageRequestRecord) {
    if (this.isRequestPending(request.id)) return;
    this.setRequestPending(request.id, true);
    const previousIncoming = this.incomingRequests();
    this.incomingRequests.set(previousIncoming.filter((r) => r.id !== request.id));
    try {
      const token = await this.requireToken();
      await this.messagingService.rejectRequest(request.id, token);
    } catch (error) {
      this.incomingRequests.set(previousIncoming);
      this.requestsError.set(this.errorMessage(error, 'Không thể từ chối yêu cầu.'));
    } finally {
      this.setRequestPending(request.id, false);
    }
  }

  openReportDialog(request: MessageRequestRecord) {
    this.reportTarget.set(request);
    this.reportReason.set('SPAM');
    this.reportDetails = '';
    this.reportError.set(null);
  }

  closeReportDialog() {
    if (this.reportPending()) return;
    this.reportTarget.set(null);
    this.reportError.set(null);
  }

  async submitReport() {
    const request = this.reportTarget();
    if (!request || this.reportPending()) return;
    this.reportPending.set(true);
    this.reportError.set(null);
    try {
      const token = await this.requireToken();
      await this.messagingService.reportRequest(
        request.id,
        this.reportReason(),
        this.reportDetails.trim() || undefined,
        token,
      );
      this.incomingRequests.update((current) => current.filter((r) => r.id !== request.id));
      this.reportTarget.set(null);
    } catch (error) {
      this.reportError.set(this.errorMessage(error, 'Không thể gửi báo cáo.'));
    } finally {
      this.reportPending.set(false);
    }
  }

  isRequestPending(id: string): boolean {
    return this.pendingRequestIds().has(id);
  }

  requestStatusLabel(status: MessageRequestRecord['status']): string {
    switch (status) {
      case 'PENDING':
        return 'Đang chờ phản hồi';
      case 'ACCEPTED':
        return 'Đã chấp nhận';
      case 'REJECTED':
        return 'Đã từ chối';
      case 'REPORTED':
        return 'Đã báo cáo';
      default:
        return status;
    }
  }

  formatMessageTime(value: string): string {
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    );
  }

  formatConversationTime(value: string): string {
    const date = new Date(value);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date);
    }
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(date);
  }

  trackByConversationId(_index: number, item: ConversationSummary) {
    return item.id;
  }

  trackByRequestId(_index: number, item: MessageRequestRecord) {
    return item.id;
  }

  trackByMessageId(_index: number, item: ConversationMessage) {
    return item.id;
  }

  private async markConversationRead(conversationId: string) {
    try {
      const token = await this.requireToken();
      await this.messagingService.markRead(conversationId, token);
      await this.realtimeChannel?.send({ type: 'broadcast', event: 'read', payload: { readerId: this.currentUserId, readAt: new Date().toISOString() } });
      this.conversations.update((current) =>
        current.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
      );
    } catch {
      // Best-effort — an unread badge lingering a bit longer is not critical.
    }
  }

  private async connectRealtime(conversationId: string) {
    await this.disconnectRealtime();
    const userId = this.currentUserId;
    if (!userId || conversationId !== this.selectedConversationId()) return;
    const channel = this.supabaseService.getRealtimeClient().channel(`conversation:${conversationId}`, {
      config: { presence: { key: userId }, broadcast: { self: false, ack: true } },
    });
    this.realtimeChannel = channel;
    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const message = payload as ConversationMessage;
        if (message.conversationId !== this.selectedConversationId()) return;
        this.messages.update(current => current.some(item => item.id === message.id) ? current : [...current, message]);
        setTimeout(() => this.scrollToBottom());
        void this.markConversationRead(message.conversationId);
        void this.loadConversations(true);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload['userId'] !== this.currentUserId) this.otherUserTyping.set(payload['typing'] === true);
      })
      .on('broadcast', { event: 'read' }, ({ payload }) => {
        if (payload['readerId'] === this.currentUserId) return;
        const readAt = String(payload['readAt'] || new Date().toISOString());
        this.messages.update(current => current.map(message => message.senderId === this.currentUserId && !message.readAt ? { ...message, readAt } : message));
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        this.otherUserOnline.set(Object.keys(state).some(key => key !== userId));
      });
    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ userId, onlineAt: new Date().toISOString() });
        // Re-broadcast the read receipt after the realtime socket is ready;
        // the initial REST mark may finish before channel subscription.
        void this.markConversationRead(conversationId);
      }
    });
  }

  private async disconnectRealtime() {
    const channel = this.realtimeChannel;
    this.realtimeChannel = undefined;
    this.otherUserTyping.set(false); this.otherUserOnline.set(false);
    if (channel) await this.supabaseService.getRealtimeClient().removeChannel(channel);
  }

  private async broadcastTyping(typing: boolean) {
    await this.realtimeChannel?.send({ type: 'broadcast', event: 'typing', payload: { userId: this.currentUserId, typing } });
  }

  private setRequestPending(id: string, pending: boolean) {
    this.pendingRequestIds.update((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private scrollToBottom() {
    const container = this.messageListRef?.nativeElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  private async requireToken(): Promise<string> {
    const token = await this.supabaseService.getSessionToken();
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
    return token;
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
