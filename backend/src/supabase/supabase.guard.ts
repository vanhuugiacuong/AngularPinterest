import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SupabaseAuthGuard extends AuthGuard('supabase') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * Nhớ tạm trạng thái khoá để không phải hỏi database ở MỌI request.
   * TTL ngắn (15s) nên khoá một tài khoản là chậm nhất 15 giây sau họ mất
   * quyền — chấp nhận được, đổi lại không nhân đôi tải lên pool kết nối vốn
   * đã chật.
   */
  private static readonly banCache = new Map<string, { banned: boolean; at: number }>();
  private static readonly BAN_TTL_MS = 15_000;

  /** Admin vừa khoá/mở khoá ai thì gọi cái này để có hiệu lực tức thì. */
  static invalidateBan(userId: string) {
    SupabaseAuthGuard.banCache.delete(userId);
  }

  private async isBanned(userId: string): Promise<boolean> {
    const hit = SupabaseAuthGuard.banCache.get(userId);
    const now = Date.now();
    if (hit && now - hit.at < SupabaseAuthGuard.BAN_TTL_MS) return hit.banned;

    try {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isPinhubBanned: true },
      });
      const banned = !!u?.isPinhubBanned;
      SupabaseAuthGuard.banCache.set(userId, { banned, at: now });
      return banned;
    } catch {
      // Database chập chờn thì KHÔNG đá người dùng ra ngoài — coi như chưa bị
      // khoá. Khoá nhầm cả app vì mất kết nối còn tệ hơn là một tài khoản bị
      // khoá muộn vài giây.
      return hit?.banned ?? false;
    }
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // CHỈ chấp nhận token đã kiểm tra CHỮ KÝ (SupabaseStrategy, HS256 với
    // SUPABASE_JWT_SECRET).
    //
    // Trước đây ở đây có hai đường tắt và cả hai đều mở toang cửa:
    //   1. `Bearer mock-token` cho thẳng một tài khoản cố định;
    //   2. khi kiểm chữ ký THẤT BẠI thì tự giải mã phần payload rồi tin luôn
    //      `sub`/`email` trong đó.
    // Đường số 2 nguy hiểm nhất: payload JWT chỉ là base64, ai cũng bịa được.
    // Chỉ cần đặt `sub` bằng id của một admin là qua được guard này, rồi
    // AdminGuard đọc cờ quyền từ database theo đúng cái id bịa đó và cấp toàn
    // quyền quản trị — xoá ảnh, duyệt rút tiền, khoá tài khoản.
    //
    // Không thêm cờ môi trường để bật lại: một đường tắt tắt-bằng-biến-môi-
    // trường vẫn là đường tắt, chỉ cần đặt sai một lần trên máy chủ là thủng.
    try {
      const ok = await super.canActivate(context);
      if (!ok) return false;
    } catch {
      return false;
    }

    return this.rejectIfBanned(request);
  }

  /**
   * Chốt chặn thật của nút "Khoá" ở trang quản trị. Trước đây `isPinhubBanned`
   * chỉ được GHI vào database chứ không chỗ nào đọc, nên khoá tài khoản xong
   * người đó vẫn dùng app bình thường — cờ trang trí.
   *
   * Đặt ở đây (thay vì từng controller) để mọi endpoint có xác thực đều được
   * chặn, khỏi sót chỗ nào.
   */
  private async rejectIfBanned(request: any): Promise<boolean> {
    const userId: string | undefined = request.user?.id;
    if (!userId) return false;
    if (await this.isBanned(userId)) {
      // Kèm `code` máy đọc được: frontend cần PHÂN BIỆT "bị khoá" với mọi lỗi
      // 403 khác (vd. không phải admin) để đưa đúng người bị khoá sang trang
      // giải thích, thay vì để họ gặp lỗi rải rác khắp app mà không hiểu vì sao.
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_BANNED',
        message: 'Tài khoản của bạn đã bị khoá.',
      });
    }
    return true;
  }
}
