import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseService } from '../../core/services/supabase';
import { ConversationMessage, MessagingService, MessageRequestRecord } from '../../core/services/messaging';
import { Messages } from './messages';

function makeRequest(overrides: Partial<MessageRequestRecord> = {}): MessageRequestRecord {
  return {
    id: 'req-1',
    senderId: 'sender-1',
    receiverId: 'me',
    status: 'PENDING',
    createdAt: '2026-01-01T00:00:00.000Z',
    sender: { id: 'sender-1', username: 'artist', avatarUrl: null, plan: 'FREE' },
    ...overrides,
  };
}

describe('Messages', () => {
  function setup(
    overrides: {
      messagingService?: object;
      paramMap?: Record<string, string>;
      queryParams?: Record<string, string>;
    } = {},
  ) {
    const messagingService = {
      listConversations: vi.fn().mockResolvedValue([]),
      listIncomingRequests: vi.fn().mockResolvedValue([]),
      listOutgoingRequests: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 30, total: 0, hasMore: false }),
      acceptRequest: vi.fn(),
      rejectRequest: vi.fn(),
      reportRequest: vi.fn(),
      sendMessage: vi.fn(),
      markRead: vi.fn().mockResolvedValue({ success: true }),
      syncIncomingRequests: vi.fn(),
      incomingRequest$: of<MessageRequestRecord>(),
      ...overrides.messagingService,
    };
    const router = { navigate: vi.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [Messages],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap(overrides.paramMap || {})),
            snapshot: { queryParamMap: convertToParamMap(overrides.queryParams || {}) },
          },
        },
        { provide: Router, useValue: router },
        { provide: MessagingService, useValue: messagingService },
        {
          provide: SupabaseService,
          useValue: {
            getSessionToken: vi.fn().mockResolvedValue('token'),
            dbUser: () => ({ id: 'me' }),
            user: () => ({ id: 'me' }),
            getRealtimeClient: vi.fn().mockReturnValue({
              channel: vi.fn().mockReturnValue({
                on: vi.fn().mockReturnThis(),
                subscribe: vi.fn(),
                track: vi.fn(),
                send: vi.fn(),
              }),
              removeChannel: vi.fn(),
            }),
          },
        },
      ],
    }).overrideComponent(Messages, { set: { template: '' } });

    const fixture = TestBed.createComponent(Messages);
    return { fixture, messagingService, router };
  }

  it('loads conversations and requests, defaulting to the chats section', async () => {
    const { fixture, messagingService } = setup();
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    expect(messagingService.listConversations).toHaveBeenCalled();
    expect(messagingService.listIncomingRequests).toHaveBeenCalled();
    expect(messages.activeSection()).toBe('chats');
    messages.ngOnDestroy();
  });

  it('prefills the draft message from a ?prefill= query param (from "Trao đổi với chủ sở hữu") without sending it', async () => {
    const prefillText = 'Chào bạn, mình quan tâm đến tác phẩm "Tranh sơn dầu".';
    const { fixture, messagingService } = setup({ queryParams: { prefill: prefillText } });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    expect(messages.messageDraft).toBe(prefillText);
    expect(messagingService.sendMessage).not.toHaveBeenCalled();
    messages.ngOnDestroy();
  });

  it('shows an error state when conversations fail to load', async () => {
    const { fixture } = setup({
      messagingService: {
        listConversations: vi.fn().mockRejectedValue(new Error('offline')),
      },
    });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    expect(messages.conversationsError()).toBe('offline');
    expect(messages.conversationsLoading()).toBe(false);
    messages.ngOnDestroy();
  });

  it('offers exactly three actions on an incoming request: accept, reject, report', async () => {
    const request = makeRequest();
    const { fixture, messagingService } = setup({
      messagingService: { listIncomingRequests: vi.fn().mockResolvedValue([request]) },
    });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    expect(messages.incomingRequests()).toEqual([request]);
    expect(typeof messages.acceptRequest).toBe('function');
    expect(typeof messages.rejectRequest).toBe('function');
    expect(typeof messages.openReportDialog).toBe('function');
    messages.ngOnDestroy();
  });

  it('never shows requests that have already been handled', async () => {
    const pending = makeRequest({ id: 'pending' });
    const accepted = makeRequest({ id: 'accepted', status: 'ACCEPTED' });
    const rejected = makeRequest({ id: 'rejected', status: 'REJECTED' });
    const { fixture } = setup({
      messagingService: {
        listIncomingRequests: vi.fn().mockResolvedValue([pending, accepted]),
        listOutgoingRequests: vi.fn().mockResolvedValue([rejected]),
      },
    });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    expect(messages.incomingRequests()).toEqual([pending]);
    expect(messages.outgoingRequests()).toEqual([]);
    messages.ngOnDestroy();
  });

  it('accepting a request removes it from the incoming list and navigates to the new conversation', async () => {
    const request = makeRequest();
    const { fixture, messagingService, router } = setup({
      messagingService: {
        listIncomingRequests: vi.fn().mockResolvedValue([request]),
        acceptRequest: vi.fn().mockResolvedValue({ request: { ...request, status: 'ACCEPTED' }, conversationId: 'conv-1' }),
      },
    });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    await messages.acceptRequest(request);

    expect(messagingService.acceptRequest).toHaveBeenCalledWith('req-1', 'token');
    expect(messages.incomingRequests()).toEqual([]);
    expect(router.navigate).toHaveBeenCalledWith(['/messages', 'conv-1']);
    messages.ngOnDestroy();
  });

  it('restores the request to the list if rejecting fails', async () => {
    const request = makeRequest();
    const { fixture } = setup({
      messagingService: {
        listIncomingRequests: vi.fn().mockResolvedValue([request]),
        rejectRequest: vi.fn().mockRejectedValue(new Error('already handled')),
      },
    });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    await messages.rejectRequest(request);

    expect(messages.incomingRequests()).toEqual([request]);
    expect(messages.requestsError()).toBe('already handled');
    messages.ngOnDestroy();
  });

  it('navigates to a profile when an avatar/username is clicked', () => {
    const { fixture, router } = setup();
    fixture.componentInstance.navigateToProfile('artist');
    expect(router.navigate).toHaveBeenCalledWith(['/profile', 'artist']);
  });

  it('loads the thread and marks it read when a conversation id is in the route', async () => {
    const { fixture, messagingService } = setup({ paramMap: { conversationId: 'conv-1' } });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    expect(messagingService.getMessages).toHaveBeenCalledWith('conv-1', 1, 30, 'token');
    expect(messagingService.markRead).toHaveBeenCalledWith('conv-1', 'token');
    messages.ngOnDestroy();
  });

  it('does not send an empty or whitespace-only message', async () => {
    const { fixture, messagingService } = setup({ paramMap: { conversationId: 'conv-1' } });
    const messages = fixture.componentInstance;
    await messages.ngOnInit();

    messages.messageDraft = '   ';
    await messages.sendMessage();

    expect(messagingService.sendMessage).not.toHaveBeenCalled();
    messages.ngOnDestroy();
  });

  it('shows an optimistic message immediately and replaces it with the server message', async () => {
    let resolveSend!: (message: ConversationMessage) => void;
    const pendingSend = new Promise<ConversationMessage>((resolve) => {
      resolveSend = resolve;
    });
    const serverMessage: ConversationMessage = {
      id: 'message-server-1',
      conversationId: 'conv-1',
      senderId: 'me',
      content: 'Hiện ngay',
      createdAt: '2026-08-27T00:00:01.000Z',
    };
    const { fixture, messagingService } = setup({
      messagingService: { sendMessage: vi.fn().mockReturnValue(pendingSend) },
    });
    const messages = fixture.componentInstance;
    messages.selectedConversationId.set('conv-1');
    messages.messageDraft = 'Hiện ngay';

    const sendTask = messages.sendMessage();

    expect(messages.messageDraft).toBe('');
    expect(messages.messages()).toHaveLength(1);
    expect(messages.messages()[0].content).toBe('Hiện ngay');
    expect(messages.isOptimisticMessage(messages.messages()[0])).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    expect(messagingService.sendMessage).toHaveBeenCalled();
    resolveSend(serverMessage);
    await sendTask;

    expect(messages.sendError()).toBeNull();
    expect(messages.messages()).toEqual([serverMessage]);
    expect(messages.isOptimisticMessage(messages.messages()[0])).toBe(false);
  });

  it('allows another message to be sent while the previous request is still pending', async () => {
    let resolveFirst!: (message: ConversationMessage) => void;
    let resolveSecond!: (message: ConversationMessage) => void;
    const firstRequest = new Promise<ConversationMessage>((resolve) => (resolveFirst = resolve));
    const secondRequest = new Promise<ConversationMessage>((resolve) => (resolveSecond = resolve));
    const sendMessage = vi
      .fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    const { fixture } = setup({ messagingService: { sendMessage } });
    const messages = fixture.componentInstance;
    messages.selectedConversationId.set('conv-1');

    messages.messageDraft = 'Tin thứ nhất';
    const firstTask = messages.sendMessage();
    messages.messageDraft = 'Tin thứ hai';
    const secondTask = messages.sendMessage();

    expect(messages.messageDraft).toBe('');
    expect(messages.messages().map((message) => message.content)).toEqual(['Tin thứ nhất', 'Tin thứ hai']);

    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledTimes(2);

    resolveFirst({
      id: 'server-1',
      conversationId: 'conv-1',
      senderId: 'me',
      content: 'Tin thứ nhất',
      createdAt: '2026-08-27T00:00:01.000Z',
    });
    resolveSecond({
      id: 'server-2',
      conversationId: 'conv-1',
      senderId: 'me',
      content: 'Tin thứ hai',
      createdAt: '2026-08-27T00:00:02.000Z',
    });
    await Promise.all([firstTask, secondTask]);

    expect(messages.messages().map((message) => message.id)).toEqual(['server-1', 'server-2']);
  });

  it('removes the optimistic message and restores the draft when sending fails', async () => {
    const { fixture } = setup({
      messagingService: { sendMessage: vi.fn().mockRejectedValue(new Error('offline')) },
    });
    const messages = fixture.componentInstance;
    messages.selectedConversationId.set('conv-1');
    messages.messageDraft = 'Thử lại nội dung này';

    await messages.sendMessage();

    expect(messages.messages()).toEqual([]);
    expect(messages.messageDraft).toBe('Thử lại nội dung này');
    expect(messages.sendError()).toBe('offline');
  });

  it('returns focus to the chat composer after sending a message', async () => {
    const sentMessage = {
      id: 'message-1',
      conversationId: 'conv-1',
      senderId: 'me',
      content: 'Tin nhắn mới',
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const { fixture, messagingService } = setup({
      messagingService: { sendMessage: vi.fn().mockResolvedValue(sentMessage) },
    });
    const messages = fixture.componentInstance;
    const focus = vi.fn();
    messages.messageComposerRef = new ElementRef({ focus } as unknown as HTMLTextAreaElement);
    messages.selectedConversationId.set('conv-1');
    messages.messageDraft = 'Tin nhắn mới';

    await messages.sendMessage();

    expect(messagingService.sendMessage).toHaveBeenCalledWith('conv-1', 'Tin nhắn mới', 'token');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(messages.messageDraft).toBe('');
  });
});
