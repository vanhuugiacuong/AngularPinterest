import { ForbiddenException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';

describe('MembershipsService.consumeAi', () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    aiUsage: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new MembershipsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('increments atomically via a single conditional SQL statement, not read-then-write', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    prisma.$queryRaw.mockResolvedValue([{ count: 1 }]);

    const result = await service.consumeAi('user-1');

    expect(result).toEqual({ used: 1, limit: 3, remaining: 2, resetAt: expect.any(String) });
    // Only one round-trip to the DB for the counter itself - no separate read then write.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws and does not grant a generation when the atomic UPDATE returns no row (limit already hit)', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    prisma.$queryRaw.mockResolvedValue([]); // WHERE count < limit matched nothing -> limit reached

    await expect(service.consumeAi('user-1')).rejects.toThrow(ForbiddenException);
  });

  it('tracks usage without imposing a limit for PRO', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO', planExpiresAt: null });
    prisma.$queryRaw.mockResolvedValue([{ count: 5 }]);

    const result = await service.consumeAi('user-2');

    expect(result).toEqual({ used: 5, limit: null, remaining: null, resetAt: expect.any(String) });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('gives an admin an unlimited AI quota even on the FREE plan', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null, isAdmin: true });
    prisma.$queryRaw.mockResolvedValue([{ count: 40 }]);

    const result = await service.consumeAi('admin-1');

    expect(result).toEqual({ used: 40, limit: null, remaining: null, resetAt: expect.any(String) });
  });
});

describe('MembershipsService.status', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    aiUsage: { findUnique: jest.fn() },
  };
  const service = new MembershipsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('reports FREE-plan entitlements for an ordinary user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      plan: 'FREE',
      ownedPlans: ['FREE'],
      planStartedAt: null,
      planExpiresAt: null,
      isAdmin: false,
    });
    prisma.aiUsage.findUnique.mockResolvedValue(null);

    const status = await service.status('user-1');

    expect(status.plan).toBe('FREE');
    expect(status.canSell).toBe(false);
    expect(status.canAuction).toBe(false);
    expect(status.aiLimit).toBe(3);
  });

  it('reports full PRO-tier entitlements for an admin whose real plan is still FREE', async () => {
    prisma.user.findUnique.mockResolvedValue({
      plan: 'FREE',
      ownedPlans: ['FREE'],
      planStartedAt: null,
      planExpiresAt: null,
      isAdmin: true,
    });
    prisma.aiUsage.findUnique.mockResolvedValue(null);

    const status = await service.status('admin-1');

    expect(status.plan).toBe('PRO');
    expect(status.canSell).toBe(true);
    expect(status.canAuction).toBe(true);
    expect(status.canDownloadClean).toBe(true);
    expect(status.advancedWatermark).toBe(true);
    expect(status.maxWatermarkPresets).toBe(20);
    expect(status.aiLimit).toBeNull();
  });
});

describe('MembershipsService.changePlan', () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    aiUsage: { findUnique: jest.fn() },
    membershipSubscription: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const service = new MembershipsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not allow manually downgrading an active paid plan to FREE', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ plan: 'PRO', planExpiresAt: new Date(Date.now() + 86_400_000) })
      .mockResolvedValueOnce({ plan: 'PRO' });

    await expect(service.changePlan('user-1', 'FREE')).rejects.toThrow(
      'sẽ tự động chuyển về Free khi hết hạn',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects switching to a plan the user never paid for', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ ownedPlans: ['FREE'] });

    await expect(service.changePlan('user-1', 'PRO')).rejects.toThrow('Bạn chưa thanh toán cho gói này.');
  });

  it('rejects switching to an owned plan whose paid subscription has expired', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ ownedPlans: ['FREE', 'PLUS'] });
    prisma.membershipSubscription.findFirst.mockResolvedValue(null); // no non-expired subscription

    await expect(service.changePlan('user-1', 'PLUS')).rejects.toThrow('đã hết hạn');
  });
});
