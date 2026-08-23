import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Navbar } from '../../components/navbar/navbar';
import { EmojiPicker } from './emoji-picker/emoji-picker';
import { SupabaseService } from '../../core/services/supabase';
import { PresenceService } from '../../core/services/presence';
import {
  ChatMessage,
  ChatService,
  ConversationSummary,
  GifResult,
  MessageReaction,
  PublicUserSummary,
} from '../../core/services/chat';

const MAX_MESSAGE_LENGTH = 4000;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, EmojiPicker],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly chatService = inject(ChatService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly presenceService = inject(PresenceService);

  @ViewChild('messageList') messageListRef?: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput') messageInputRef?: ElementRef<HTMLTextAreaElement>;

  readonly maxMessageLength = MAX_MESSAGE_LENGTH;

  readonly conversations = signal<ConversationSummary[]>([]);
  readonly conversationsLoading = signal(true);
  readonly conversationsError = signal<string | null>(null);
  readonly conversationSearch = signal('');

  readonly selectedConversationId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly messagesLoading = signal(true);
  readonly messagesError = signal<string | null>(null);
  readonly messagesHasMore = signal(false);
  readonly messagesLoadingMore = signal(false);

  readonly sendPending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly otherUserTyping = signal(false);
  /** App-wide presence (see PresenceService) — not tied to this page being open. */
  otherUserOnline(): boolean {
    const conversationId = this.selectedConversationId();
    if (!conversationId) return false;
    const otherUser = this.otherUserFor(conversationId);
    return this.presenceService.isOnline(otherUser?.id);
  }
  messageDraft = '';

  readonly isComposeOpen = signal(false);
  readonly composeQuery = signal('');
  readonly composeResults = signal<PublicUserSummary[]>([]);
  readonly composeLoading = signal(false);
  private composeSearchTimer?: ReturnType<typeof setTimeout>;

  readonly imagePreviewUrl = signal<string | null>(null);
  readonly imageSending = signal(false);
  readonly imageError = signal<string | null>(null);

  readonly isEmojiPickerOpen = signal(false);

  readonly replyingTo = signal<ChatMessage | null>(null);
  readonly openReactionPickerFor = signal<string | null>(null);
  readonly quickReactions = QUICK_REACTIONS;

  readonly openMessageMenuFor = signal<string | null>(null);
  readonly pinnedMessage = signal<ChatMessage | null>(null);

  readonly isGifPickerOpen = signal(false);
  readonly gifQuery = signal('');
  readonly gifResults = signal<GifResult[]>([]);
  readonly gifLoading = signal(false);
  readonly gifError = signal<string | null>(null);
  private gifSearchTimer?: ReturnType<typeof setTimeout>;

  private routeSubscription?: Subscription;
  /** One persistent channel per user, joined for as long as the Chat page is
   * open — not per conversation. A per-conversation channel only reaches
   * someone actively viewing that thread, so anyone with a different (or no)
   * conversation open never gets notified and the list looks stale until a
   * manual refresh. Broadcasting to the other participant's own inbox
   * channel instead means the list updates live regardless of what they're
   * looking at. */
  private myInboxChannel?: RealtimeChannel;
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
        this.otherUserTyping.set(false);
        if (conversationId) {
          this.messagesPage = 1;
          void this.loadMessages(conversationId);
          void this.markConversationRead(conversationId);
          void this.loadPinnedMessage(conversationId);
        } else {
          this.messages.set([]);
          this.pinnedMessage.set(null);
        }
      }
    });
    await this.loadConversations();
    void this.connectInbox();
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    void this.disconnectInbox();
    if (this.typingTimer) clearTimeout(this.typingTimer);
    if (this.gifSearchTimer) clearTimeout(this.gifSearchTimer);
    if (this.composeSearchTimer) clearTimeout(this.composeSearchTimer);
    this.messagesRequestVersion += 1;
  }

  filteredConversations(): ConversationSummary[] {
    const q = this.conversationSearch().trim().toLowerCase();
    if (!q) return this.conversations();
    return this.conversations().filter((c) => c.otherUser.username.toLowerCase().includes(q));
  }

  selectConversation(id: string) {
    if (id === this.selectedConversationId()) return;
    void this.router.navigate(['/chat', id]);
  }

  backToList() {
    void this.router.navigate(['/chat']);
  }

  navigateToProfile(username: string | undefined | null) {
    if (!username) return;
    void this.router.navigate(['/profile', username]);
  }

  navigateToPin(pinId: string | undefined | null) {
    if (!pinId) return;
    void this.router.navigate(['/pin', pinId]);
  }

  openImageInNewTab(url: string | undefined | null) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
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
      this.conversations.set(await this.chatService.listConversations(token));
    } catch (error) {
      if (!silent) this.conversationsError.set(this.errorMessage(error, 'Không thể tải danh sách trò chuyện.'));
    } finally {
      if (!silent) this.conversationsLoading.set(false);
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
      const page = await this.chatService.getMessages(conversationId, 1, 30, token);
      if (version !== this.messagesRequestVersion) return;
      this.messages.set(page.items);
      this.messagesHasMore.set(page.hasMore);
      this.messagesPage = 1;
      if (!silent) this.scheduleScrollToBottom();
    } catch (error) {
      if (version !== this.messagesRequestVersion) return;
      if (!silent) this.messagesError.set(this.errorMessage(error, 'Không thể tải tin nhắn.'));
    } finally {
      if (version === this.messagesRequestVersion && !silent) this.messagesLoading.set(false);
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
      const page = await this.chatService.getMessages(conversationId, nextPage, 30, token);
      this.messages.update((current) => [...page.items, ...current]);
      this.messagesHasMore.set(page.hasMore);
      this.messagesPage = nextPage;
      setTimeout(() => {
        if (container) container.scrollTop = container.scrollHeight - previousHeight;
      });
    } catch {
      // Best-effort: leave hasMore as-is so the user can retry the click.
    } finally {
      this.messagesLoadingMore.set(false);
    }
  }

  async sendMessage() {
    const content = this.messageDraft.trim();
    if (!content) return;
    await this.sendMessagePayload({ type: 'TEXT', content }, () => {
      this.messageDraft = '';
    });
  }

  onDraftInput() {
    void this.broadcastTyping(this.messageDraft.trim().length > 0);
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => void this.broadcastTyping(false), 1400);
  }

  triggerImagePicker(input: HTMLInputElement) {
    input.click();
  }

  async onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.imageError.set('Định dạng ảnh không được hỗ trợ. Vui lòng chọn JPEG, PNG, WEBP hoặc GIF.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      this.imageError.set('Ảnh không được vượt quá 8MB.');
      return;
    }

    this.imageError.set(null);
    const previewUrl = URL.createObjectURL(file);
    this.imagePreviewUrl.set(previewUrl);
    this.imageSending.set(true);
    try {
      const token = await this.requireToken();
      const { imageUrl } = await this.chatService.uploadChatImage(file, token);
      await this.sendMessagePayload({ type: 'IMAGE', imageUrl });
    } catch (error) {
      this.imageError.set(this.errorMessage(error, 'Không thể gửi ảnh.'));
    } finally {
      this.imageSending.set(false);
      URL.revokeObjectURL(previewUrl);
      this.imagePreviewUrl.set(null);
    }
  }

  toggleEmojiPicker() {
    this.isEmojiPickerOpen.update((v) => !v);
    if (this.isEmojiPickerOpen()) this.isGifPickerOpen.set(false);
  }

  closeEmojiPicker() {
    this.isEmojiPickerOpen.set(false);
  }

  /** Inserts at the current cursor position (not always the end) so a user
   * can keep typing around an emoji they picked mid-sentence. */
  insertEmoji(emoji: string) {
    const textarea = this.messageInputRef?.nativeElement;
    if (!textarea) {
      this.messageDraft += emoji;
      return;
    }
    const start = textarea.selectionStart ?? this.messageDraft.length;
    const end = textarea.selectionEnd ?? this.messageDraft.length;
    this.messageDraft = this.messageDraft.slice(0, start) + emoji + this.messageDraft.slice(end);
    const newCursor = start + emoji.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }

  toggleGifPicker() {
    const next = !this.isGifPickerOpen();
    this.isGifPickerOpen.set(next);
    if (next) this.isEmojiPickerOpen.set(false);
    if (next && this.gifResults().length === 0) void this.loadTrendingGifs();
  }

  closeGifPicker() {
    this.isGifPickerOpen.set(false);
  }

  onGifQueryInput(value: string) {
    this.gifQuery.set(value);
    if (this.gifSearchTimer) clearTimeout(this.gifSearchTimer);
    this.gifSearchTimer = setTimeout(() => void this.runGifSearch(value), 350);
  }

  private async loadTrendingGifs() {
    this.gifLoading.set(true);
    this.gifError.set(null);
    try {
      const token = await this.requireToken();
      this.gifResults.set(await this.chatService.trendingGifs(token));
    } catch (error) {
      this.gifError.set(this.errorMessage(error, 'Không thể tải GIF thịnh hành.'));
    } finally {
      this.gifLoading.set(false);
    }
  }

  private async runGifSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      void this.loadTrendingGifs();
      return;
    }
    this.gifLoading.set(true);
    this.gifError.set(null);
    try {
      const token = await this.requireToken();
      this.gifResults.set(await this.chatService.searchGifs(trimmed, token));
    } catch (error) {
      this.gifError.set(this.errorMessage(error, 'Không thể tìm GIF.'));
    } finally {
      this.gifLoading.set(false);
    }
  }

  async selectGif(gif: GifResult) {
    this.closeGifPicker();
    await this.sendMessagePayload({ type: 'GIF', gifUrl: gif.url });
  }

  toggleCompose() {
    const next = !this.isComposeOpen();
    this.isComposeOpen.set(next);
    if (!next) {
      this.composeQuery.set('');
      this.composeResults.set([]);
    }
  }

  onComposeQueryInput(value: string) {
    this.composeQuery.set(value);
    if (this.composeSearchTimer) clearTimeout(this.composeSearchTimer);
    this.composeSearchTimer = setTimeout(() => void this.runComposeSearch(value), 300);
  }

  private async runComposeSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      this.composeResults.set([]);
      return;
    }
    this.composeLoading.set(true);
    try {
      const token = await this.requireToken();
      this.composeResults.set(await this.chatService.searchUsers(trimmed, token));
    } catch {
      this.composeResults.set([]);
    } finally {
      this.composeLoading.set(false);
    }
  }

  async startConversationWith(user: PublicUserSummary) {
    this.isComposeOpen.set(false);
    this.composeQuery.set('');
    this.composeResults.set([]);
    try {
      const token = await this.requireToken();
      const conversation = await this.chatService.openDirectConversation(user.id, token);
      await this.loadConversations(true);
      void this.router.navigate(['/chat', conversation.id]);
    } catch (error) {
      this.conversationsError.set(this.errorMessage(error, 'Không thể bắt đầu cuộc trò chuyện.'));
    }
  }

  /** Short preview line for the conversation list — non-text messages don't
   * have `content`, so render a type-appropriate label instead. */
  lastMessagePreview(conversation: ConversationSummary): string {
    const last = conversation.lastMessage;
    if (!last) return 'Bắt đầu cuộc trò chuyện';
    switch (last.type) {
      case 'IMAGE':
        return '🖼️ Đã gửi một ảnh';
      case 'GIF':
        return 'Đã gửi một GIF';
      case 'PIN':
        return '📌 Đã chia sẻ một Pin';
      default:
        return last.content || '';
    }
  }

  /** True when the message is 1-3 emoji and nothing else — those render
   * larger without a heavy bubble, matching a normal chat app's convention. */
  isEmojiOnly(content: string | null | undefined): boolean {
    if (!content) return false;
    const trimmed = content.trim();
    if (!trimmed) return false;
    const emojiPattern = /^(\p{Extended_Pictographic}️?‍?){1,3}$/u;
    return emojiPattern.test(trimmed);
  }

  formatMessageTime(value: string): string {
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  formatConversationTime(value: string): string {
    const date = new Date(value);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date);
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(date);
  }

  trackByConversationId(_index: number, item: ConversationSummary) {
    return item.id;
  }

  trackByMessageId(_index: number, item: ChatMessage) {
    return item.id;
  }

  private async sendMessagePayload(
    input: { type: 'TEXT' | 'IMAGE' | 'GIF'; content?: string; imageUrl?: string; gifUrl?: string },
    onSuccess?: () => void,
  ) {
    const conversationId = this.selectedConversationId();
    if (!conversationId || this.sendPending()) return;

    const replyToId = this.replyingTo()?.id;
    this.sendPending.set(true);
    this.sendError.set(null);
    try {
      const token = await this.requireToken();
      const message = await this.chatService.sendMessage(conversationId, { ...input, replyToId }, token);
      this.messages.update((current) => [...current, message]);
      this.replyingTo.set(null);
      onSuccess?.();
      const otherUserId = this.otherUserFor(conversationId)?.id;
      if (otherUserId) await this.sendToUser(otherUserId, 'message', message);
      await this.broadcastTyping(false);
      this.scheduleScrollToBottom();
      this.conversations.update((current) =>
        current.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: { type: message.type, content: message.content, createdAt: message.createdAt, senderId: message.senderId },
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

  startReply(message: ChatMessage, event?: MouseEvent) {
    event?.stopPropagation();
    this.replyingTo.set(message);
    setTimeout(() => this.messageInputRef?.nativeElement.focus());
  }

  cancelReply() {
    this.replyingTo.set(null);
  }

  replyPreviewLabel(reply: { type: string; content?: string | null } | null | undefined): string {
    if (!reply) return '';
    switch (reply.type) {
      case 'IMAGE':
        return '🖼️ Ảnh';
      case 'GIF':
        return 'GIF';
      case 'PIN':
        return '📌 Pin';
      default:
        return reply.content || '';
    }
  }

  scrollToMessage(messageId: string | undefined | null) {
    if (!messageId) return;
    const el = this.messageListRef?.nativeElement.querySelector(`[data-message-id="${messageId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('message-highlight');
    setTimeout(() => el?.classList.remove('message-highlight'), 1200);
  }

  toggleReactionPicker(messageId: string, event: MouseEvent) {
    event.stopPropagation();
    this.openMessageMenuFor.set(null);
    this.openReactionPickerFor.update((current) => (current === messageId ? null : messageId));
  }

  closeReactionPicker() {
    this.openReactionPickerFor.set(null);
  }

  /** Grouped {emoji, count, reactedByMe} for rendering pills under a bubble. */
  reactionGroups(message: ChatMessage): { emoji: string; count: number; reactedByMe: boolean }[] {
    const reactions = message.reactions ?? [];
    const groups = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
    for (const r of reactions) {
      const existing = groups.get(r.emoji);
      const reactedByMe = r.userId === this.currentUserId;
      if (existing) {
        existing.count++;
        existing.reactedByMe = existing.reactedByMe || reactedByMe;
      } else {
        groups.set(r.emoji, { emoji: r.emoji, count: 1, reactedByMe });
      }
    }
    return Array.from(groups.values());
  }

  async reactToMessage(message: ChatMessage, emoji: string, event?: MouseEvent) {
    event?.stopPropagation();
    this.closeReactionPicker();
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;
    try {
      const token = await this.requireToken();
      const result = await this.chatService.toggleReaction(conversationId, message.id, emoji, token);
      this.applyReactions(message.id, result.reactions);
      const otherUserId = this.otherUserFor(conversationId)?.id;
      if (otherUserId) {
        await this.sendToUser(otherUserId, 'reaction', {
          conversationId,
          messageId: message.id,
          reactions: result.reactions,
        });
      }
    } catch {
      // Best-effort — a reaction that doesn't land is not critical enough to surface an error banner.
    }
  }

  private applyReactions(messageId: string, reactions: MessageReaction[]) {
    this.messages.update((current) => current.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
  }

  toggleMessageMenu(messageId: string, event: MouseEvent) {
    event.stopPropagation();
    this.openReactionPickerFor.set(null);
    this.openMessageMenuFor.update((current) => (current === messageId ? null : messageId));
  }

  closeMessageMenu() {
    this.openMessageMenuFor.set(null);
  }

  async unsendMessage(message: ChatMessage, event?: MouseEvent) {
    event?.stopPropagation();
    this.closeMessageMenu();
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;
    try {
      const token = await this.requireToken();
      const updated = await this.chatService.unsendMessage(conversationId, message.id, token);
      this.applyMessageUpdate(updated);
      if (this.pinnedMessage()?.id === message.id) this.pinnedMessage.set(null);
      const otherUserId = this.otherUserFor(conversationId)?.id;
      if (otherUserId) await this.sendToUser(otherUserId, 'unsend', updated);
    } catch (error) {
      this.sendError.set(this.errorMessage(error, 'Không thể thu hồi tin nhắn.'));
    }
  }

  async togglePinMessage(message: ChatMessage, event?: MouseEvent) {
    event?.stopPropagation();
    this.closeMessageMenu();
    const conversationId = this.selectedConversationId();
    if (!conversationId) return;
    try {
      const token = await this.requireToken();
      const updated = await this.chatService.togglePin(conversationId, message.id, token);
      this.applyMessageUpdate(updated);
      this.pinnedMessage.set(updated.pinnedAt ? updated : null);
      if (!updated.pinnedAt) {
        // Pinning a new message server-side unpins the previous one — reflect that locally too.
      } else {
        this.messages.update((current) => current.map((m) => (m.id !== updated.id ? { ...m, pinnedAt: null } : m)));
      }
      const otherUserId = this.otherUserFor(conversationId)?.id;
      if (otherUserId) await this.sendToUser(otherUserId, 'pin', updated);
    } catch (error) {
      this.sendError.set(this.errorMessage(error, 'Không thể ghim tin nhắn.'));
    }
  }

  unpinBanner(event?: MouseEvent) {
    const pinned = this.pinnedMessage();
    if (pinned) void this.togglePinMessage(pinned, event);
  }

  private async loadPinnedMessage(conversationId: string) {
    try {
      const token = await this.requireToken();
      this.pinnedMessage.set(await this.chatService.getPinnedMessage(conversationId, token));
    } catch {
      this.pinnedMessage.set(null);
    }
  }

  private applyMessageUpdate(updated: ChatMessage) {
    this.messages.update((current) => current.map((m) => (m.id === updated.id ? updated : m)));
  }

  private async markConversationRead(conversationId: string) {
    try {
      const token = await this.requireToken();
      await this.chatService.markRead(conversationId, token);
      const otherUserId = this.otherUserFor(conversationId)?.id;
      if (otherUserId) {
        await this.sendToUser(otherUserId, 'read', {
          conversationId,
          readerId: this.currentUserId,
          readAt: new Date().toISOString(),
        });
      }
      this.conversations.update((current) =>
        current.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
      );
    } catch {
      // Best-effort — an unread badge lingering a bit longer is not critical.
    }
  }

  /** One channel, named after this user's own id, joined for the whole time
   * the Chat page is open — receives events for every conversation they're
   * in, regardless of which one (if any) is currently selected. */
  private async connectInbox() {
    await this.disconnectInbox();
    const userId = this.currentUserId;
    if (!userId) return;

    const channel = this.supabaseService.getRealtimeClient().channel(`chat-user:${userId}`, {
      config: { broadcast: { self: false, ack: true } },
    });
    this.myInboxChannel = channel;
    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const message = payload as ChatMessage;
        void this.loadConversations(true);
        if (message.conversationId !== this.selectedConversationId()) return;
        this.messages.update((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
        this.scheduleScrollToBottom();
        void this.markConversationRead(message.conversationId);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload['conversationId'] !== this.selectedConversationId()) return;
        this.otherUserTyping.set(payload['typing'] === true);
      })
      .on('broadcast', { event: 'read' }, ({ payload }) => {
        if (payload['conversationId'] !== this.selectedConversationId()) return;
        const readAt = String(payload['readAt'] || new Date().toISOString());
        this.messages.update((current) =>
          current.map((m) => (m.senderId === this.currentUserId && !m.readAt ? { ...m, readAt } : m)),
        );
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        if (payload['conversationId'] !== this.selectedConversationId()) return;
        this.applyReactions(payload['messageId'], payload['reactions'] ?? []);
      })
      .on('broadcast', { event: 'unsend' }, ({ payload }) => {
        const updated = payload as ChatMessage;
        void this.loadConversations(true);
        if (updated.conversationId !== this.selectedConversationId()) return;
        this.applyMessageUpdate(updated);
        if (this.pinnedMessage()?.id === updated.id) this.pinnedMessage.set(null);
      })
      .on('broadcast', { event: 'pin' }, ({ payload }) => {
        const updated = payload as ChatMessage;
        if (updated.conversationId !== this.selectedConversationId()) return;
        this.applyMessageUpdate(updated);
        if (updated.pinnedAt) {
          this.pinnedMessage.set(updated);
          this.messages.update((current) => current.map((m) => (m.id !== updated.id ? { ...m, pinnedAt: null } : m)));
        } else if (this.pinnedMessage()?.id === updated.id) {
          this.pinnedMessage.set(null);
        }
      });

    channel.subscribe();
  }

  private async disconnectInbox() {
    const channel = this.myInboxChannel;
    this.myInboxChannel = undefined;
    if (channel) await this.supabaseService.getRealtimeClient().removeChannel(channel);
  }

  /** Fire-and-forget broadcast to another user's own inbox channel — joins
   * just long enough to send, since we're not the owner of that channel. */
  private async sendToUser(userId: string, event: string, payload: unknown) {
    const client = this.supabaseService.getRealtimeClient();
    const channel = client.channel(`chat-user:${userId}`, { config: { broadcast: { self: false } } });
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
      });
    });
    await channel.send({ type: 'broadcast', event, payload });
    await client.removeChannel(channel);
  }

  private async broadcastTyping(typing: boolean) {
    const conversationId = this.selectedConversationId();
    const otherUserId = conversationId ? this.otherUserFor(conversationId)?.id : undefined;
    if (conversationId && otherUserId) {
      await this.sendToUser(otherUserId, 'typing', { conversationId, typing });
    }
  }

  private scrollToBottom() {
    const container = this.messageListRef?.nativeElement;
    if (container) container.scrollTop = container.scrollHeight;
  }

  /** setTimeout(fn, 0) only guarantees "next macrotask" — not that Angular
   * has actually laid out the newly-rendered messages yet, so scrollHeight
   * could still read the pre-update value (this is what left the thread
   * looking like it opened at the top instead of the latest message). Two
   * animation frames reliably lands after layout has settled. */
  private scheduleScrollToBottom() {
    requestAnimationFrame(() => requestAnimationFrame(() => this.scrollToBottom()));
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
