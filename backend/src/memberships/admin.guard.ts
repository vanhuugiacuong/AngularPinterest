import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { UserPayload } from '../supabase/current-user.decorator';

interface AuthenticatedRequest extends Request {
  user: UserPayload;
}

// Chặn các endpoint chỉ dành cho quản trị viên (xác nhận thanh toán thủ công
// khi chưa có webhook ngân hàng thật). Không có UI admin - set User.isAdmin
// trực tiếp trong DB cho tài khoản quản trị.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Chưa đăng nhập.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (!user?.isAdmin) {
      throw new ForbiddenException('Chỉ quản trị viên mới có quyền này.');
    }
    return true;
  }
}
