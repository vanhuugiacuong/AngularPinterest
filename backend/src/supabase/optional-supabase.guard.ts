import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UserPayload } from './current-user.decorator';
import { SupabaseService } from './supabase.service';

interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

@Injectable()
export class OptionalSupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      request.user = undefined;
      return true;
    }

    if (!authHeader.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return false;
    }

    request.user = await this.supabaseService.verifyAccessToken(token);
    return true;
  }
}
