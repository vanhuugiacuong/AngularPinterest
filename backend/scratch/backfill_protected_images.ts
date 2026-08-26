import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PinPreviewProtectionService } from '../src/watermark/pin-preview-protection.service';

/** One-off backfill for pins that became commerce-restricted (for-sale or
 * auctioned) BEFORE the mandatory-watermark protection feature existed —
 * they have isForSale/an auction but no protectedImageUrl yet, so
 * pin-access.util.ts currently falls back to serving their real preview to
 * non-owner/non-buyer viewers. Reuses PinPreviewProtectionService (the same
 * code path new pins go through) so watermark rendering/upload logic isn't
 * duplicated here. Idempotent — safe to re-run. */
async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const pinPreviewProtection = app.get(PinPreviewProtectionService);

  console.log('Đang quét các ghim đang bán/đấu giá nhưng chưa có ảnh watermark bảo vệ...');

  const pins = await prisma.pin.findMany({
    where: {
      protectedImageUrl: null,
      OR: [{ isForSale: true }, { auctions: { some: { status: { not: 'CANCELLED' } } } }],
    },
    select: { id: true, title: true },
  });

  console.log(`Tìm thấy ${pins.length} ghim cần tạo ảnh watermark bảo vệ.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    console.log(`[${i + 1}/${pins.length}] Đang xử lý: "${pin.title}" (ID: ${pin.id})...`);
    await pinPreviewProtection.ensureProtectedPreview(pin.id);

    const updated = await prisma.pin.findUnique({
      where: { id: pin.id },
      select: { protectedImageUrl: true },
    });
    if (updated?.protectedImageUrl) {
      console.log(' -> Thành công!');
      successCount++;
    } else {
      console.error(' -> Thất bại (xem log lỗi phía trên).');
      failCount++;
    }
  }

  console.log('========================================');
  console.log('Hoàn thành backfill ảnh watermark bảo vệ!');
  console.log(`Thành công: ${successCount}`);
  console.log(`Thất bại: ${failCount}`);

  await app.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
