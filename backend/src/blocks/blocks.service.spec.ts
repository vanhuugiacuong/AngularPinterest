import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlocksService } from './blocks.service';

describe('BlocksService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    userBlock: { upsert: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  };
  let service: BlocksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlocksService(prisma as never);
  });

  it('rejects blocking yourself', async () => {
    await expect(service.blockUser('user-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s when the target user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.blockUser('user-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts the block so blocking twice stays idempotent', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    const result = await service.blockUser('user-1', 'user-2');
    expect(result).toEqual({ blocked: true });
    expect(prisma.userBlock.upsert).toHaveBeenCalledWith({
      where: { blockerId_blockedId: { blockerId: 'user-1', blockedId: 'user-2' } },
      create: { blockerId: 'user-1', blockedId: 'user-2' },
      update: {},
    });
  });

  it('reports blocked-either-way when only one direction blocked', async () => {
    prisma.userBlock.count.mockResolvedValue(1);
    expect(await service.isBlockedEitherWay('user-1', 'user-2')).toBe(true);
  });

  it('reports not blocked when no rows exist', async () => {
    prisma.userBlock.count.mockResolvedValue(0);
    expect(await service.isBlockedEitherWay('user-1', 'user-2')).toBe(false);
  });
});
