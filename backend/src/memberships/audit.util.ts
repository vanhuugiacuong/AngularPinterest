import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Ghi audit log cho các hành động nhạy cảm (đổi gói, thanh toán, tải ảnh sạch,
// đổi watermark...). Lỗi ghi log không được làm hỏng luồng nghiệp vụ chính.
export async function writeAuditLog(
  prisma: PrismaService,
  userId: string | null,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error(`[AuditLog] Không ghi được log cho action=${action}`, error);
  }
}
