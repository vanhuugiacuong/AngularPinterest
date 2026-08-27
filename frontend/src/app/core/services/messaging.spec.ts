import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseService } from './supabase';
import { ToastService } from './toast';
import {
  ConversationMessage,
  MessageRequestRecord,
  MessagingService,
  PublicUserSummary,
} from './messaging';

interface MessagingServiceRealtimeHarness {
  handleRealtimeMessage(payload: {
    conversationId: string;
    message: ConversationMessage;
    sender: PublicUserSummary;
  }): void;
  handleRealtimeMessageRequest(payload: { request: MessageRequestRecord }): void;
}

describe('MessagingService unread badge', () => {
  let service: MessagingService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        MessagingService,
        {
          provide: SupabaseService,
          useValue: {
            user: signal<{ id: string } | null>(null),
            getSessionToken: vi.fn().mockResolvedValue(null),
          },
        },
        { provide: ToastService, useValue: { notify: vi.fn() } },
      ],
    });
    service = TestBed.inject(MessagingService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('counts realtime message requests together with unread messages without double-counting', () => {
    let unread = -1;
    const subscription = service.unreadCount$.subscribe((count) => (unread = count));
    const realtime = service as unknown as MessagingServiceRealtimeHarness;
    const sender: PublicUserSummary = {
      id: 'sender-1',
      username: 'minhchi',
      avatarUrl: null,
      plan: 'FREE',
    };
    const message: ConversationMessage = {
      id: 'message-1',
      conversationId: 'conversation-1',
      senderId: sender.id,
      content: 'Xin chào',
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const request: MessageRequestRecord = {
      id: 'request-1',
      senderId: sender.id,
      receiverId: 'viewer',
      status: 'PENDING',
      createdAt: '2026-08-27T00:01:00.000Z',
      sender,
    };

    realtime.handleRealtimeMessage({ conversationId: message.conversationId, message, sender });
    expect(unread).toBe(1);

    realtime.handleRealtimeMessageRequest({ request });
    expect(unread).toBe(2);

    realtime.handleRealtimeMessageRequest({ request });
    expect(unread).toBe(2);

    service.syncIncomingRequests([]);
    expect(unread).toBe(1);
    subscription.unsubscribe();
  });

  it('reconciles the badge with all pending incoming requests', () => {
    let unread = -1;
    const subscription = service.unreadCount$.subscribe((count) => (unread = count));
    const makeRequest = (id: string, status: MessageRequestRecord['status']): MessageRequestRecord => ({
      id,
      senderId: `sender-${id}`,
      receiverId: 'viewer',
      status,
      createdAt: '2026-08-27T00:00:00.000Z',
    });

    service.syncIncomingRequests([
      makeRequest('pending-1', 'PENDING'),
      makeRequest('pending-2', 'PENDING'),
      makeRequest('rejected', 'REJECTED'),
    ]);

    expect(unread).toBe(2);
    subscription.unsubscribe();
  });
});
