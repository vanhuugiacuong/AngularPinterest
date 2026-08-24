import { UsersService } from './users.service';

describe('UsersService profile data', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    pin: { count: jest.fn(), findMany: jest.fn() },
    board: { count: jest.fn(), findMany: jest.fn() },
    follow: { count: jest.fn(), findUnique: jest.fn() },
    followRequest: { findUnique: jest.fn() },
    like: { count: jest.fn(), findMany: jest.fn() },
    messageRequest: { findFirst: jest.fn() },
    conversation: { findUnique: jest.fn() },
  };
  const blocksService = { isBlocked: jest.fn(), isBlockedEitherWay: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };
  const supabaseService = { uploadImage: jest.fn() };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    blocksService.isBlocked.mockResolvedValue(false);
    blocksService.isBlockedEitherWay.mockResolvedValue(false);
    service = new UsersService(
      prisma as never,
      blocksService as never,
      notificationsService as never,
      supabaseService as never,
    );
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
      .mockResolvedValueOnce({ status: 'ACCEPTED' })
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
      hasPendingFollowRequest: false,
      followRequestStatus: 'ACCEPTED',
      canViewFavorites: false,
      canViewPrivateBoards: false,
      canViewPosts: true,
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
      .mockResolvedValueOnce({ status: 'ACCEPTED' })
      .mockResolvedValueOnce({ status: 'ACCEPTED' });
    prisma.messageRequest.findFirst.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conversation-1' });

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.viewer.isMutualFollow).toBe(true);
    expect(result.viewer.canMessage).toBe(true);
    expect(result.viewer.canSendMessageRequest).toBe(false);
    expect(result.viewer.conversationId).toBe('conversation-1');
  });

  it('reflects a pending outgoing follow request on a private profile', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'profile-user',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: new Date('2026-01-01'),
      isPrivate: true,
    });
    prisma.pin.count.mockResolvedValue(0);
    prisma.board.count.mockResolvedValue(0);
    prisma.follow.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.followRequest.findUnique.mockResolvedValue({ status: 'PENDING' });
    prisma.messageRequest.findFirst.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue(null);

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.viewer.hasPendingFollowRequest).toBe(true);
    expect(result.viewer.canViewPosts).toBe(false);
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
    blocksService.isBlocked
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

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

  it("selects and returns the profile owner's membership plan, never their email", async () => {
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
      expect.objectContaining({
        select: expect.objectContaining({ plan: true }),
      }),
    );
    expect(result.user.plan).toBe('PRO');
    expect(result.user).not.toHaveProperty('email');
  });

  it("includes each match's membership plan in user search results", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', username: 'artistone', avatarUrl: null, plan: 'PLUS' },
      { id: 'u2', username: 'artisttwo', avatarUrl: null, plan: 'FREE' },
    ]);

    const result = await service.searchUsers('artist', '10');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ plan: true }),
      }),
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

  describe('private account enforcement', () => {
    it("blocks a stranger from listing a private account's posts", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner-1',
        username: 'artist',
        isPrivate: true,
      });
      prisma.follow.findUnique.mockResolvedValue(null);

      await expect(
        service.getUserPosts('artist', 'stranger-1'),
      ).rejects.toThrow('Tài khoản này ở chế độ riêng tư.');
      expect(prisma.pin.findMany).not.toHaveBeenCalled();
    });

    it("allows an accepted follower to list a private account's posts", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner-1',
        username: 'artist',
        isPrivate: true,
      });
      prisma.follow.findUnique.mockResolvedValue({ followerId: 'follower-1' });
      prisma.pin.findMany.mockResolvedValue([]);
      prisma.pin.count.mockResolvedValue(0);

      await expect(
        service.getUserPosts('artist', 'follower-1'),
      ).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    });

    it('always allows the owner to list their own private posts, without a follow lookup', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner-1',
        username: 'artist',
        isPrivate: true,
      });
      prisma.pin.findMany.mockResolvedValue([]);
      prisma.pin.count.mockResolvedValue(0);

      await expect(service.getUserPosts('artist', 'owner-1')).resolves.toEqual(
        expect.objectContaining({ items: [], total: 0 }),
      );
      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
    });

    it('marks canViewPosts false in the profile summary for a stranger viewing a private account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'profile-user',
        username: 'artist',
        avatarUrl: null,
        bio: null,
        createdAt: new Date('2026-01-01'),
        isPrivate: true,
      });
      prisma.pin.count.mockResolvedValue(3);
      prisma.board.count.mockResolvedValue(0);
      prisma.follow.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.follow.findUnique.mockResolvedValue(null);
      prisma.messageRequest.findFirst.mockResolvedValue(null);
      prisma.conversation.findUnique.mockResolvedValue(null);

      const result = await service.getUserProfile('artist', 'viewer');

      expect(result.viewer.canViewPosts).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('rejects a username that fails the format rule', async () => {
      await expect(
        service.updateProfile('user-1', { username: 'a b' }, undefined),
      ).rejects.toThrow('ID phải từ 3-20 ký tự');
    });

    it('rejects a username already taken by someone else', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.updateProfile('user-1', { username: 'taken' }, undefined),
      ).rejects.toThrow('ID này đã có người sử dụng.');
    });

    it('saves a valid username + bio change', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        username: 'newname',
        bio: 'Hello',
      });

      const result = await service.updateProfile(
        'user-1',
        { username: 'newname', bio: 'Hello' },
        undefined,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { username: 'newname', bio: 'Hello' },
      });
      expect(result).toEqual({
        id: 'user-1',
        username: 'newname',
        bio: 'Hello',
      });
    });
  });

  describe('syncUser', () => {
    it('never overwrites an existing avatar with the OAuth-provided one on re-sync', async () => {
      // Regression test: /sync fires on every page reload (see
      // SupabaseService.syncUserWithBackend) and always carries the OAuth
      // provider's avatar URL. A returning user who has since uploaded a
      // custom avatar via updateProfile() must keep it — not have it
      // silently replaced by their Google/OAuth picture on the next reload.
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        avatarUrl: 'https://storage.example/avatars/user-1/custom.jpg',
      });
      prisma.user.update.mockResolvedValue({});

      await service.syncUser(
        'user-1',
        'user@example.com',
        'Display Name',
        'https://oauth-provider.example/photo.jpg',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          email: 'user@example.com',
          avatarUrl: 'https://storage.example/avatars/user-1/custom.jpg',
        },
      });
    });

    it('still seeds the avatar from OAuth for a returning user who has none yet', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        avatarUrl: null,
      });
      prisma.user.update.mockResolvedValue({});

      await service.syncUser(
        'user-1',
        'user@example.com',
        'Display Name',
        'https://oauth-provider.example/photo.jpg',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          email: 'user@example.com',
          avatarUrl: 'https://oauth-provider.example/photo.jpg',
        },
      });
    });
  });
});
