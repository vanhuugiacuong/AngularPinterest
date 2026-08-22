import { PinsService } from './pins.service';

describe('PinsService privacy', () => {
  const prisma = {
    pin: { findUnique: jest.fn() },
  };
  const service = new PinsService(prisma as never, {} as never, {} as never);

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
