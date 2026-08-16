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
});
