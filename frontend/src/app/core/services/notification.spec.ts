import { describe, expect, it } from 'vitest';
import { formatRealtimeNotificationMessage } from './notification';

describe('formatRealtimeNotificationMessage', () => {
  it('does not repeat the sender name for a follow request', () => {
    const message = formatRealtimeNotificationMessage({
      content: 'Minh Chí Phạm Nguyễn muốn theo dõi bạn.',
      sender: {
        id: 'sender-1',
        username: 'Minh Chí Phạm Nguyễn',
        plan: 'FREE',
      },
    });

    expect(message).toBe('Minh Chí Phạm Nguyễn muốn theo dõi bạn.');
  });

  it('does not repeat the sender name when a follow request is accepted', () => {
    const message = formatRealtimeNotificationMessage({
      content: 'chiphamnguyenminh đã chấp nhận yêu cầu theo dõi của bạn.',
      sender: {
        id: 'sender-2',
        username: 'chiphamnguyenminh',
        plan: 'FREE',
      },
    });

    expect(message).toBe('chiphamnguyenminh đã chấp nhận yêu cầu theo dõi của bạn.');
  });

  it('still adds one sender name when the message does not contain it', () => {
    const message = formatRealtimeNotificationMessage({
      content: 'đã gửi cho bạn một tin nhắn.',
      sender: {
        id: 'sender-3',
        username: 'chiphamnguyenminh',
        plan: 'FREE',
      },
    });

    expect(message).toBe('chiphamnguyenminh đã gửi cho bạn một tin nhắn.');
  });

  it('does not mistake a longer first word for the sender name', () => {
    const message = formatRealtimeNotificationMessage({
      content: 'Anna đã gửi cho bạn một tin nhắn.',
      sender: {
        id: 'sender-4',
        username: 'Ann',
        plan: 'FREE',
      },
    });

    expect(message).toBe('Ann Anna đã gửi cho bạn một tin nhắn.');
  });
});
