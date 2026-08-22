import { UsersService } from './users.service';

describe('UsersService profile data', () => {
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    pin: { count: jest.fn(), findMany: jest.fn() },
    board: { count: jest.fn(), findMany: jest.fn() },
    follow: { count: jest.fn(), findUnique: jest.fn() },
    like: { count: jest.fn(), findMany: jest.fn() },
    messageRequest: { findFirst: jest.fn() },
    conversation: { findUnique: jest.fn() },
  };
  const blocksService = { isBlocked: jest.fn(), isBlockedEitherWay: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    blocksService.isBlocked.mockResolvedValue(false);
    blocksService.isBlockedEitherWay.mockResolvedValue(false);
    service = new UsersService(prisma as never, blocksService as never, notificationsService as never);
  });

  it('returns a safe summary and hides private favorite metadata from other users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'profile-user',
      username: 'artist',
      avatarUrl: null,
      bio: 'Creates frames',
      createdAt: new Date('2026-01-01'),
    });
    prisma.pin.count.mockResolvedValue(3);
    prisma.board.count.mockResolvedValue(2);
    prisma.follow.count.mockResolvedValueOnce(8).mockResolvedValueOnce(4);
    // First call checks viewer -> target (isFollowing), second checks target -> viewer (isFollowedBy).
    prisma.follow.findUnique
      .mockResolvedValueOnce({ followerId: 'viewer' })
      .mockResolvedValueOnce(null);
    prisma.messageRequest.findFirst.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue(null);

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.user).not.toHaveProperty('email');
    expect(result.counts).toEqual({
      posts: 3,
      albums: 2,
      followers: 8,
      following: 4,
      favorites: null,
      privateBoards: null,
    });
    expect(result.viewer).toEqual({
      isOwnProfile: false,
      isFollowing: true,
      isFollowedBy: false,
      isMutualFollow: false,
      canViewFavorites: false,
      canViewPrivateBoards: false,
      messageRequestStatus: 'NONE',
      conversationId: null,
      isBlocked: false,
      isBlockedByTarget: false,
      canMessage: false,
      canSendMessageRequest: true,
    });
    expect(prisma.board.count).toHaveBeenCalledWith({
      where: { userId: 'profile-user', isSecret: false },
    });
    expect(prisma.like.count).not.toHaveBeenCalled();
  });

  it('allows messaging for mutual followers without a message request', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'profile-user',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: new Date('2026-01-01'),
    });
    prisma.pin.count.mockResolvedValue(0);
    prisma.board.count.mockResolvedValue(0);
    prisma.follow.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.follow.findUnique
      .mockResolvedValueOnce({ followerId: 'viewer' })
      .mockResolvedValueOnce({ followerId: 'profile-user' });
    prisma.messageRequest.findFirst.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conversation-1' });

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.viewer.isMutualFollow).toBe(true);
    expect(result.viewer.canMessage).toBe(true);
    expect(result.viewer.canSendMessageRequest).toBe(false);
    expect(result.viewer.conversationId).toBe('conversation-1');
  });

  it('blocks messaging and requests when either side has blocked the other', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'profile-user',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: new Date('2026-01-01'),
    });
    prisma.pin.count.mockResolvedValue(0);
    prisma.board.count.mockResolvedValue(0);
    prisma.follow.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.messageRequest.findFirst.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue(null);
    blocksService.isBlocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.viewer.isBlockedByTarget).toBe(true);
    expect(result.viewer.canMessage).toBe(false);
    expect(result.viewer.canSendMessageRequest).toBe(false);
  });

  it('reflects a pending outgoing message request', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'profile-user',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: new Date('2026-01-01'),
    });
    prisma.pin.count.mockResolvedValue(0);
    prisma.board.count.mockResolvedValue(0);
    prisma.follow.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.messageRequest.findFirst.mockResolvedValue({
      senderId: 'viewer',
      status: 'PENDING',
    });
    prisma.conversation.findUnique.mockResolvedValue(null);

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.viewer.messageRequestStatus).toBe('PENDING_OUTGOING');
    expect(result.viewer.canSendMessageRequest).toBe(false);
    expect(result.viewer.canMessage).toBe(false);
  });

  it('selects and returns the profile owner\'s membership plan, never their email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'profile-user',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: new Date('2026-01-01'),
      plan: 'PRO',
    });
    prisma.pin.count.mockResolvedValue(0);
    prisma.board.count.mockResolvedValue(0);
    prisma.follow.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.messageRequest.findFirst.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue(null);

    const result = await service.getUserProfile('artist', 'viewer');

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ plan: true }) }),
    );
    expect(result.user.plan).toBe('PRO');
    expect(result.user).not.toHaveProperty('email');
  });

  it('includes each match\'s membership plan in user search results', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', username: 'artistone', avatarUrl: null, plan: 'PLUS' },
      { id: 'u2', username: 'artisttwo', avatarUrl: null, plan: 'FREE' },
    ]);

    const result = await service.searchUsers('artist', '10');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ plan: true }) }),
    );
    expect(result.items.every((u) => !('email' in u))).toBe(true);
    expect(result.items.map((u) => u.plan)).toEqual(['PLUS', 'FREE']);
  });

  it('uses the authenticated user id for the private favorites query', async () => {
    prisma.like.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-02-01'),
        pin: {
          id: 'pin-1',
          title: 'Frame',
          _count: { likes: 2, comments: 1 },
        },
      },
    ]);
    prisma.like.count.mockResolvedValue(1);

    const result = await service.getFavorites('current-user', '1', '20');

    expect(prisma.like.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'current-user' } }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({ id: 'pin-1', isLiked: true }),
    );
    expect(result.total).toBe(1);
  });
});
