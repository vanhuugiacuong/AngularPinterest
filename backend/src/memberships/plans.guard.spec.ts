import { ForbiddenException } from '@nestjs/common';
import { PlansGuard } from './plans.guard';

function contextWithUser(userId: string, handlerMetadata: string | undefined) {
  return {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
  } as never;
}

describe('PlansGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const reflector = { get: jest.fn() };
  const guard = new PlansGuard(reflector as never, prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('allows through when the route has no @RequireEntitlement metadata', async () => {
    reflector.get.mockReturnValue(undefined);
    await expect(guard.canActivate(contextWithUser('user-1', undefined))).resolves.toBe(true);
  });

  it('blocks a FREE user from a canSell-gated route (server-side, not trusting the client)', async () => {
    reflector.get.mockReturnValue('canSell');
    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    await expect(guard.canActivate(contextWithUser('user-1', 'canSell'))).rejects.toThrow(ForbiddenException);
  });

  it('blocks a PLUS user from an advancedWatermark-gated route (PRO-only entitlement)', async () => {
    reflector.get.mockReturnValue('advancedWatermark');
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' });
    await expect(guard.canActivate(contextWithUser('user-1', 'advancedWatermark'))).rejects.toThrow(ForbiddenException);
  });

  it('allows a PRO user through a canSell-gated route', async () => {
    reflector.get.mockReturnValue('canSell');
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO' });
    await expect(guard.canActivate(contextWithUser('user-1', 'canSell'))).resolves.toBe(true);
  });

  it('allows a PLUS user through a canSell-gated route', async () => {
    reflector.get.mockReturnValue('canSell');
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' });
    await expect(guard.canActivate(contextWithUser('user-1', 'canSell'))).resolves.toBe(true);
  });
});
