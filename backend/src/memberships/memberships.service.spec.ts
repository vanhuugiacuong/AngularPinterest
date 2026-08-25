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

  it('uses the plan-specific limit (PRO = 20)', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO', planExpiresAt: null });
    prisma.$queryRaw.mockResolvedValue([{ count: 5 }]);

    const result = await service.consumeAi('user-2');

    expect(result.limit).toBe(20);
    // Call shape: [templateStrings, id, userId, usageDate, limit] - limit must be the plan's real limit.
    const callArgs = prisma.$queryRaw.mock.calls[0];
    expect(callArgs[callArgs.length - 1]).toBe(20);
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
