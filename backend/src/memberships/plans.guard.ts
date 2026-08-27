import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { UserPayload } from '../supabase/current-user.decorator';
import { ENTITLEMENT_KEY } from './require-entitlement.decorator';
import { PLAN_ENTITLEMENTS, PlanEntitlements } from './entitlements';

interface AuthenticatedRequest extends Request {
  user: UserPayload;
}

// Kiểm tra quyền lợi gói ở backend cho mọi route đánh dấu @RequireEntitlement(...).
// Luôn đọc plan hiện tại của user từ DB, không tin giá trị plan/entitlement gửi từ client.
@Injectable()
export class PlansGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<keyof PlanEntitlements | undefined>(
      ENTITLEMENT_KEY,
      context.getHandler(),
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Chưa đăng nhập.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, isAdmin: true },
    });
    if (!user) throw new ForbiddenException('Không tìm thấy người dùng.');

    // Admin luôn được coi như đang ở gói Pro - toàn quyền mọi tính năng.
    const entitlements = PLAN_ENTITLEMENTS[user.isAdmin ? 'PRO' : user.plan];
    if (!entitlements[required]) {
      throw new ForbiddenException('Gói hiện tại của bạn không có quyền này.');
    }
    return true;
  }
}
