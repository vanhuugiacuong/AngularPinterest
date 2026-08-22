import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService.toggleFollow', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    follow: { findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
  };
  const blocksService = { isBlocked: jest.fn(), isBlockedEitherWay: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };
  const service = new UsersService(prisma as never, blocksService as never, notificationsService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    blocksService.isBlockedEitherWay.mockResolvedValue(false);
  });

  it('rejects following yourself', async () => {
    await expect(service.toggleFollow('user-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects following someone you have blocked or who has blocked you', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2', username: 'target' });
    blocksService.isBlockedEitherWay.mockResolvedValue(true);

    await expect(service.toggleFollow('user-1', 'user-2')).rejects.toThrow(ForbiddenException);
    expect(prisma.follow.create).not.toHaveBeenCalled();
  });

  it('creates a pending follow request, returns both counts, and sends exactly one FOLLOW_REQUEST notification', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2', username: 'target' });
    prisma.follow.findUnique.mockResolvedValue(null); // no existing relationship
    prisma.follow.create.mockResolvedValue({ followerId: 'user-1', followingId: 'user-2', status: 'PENDING' });
    prisma.follow.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2); // followerCount, followingCount

    const result = await service.toggleFollow('user-1', 'user-2');

    expect(result).toEqual({ followRequestStatus: 'PENDING_OUTGOING', followerCount: 5, followingCount: 2 });
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'user-2',
      'FOLLOW_REQUEST',
      expect.any(String),
      'user-1',
    );
  });

  it('puts the follower\'s real username in the notification text, never their raw user id', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-2', username: 'target' }) // target lookup
      .mockResolvedValueOnce({ username: 'nova_artist' }); // follower lookup for the notification text
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.follow.create.mockResolvedValue({ followerId: 'user-1', followingId: 'user-2' });
    prisma.follow.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await service.toggleFollow('user-1', 'user-2');

    const [, , content] = notificationsService.createNotification.mock.calls[0];
    expect(content).toContain('nova_artist');
    expect(content).not.toContain('user-1');
  });

  it('withdraws/unfollows (deletes) without sending a notification when a relationship already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2', username: 'target' });
    prisma.follow.findUnique.mockResolvedValue({ status: 'ACCEPTED' }); // already following
    prisma.follow.deleteMany.mockResolvedValue({ count: 1 });
    prisma.follow.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);

    const result = await service.toggleFollow('user-1', 'user-2');

    expect(result.followRequestStatus).toBe('NONE');
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('does not send a duplicate notification when a concurrent request already created the same Follow row (P2002 race)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2', username: 'target' });
    prisma.follow.findUnique.mockResolvedValue(null);
    const p2002 = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(p2002, { code: 'P2002', message: 'Unique constraint failed', clientVersion: 'test' });
    prisma.follow.create.mockRejectedValue(p2002);
    prisma.follow.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const result = await service.toggleFollow('user-1', 'user-2');

    // The loser of the race still reports the request as pending (the row
    // exists either way) but must not fire a second notification for it.
    expect(result.followRequestStatus).toBe('PENDING_OUTGOING');
  });
});

describe('UsersService.getFollowers / getFollowing', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn() },
  };
  const blocksService = { isBlocked: jest.fn(), isBlockedEitherWay: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };
  const service = new UsersService(prisma as never, blocksService as never, notificationsService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    blocksService.isBlockedEitherWay.mockResolvedValue(false);
  });

  it('excludes a follower who has blocked (or is blocked by) the viewer', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', username: 'owner' });
    prisma.follow.findMany
      .mockResolvedValueOnce([
        { follower: { id: 'blocked-user', username: 'blocked', avatarUrl: null, bio: null, plan: 'FREE' } },
        { follower: { id: 'ok-user', username: 'ok', avatarUrl: null, bio: null, plan: 'PLUS' } },
      ])
      .mockResolvedValueOnce([]) // viewerFollowing lookup
      .mockResolvedValueOnce([]); // viewerFollowers lookup
    prisma.follow.count.mockResolvedValue(2);
    blocksService.isBlockedEitherWay.mockImplementation(async (_viewer: string, other: string) => other === 'blocked-user');

    const result = await service.getFollowers('owner', 'viewer-1');

    expect(result.items.map((u) => u.id)).toEqual(['ok-user']);
  });

  it('marks viewerIsFollowing / followsViewer correctly per user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', username: 'owner' });
    prisma.follow.findMany
      .mockResolvedValueOnce([
        { following: { id: 'u1', username: 'u1', avatarUrl: null, bio: null, plan: 'FREE' } },
        { following: { id: 'u2', username: 'u2', avatarUrl: null, bio: null, plan: 'FREE' } },
      ])
      .mockResolvedValueOnce([{ followingId: 'u1' }]) // viewer follows u1
      .mockResolvedValueOnce([{ followerId: 'u2' }]); // u2 follows viewer back
    prisma.follow.count.mockResolvedValue(2);

    const result = await service.getFollowing('owner', 'viewer-1');

    expect(result.items.find((u) => u.id === 'u1')).toEqual(
      expect.objectContaining({ viewerIsFollowing: true, followsViewer: false }),
    );
    expect(result.items.find((u) => u.id === 'u2')).toEqual(
      expect.objectContaining({ viewerIsFollowing: false, followsViewer: true }),
    );
  });

  it('never includes email in the returned user shape', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', username: 'owner' });
    prisma.follow.findMany
      .mockResolvedValueOnce([
        { follower: { id: 'u1', username: 'u1', avatarUrl: null, bio: null, plan: 'FREE' } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.follow.count.mockResolvedValue(1);

    const result = await service.getFollowers('owner', undefined);

    expect(result.items[0]).not.toHaveProperty('email');
  });
});
