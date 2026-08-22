import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

describe('ConversationsService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    follow: { findUnique: jest.fn() },
    messageRequest: { findFirst: jest.fn() },
    conversation: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    message: { findMany: jest.fn(), count: jest.fn(), create: jest.fn(), groupBy: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const blocksService = { isBlockedEitherWay: jest.fn() };

  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    blocksService.isBlockedEitherWay.mockResolvedValue(false);
    service = new ConversationsService(prisma as never, blocksService as never);
  });

  describe('listConversations', () => {
    it("selects and returns each conversation's otherUser membership plan", async () => {
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          userOneId: 'user-1',
          userTwoId: 'user-2',
          userOne: { id: 'user-1', username: 'me', avatarUrl: null, plan: 'FREE' },
          userTwo: { id: 'user-2', username: 'friend', avatarUrl: null, plan: 'PRO' },
          messages: [],
          lastMessageAt: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);
      prisma.message.groupBy.mockResolvedValue([]);

      const result = await service.listConversations('user-1');

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            userOne: { select: expect.objectContaining({ plan: true }) },
            userTwo: { select: expect.objectContaining({ plan: true }) },
          }),
        }),
      );
      expect(result[0].otherUser.plan).toBe('PRO');
      expect(result[0].otherUser).not.toHaveProperty('email');
    });
  });

  describe('openDirectConversation', () => {
    it('rejects opening a conversation with yourself', async () => {
      await expect(service.openDirectConversation('user-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when blocked', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      blocksService.isBlockedEitherWay.mockResolvedValue(true);
      await expect(service.openDirectConversation('user-1', 'user-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects when neither mutual-follow nor an accepted request exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue(null);
      await expect(service.openDirectConversation('user-1', 'user-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('opens the conversation for mutual followers', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue({ followerId: 'x' });
      prisma.conversation.findUnique.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'conv-1' });

      const result = await service.openDirectConversation('user-1', 'user-2');
      expect((result as { id: string }).id).toBe('conv-1');
    });

    it('opens the conversation when a request was accepted without mutual follow', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue({ id: 'req-1' });
      prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1' });

      const result = await service.openDirectConversation('user-1', 'user-2');
      expect((result as { id: string }).id).toBe('conv-1');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('rejects a non-participant from reading messages', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userOneId: 'user-1',
        userTwoId: 'user-2',
      });
      await expect(service.getMessages('conv-1', 'stranger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('404s for a conversation that does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      await expect(service.getMessages('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns messages in chronological order for a participant', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userOneId: 'user-1',
        userTwoId: 'user-2',
      });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm2', createdAt: new Date('2026-01-02') },
        { id: 'm1', createdAt: new Date('2026-01-01') },
      ]);
      prisma.message.count.mockResolvedValue(2);

      const result = await service.getMessages('conv-1', 'user-1');
      expect(result.items.map((m) => m.id)).toEqual(['m1', 'm2']);
    });
  });

  describe('sendMessage', () => {
    const conversation = { id: 'conv-1', userOneId: 'user-1', userTwoId: 'user-2' };

    it('rejects an empty message', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      await expect(service.sendMessage('conv-1', 'user-1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a message over the max length', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      await expect(
        service.sendMessage('conv-1', 'user-1', 'a'.repeat(4001)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-participant from sending', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      await expect(service.sendMessage('conv-1', 'stranger', 'hi')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects sending right after being blocked', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      blocksService.isBlockedEitherWay.mockResolvedValue(true);
      await expect(service.sendMessage('conv-1', 'user-1', 'hi')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects sending when permission has been revoked (unfollow + no accepted request)', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue(null);
      await expect(service.sendMessage('conv-1', 'user-1', 'hi')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sends the message and bumps lastMessageAt when permitted', async () => {
      prisma.conversation.findUnique.mockResolvedValue(conversation);
      prisma.follow.findUnique.mockResolvedValue({ followerId: 'x' });
      prisma.message.create.mockResolvedValue({
        id: 'm1',
        content: 'hi',
        createdAt: new Date('2026-01-01'),
      });

      const result = await service.sendMessage('conv-1', 'user-1', '  hi  ');

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: { conversationId: 'conv-1', senderId: 'user-1', content: 'hi' },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { lastMessageAt: (result as { createdAt: Date }).createdAt },
      });
    });
  });
});
