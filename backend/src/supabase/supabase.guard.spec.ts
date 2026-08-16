import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase.guard';

describe('SupabaseAuthGuard', () => {
  const verifyAccessToken = jest.fn();
  const guard = new SupabaseAuthGuard({ verifyAccessToken } as never);

  function context(authorization?: string) {
    const request = { headers: { authorization }, user: undefined };
    return {
      request,
      executionContext: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext,
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('rejects requests without a bearer token', async () => {
    const { executionContext } = context();
    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('only trusts the verified Supabase user payload', async () => {
    const verifiedUser = { id: 'verified-id', email: 'verified@example.com' };
    verifyAccessToken.mockResolvedValue(verifiedUser);
    const { executionContext, request } = context('Bearer signed-token');

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('signed-token');
    expect(request.user).toEqual(verifiedUser);
  });
});
