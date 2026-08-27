import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Chặn mọi endpoint quản trị với người không phải admin.
 *
 * Đọc cờ quyền TỪ CƠ SỞ DỮ LIỆU theo user.id ở mỗi request — không tin bất cứ
 * dữ liệu nào client gửi lên. Guard phía giao diện chỉ để ẩn menu, không phải
 * lớp bảo mật; đây mới là chỗ chặn thật.
 *
 * Dùng cột `isPinhubAdmin` (riêng của hệ này), KHÔNG dùng `isAdmin` — cột đó
 * thuộc một hệ thống khác đang dùng chung database.
 *
 * Phải đặt SAU SupabaseAuthGuard để `request.user` đã có sẵn.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) throw new ForbiddenException('Bạn cần đăng nhập.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPinhubAdmin: true },
    });

    if (!user?.isPinhubAdmin) {
      throw new ForbiddenException('Bạn không có quyền truy cập khu vực quản trị.');
    }
    return true;
  }
}
