import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export class UserPayload {
  id: string;
  email: string;
  role?: string;
}

interface AuthenticatedRequest extends Request {
  user: UserPayload;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): UserPayload => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
