import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function contextWithUser(userId: string | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : undefined }) }),
  } as never;
}

describe('AdminGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const guard = new AdminGuard(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unauthenticated request', async () => {
    await expect(guard.canActivate(contextWithUser(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a logged-in user who is not flagged isAdmin', async () => {
    prisma.user.findUnique.mockResolvedValue({ isAdmin: false });
    await expect(guard.canActivate(contextWithUser('user-1'))).rejects.toThrow(ForbiddenException);
  });

  it('allows a user flagged isAdmin=true', async () => {
    prisma.user.findUnique.mockResolvedValue({ isAdmin: true });
    await expect(guard.canActivate(contextWithUser('admin-1'))).resolves.toBe(true);
  });
});
