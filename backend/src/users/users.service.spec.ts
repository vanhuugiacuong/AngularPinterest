import { UsersService } from './users.service';

describe('UsersService profile data', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    pin: { count: jest.fn(), findMany: jest.fn() },
    board: { count: jest.fn(), findMany: jest.fn() },
    follow: { count: jest.fn(), findUnique: jest.fn() },
    like: { count: jest.fn(), findMany: jest.fn() },
  };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma as never);
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
    prisma.follow.findUnique.mockResolvedValue({ followerId: 'viewer' });

    const result = await service.getUserProfile('artist', 'viewer');

    expect(result.user).not.toHaveProperty('email');
    expect(result.counts).toEqual({
      posts: 3,
      albums: 2,
      followers: 8,
      following: 4,
      favorites: null,
    });
    expect(result.viewer).toEqual({
      isOwnProfile: false,
      isFollowing: true,
      canViewFavorites: false,
    });
    expect(prisma.board.count).toHaveBeenCalledWith({
      where: { userId: 'profile-user', isSecret: false },
    });
    expect(prisma.like.count).not.toHaveBeenCalled();
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
