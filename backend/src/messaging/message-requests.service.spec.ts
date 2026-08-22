import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MessageRequestsService } from './message-requests.service';

describe('MessageRequestsService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    follow: { findUnique: jest.fn() },
    messageRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    conversation: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const blocksService = { isBlockedEitherWay: jest.fn() };
  const reportsService = { createMessageRequestReport: jest.fn() };

  let service: MessageRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    blocksService.isBlockedEitherWay.mockResolvedValue(false);
    service = new MessageRequestsService(prisma as never, blocksService as never, reportsService as never);
  });

  describe('sendRequest', () => {
    it('rejects a request to yourself', async () => {
      await expect(service.sendRequest('user-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when the receiver does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendRequest('user-1', 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects when either user has blocked the other', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      blocksService.isBlockedEitherWay.mockResolvedValue(true);
      await expect(service.sendRequest('user-1', 'user-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects when the two users already follow each other', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue({ followerId: 'x' });
      await expect(service.sendRequest('user-1', 'user-2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a duplicate request in the same direction', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue({
        senderId: 'user-1',
        status: 'PENDING',
      });
      await expect(service.sendRequest('user-1', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.messageRequest.create).not.toHaveBeenCalled();
    });

    it('rejects sending when the other user already has a pending request to you', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue({
        senderId: 'user-2',
        status: 'PENDING',
      });
      await expect(service.sendRequest('user-1', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('creates the request once all checks pass', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue(null);
      prisma.messageRequest.create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

      const result = await service.sendRequest('user-1', 'user-2');

      expect(result).toEqual({ id: 'req-1', status: 'PENDING' });
      expect(prisma.messageRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { senderId: 'user-1', receiverId: 'user-2' } }),
      );
    });

    it("selects and returns the receiver's membership plan", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue(null);
      prisma.messageRequest.create.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        receiver: { id: 'user-2', username: 'friend', avatarUrl: null, plan: 'PLUS' },
      });

      const result = await service.sendRequest('user-1', 'user-2');

      expect(prisma.messageRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { receiver: { select: expect.objectContaining({ plan: true }) } },
        }),
      );
      expect((result as { receiver: { plan: string } }).receiver.plan).toBe('PLUS');
    });

    it('turns a unique-constraint race into a friendly conflict error', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue(null);
      prisma.messageRequest.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.9.1',
        }),
      );

      await expect(service.sendRequest('user-1', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('listIncoming / listOutgoing', () => {
    it("selects and returns the sender's membership plan for incoming requests", async () => {
      prisma.messageRequest.findMany.mockResolvedValue([
        { id: 'req-1', sender: { id: 'user-2', username: 'friend', avatarUrl: null, plan: 'PRO' } },
      ]);

      const result = await service.listIncoming('user-1');

      expect(prisma.messageRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { receiverId: 'user-1', status: 'PENDING' },
          include: { sender: { select: expect.objectContaining({ plan: true }) } },
        }),
      );
      expect(result[0].sender.plan).toBe('PRO');
    });

    it("selects and returns the receiver's membership plan for outgoing requests", async () => {
      prisma.messageRequest.findMany.mockResolvedValue([
        { id: 'req-1', receiver: { id: 'user-2', username: 'friend', avatarUrl: null, plan: 'FREE' } },
      ]);

      const result = await service.listOutgoing('user-1');

      expect(prisma.messageRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { senderId: 'user-1', status: 'PENDING' },
          include: { receiver: { select: expect.objectContaining({ plan: true }) } },
        }),
      );
      expect(result[0].receiver.plan).toBe('FREE');
    });
  });

  describe('accept', () => {
    it('rejects when the caller is not the receiver', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'someone-else',
        senderId: 'user-1',
        status: 'PENDING',
      });
      await expect(service.accept('req-1', 'user-2')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the request no longer exists', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue(null);
      await expect(service.accept('req-1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects accepting an already-resolved request (double accept / accept-after-reject race)', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'user-2',
        senderId: 'user-1',
        status: 'PENDING',
      });
      prisma.messageRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.accept('req-1', 'user-2')).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a pending request and creates the conversation', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'user-2',
        senderId: 'user-1',
        status: 'PENDING',
      });
      prisma.messageRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.conversation.findUnique.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
      prisma.messageRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-1',
        status: 'ACCEPTED',
      });

      const result = await service.accept('req-1', 'user-2');

      expect(result.conversationId).toBe('conv-1');
      expect(result.request.status).toBe('ACCEPTED');
    });

    it('reuses an existing conversation instead of creating a duplicate', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'user-2',
        senderId: 'user-1',
        status: 'PENDING',
      });
      prisma.messageRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.conversation.findUnique.mockResolvedValue({ id: 'existing-conv' });
      prisma.messageRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-1',
        status: 'ACCEPTED',
      });

      const result = await service.accept('req-1', 'user-2');

      expect(result.conversationId).toBe('existing-conv');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects when the caller is not the receiver', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'someone-else',
      });
      await expect(service.reject('req-1', 'user-2')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a request that was already handled', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({ id: 'req-1', receiverId: 'user-2' });
      prisma.messageRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject('req-1', 'user-2')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('report', () => {
    it('creates a report and marks the request REPORTED', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'user-2',
        senderId: 'user-1',
        status: 'PENDING',
      });
      prisma.messageRequest.updateMany.mockResolvedValue({ count: 1 });
      reportsService.createMessageRequestReport.mockResolvedValue({ id: 'report-1' });
      prisma.messageRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-1',
        status: 'REPORTED',
      });

      const result = await service.report('req-1', 'user-2', 'SPAM', 'unwanted messages');

      expect(reportsService.createMessageRequestReport).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          reporterId: 'user-2',
          reportedId: 'user-1',
          messageRequestId: 'req-1',
        }),
      );
      expect(result.request.status).toBe('REPORTED');
    });

    it('cannot report a request that is no longer pending', async () => {
      prisma.messageRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        receiverId: 'user-2',
        senderId: 'user-1',
        status: 'ACCEPTED',
      });
      prisma.messageRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.report('req-1', 'user-2', 'SPAM')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
