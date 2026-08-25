// Backfill an toàn: với mọi Pin chưa có originalStoragePath, tải bytes hiện
// tại từ imageUrl công khai và lưu 1 bản sao vào bucket private "pins-original",
// rồi cập nhật Pin.originalStoragePath. KHÔNG đụng tới imageUrl/bucket "pins"
// hiện có - chỉ thêm dữ liệu mới, có thể chạy lại nhiều lần an toàn (idempotent,
// bỏ qua các Pin đã có originalStoragePath).
import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service';
import { SupabaseService } from '../src/supabase/supabase.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const supabase = new SupabaseService();
  await supabase.onModuleInit();

  const pins = await prisma.pin.findMany({
    where: { originalStoragePath: null },
    select: { id: true, userId: true, imageUrl: true },
  });
  console.log(`Tìm thấy ${pins.length} pin chưa có originalStoragePath.`);

  let ok = 0;
  let failed = 0;
  for (const pin of pins) {
    try {
      const response = await fetch(pin.imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const path = `${pin.userId}/backfill_${pin.id}.${ext}`;
      await supabase.uploadPrivate('pins-original', path, buffer, contentType);
      await prisma.pin.update({ where: { id: pin.id }, data: { originalStoragePath: path } });
      ok++;
      console.log(`OK ${pin.id}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${pin.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Hoàn tất: ${ok} thành công, ${failed} lỗi / ${pins.length} tổng.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
