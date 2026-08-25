import { PinsService } from './pins.service';

describe('PinsService privacy', () => {
  const prisma = {
    pin: { findUnique: jest.fn() },
    auction: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const membershipsService = { status: jest.fn().mockResolvedValue({ plan: 'FREE' }) };
  const service = new PinsService(prisma as never, {} as never, {} as never, membershipsService as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns like count and viewer state without exposing raw Like rows', async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1',
      title: 'Frame',
      likes: [{ userId: 'viewer-id' }],
      _count: { likes: 12, comments: 2 },
      comments: [],
      user: { id: 'author-id', username: 'artist' },
    });

    const result = await service.getPinById('pin-1', 'viewer-id');

    expect(result).not.toHaveProperty('likes');
    expect(result).toEqual(
      expect.objectContaining({ likeCount: 12, isLiked: true }),
    );
    expect(prisma.pin.findUnique).toHaveBeenCalledTimes(1);
  });

  it("selects and returns the pin author's and each comment author's membership plan", async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1',
      title: 'Frame',
      likes: [],
      _count: { likes: 0, comments: 1 },
      comments: [
        { id: 'c1', content: 'nice', user: { id: 'commenter-id', username: 'fan', plan: 'PLUS' } },
      ],
      user: { id: 'author-id', username: 'artist', plan: 'PRO' },
    });

    const result = await service.getPinById('pin-1');

    expect(prisma.pin.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          user: { select: expect.objectContaining({ plan: true }) },
          comments: expect.objectContaining({
            include: { user: { select: expect.objectContaining({ plan: true }) } },
          }),
        }),
      }),
    );
    expect(result.user.plan).toBe('PRO');
    expect(result.comments[0].user.plan).toBe('PLUS');
    expect(result.user).not.toHaveProperty('email');
  });
});

describe('PinsService notifications', () => {
  const prisma = {
    pin: { findUnique: jest.fn() },
    like: { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn(), count: jest.fn() },
    comment: { create: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const notificationsService = { createNotification: jest.fn() };
  const service = new PinsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    notificationsService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('notifies the pin owner on a fresh like, never on unlike', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'owner-1' });
    prisma.like.findUnique.mockResolvedValue(null);
    prisma.like.count.mockResolvedValue(3);
    prisma.user.findUnique.mockResolvedValue({ username: 'fan' });

    await service.toggleLike('pin-1', 'liker-1');

    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'owner-1',
      'LIKE',
      expect.any(String),
      'liker-1',
      'pin-1',
    );

    jest.clearAllMocks();
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'owner-1' });
    prisma.like.findUnique.mockResolvedValue({ userId: 'liker-1', pinId: 'pin-1' });
    prisma.like.count.mockResolvedValue(2);

    await service.toggleLike('pin-1', 'liker-1');

    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('never notifies when liking your own pin', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'owner-1' });
    prisma.like.findUnique.mockResolvedValue(null);
    prisma.like.count.mockResolvedValue(1);

    await service.toggleLike('pin-1', 'owner-1');

    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('notifies the pin owner on a new comment, never for their own comment', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'owner-1' });
    prisma.comment.create.mockResolvedValue({
      id: 'c1',
      content: 'nice!',
      user: { id: 'commenter-1', username: 'fan', avatarUrl: null, plan: 'FREE' },
    });

    await service.addComment('pin-1', 'commenter-1', 'nice!');

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'owner-1',
      'COMMENT',
      expect.any(String),
      'commenter-1',
      'pin-1',
    );

    jest.clearAllMocks();
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'owner-1' });
    prisma.comment.create.mockResolvedValue({
      id: 'c2',
      content: 'self note',
      user: { id: 'owner-1', username: 'owner', avatarUrl: null, plan: 'FREE' },
    });

    await service.addComment('pin-1', 'owner-1', 'self note');

    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });
});
