/**
 * Sinh vector CLIP (+ màu trung bình) cho những ghim còn thiếu.
 *
 * VÌ SAO CẦN: 678/1563 ghim chưa có vector — chúng được đăng trong lúc
 * clip-service không chạy. Ghim thiếu vector thì VÔ HÌNH với tìm theo vùng
 * ảnh và tìm bằng ảnh: hai chức năng đó so vector, không có vector thì coi
 * như ảnh không tồn tại. Đó là lý do khoanh một vùng anime lại trả về ảnh
 * croissant — nó chỉ được chọn trong hơn nửa thư viện.
 *
 * Làm cả `embedding` lẫn `avgColor` trong MỘT lượt tải ảnh, thay vì chạy hai
 * script tải hai lần (backfill_embeddings.ts + backfill_avg_colors.ts).
 *
 * AN TOÀN VỚI DATABASE DÙNG CHUNG:
 *   - Chỉ UPDATE hai cột của bảng "Pin" (bảng của PinHub), không đụng bảng nào
 *     của hệ thống khác, không CREATE/ALTER/DROP bất cứ thứ gì.
 *   - In số dòng các bảng của hệ thống khác TRƯỚC và SAU để chứng minh.
 *
 * Chạy thử:  node scratch/backfill-clip.cjs
 * Chạy thật: node scratch/backfill-clip.cjs --apply
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const CLIP = (process.env.CLIP_SERVICE_URL || 'http://127.0.0.1:8001').replace('localhost', '127.0.0.1');

const OTHER = `select (select count(*) from "MembershipPayment") "MembershipPayment",
                      (select count(*) from "UserReport") "UserReport",
                      (select count(*) from "NovaTokenTopUp") "NovaTokenTopUp",
                      (select count(*) from "CoinTransaction") "CoinTransaction"`;

async function embedImage(imageUrl) {
  // Thử lại vài lần: ảnh nằm trên CDN, một lần trượt mạng không đáng để bỏ ghim.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`tải ảnh ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('Content-Type') || 'image/jpeg';

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)], { type }), 'image.jpg');
      const clipRes = await fetch(`${CLIP}/embed/image`, { method: 'POST', body: form });
      if (!clipRes.ok) throw new Error(`clip ${clipRes.status}`);

      const out = await clipRes.json();
      if (!out?.embedding) throw new Error('không có embedding trong phản hồi');
      const c = Array.isArray(out.avg_color) ? out.avg_color : null;
      return { embedding: out.embedding, avgColor: c };
    } catch (e) {
      if (attempt === 3) return { error: e.message };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(APPLY ? '=== THỰC THI ===' : '=== CHẠY THỬ (không ghi gì) ===');
  const before = (await c.query(OTHER)).rows[0];
  console.log('TRƯỚC — bảng của hệ thống khác:', before);

  const health = await fetch(`${CLIP}/health`).then((r) => r.json()).catch(() => null);
  if (!health) {
    console.error(`LỖI: clip-service không phản hồi ở ${CLIP}. Chạy run.bat trước.`);
    await c.end();
    process.exit(1);
  }
  console.log('clip-service:', health.model);

  const { rows: pins } = await c.query(
    `SELECT id, "imageUrl", title FROM "Pin" WHERE embedding IS NULL AND "imageUrl" IS NOT NULL`,
  );
  console.log(`Ghim thiếu vector: ${pins.length}`);

  if (!APPLY) {
    console.log('\nSẽ chạy: UPDATE "Pin" SET embedding = $1::vector, "avgColor" = $2::vector WHERE id = $3');
    console.log('Chỉ đụng bảng "Pin". Chạy lại kèm --apply để thực hiện.');
    await c.end();
    return;
  }

  let ok = 0;
  let fail = 0;
  const t0 = Date.now();

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const r = await embedImage(pin.imageUrl);
    if (r?.error) {
      fail++;
      console.warn(`[${i + 1}/${pins.length}] BỎ QUA "${(pin.title || '').slice(0, 40)}": ${r.error}`);
      continue;
    }
    try {
      if (r.avgColor) {
        await c.query('UPDATE "Pin" SET embedding = $1::vector, "avgColor" = $2::vector WHERE id = $3', [
          JSON.stringify(r.embedding),
          JSON.stringify(r.avgColor),
          pin.id,
        ]);
      } else {
        await c.query('UPDATE "Pin" SET embedding = $1::vector WHERE id = $2', [
          JSON.stringify(r.embedding),
          pin.id,
        ]);
      }
      ok++;
    } catch (e) {
      fail++;
      console.warn(`[${i + 1}/${pins.length}] LỖI GHI: ${e.message}`);
    }
    if ((i + 1) % 50 === 0) {
      const rate = (i + 1) / ((Date.now() - t0) / 1000);
      const left = Math.round((pins.length - i - 1) / rate);
      console.log(`  ... ${i + 1}/${pins.length}  (ok=${ok} lỗi=${fail})  còn ~${left}s`);
    }
  }

  const after = (await c.query(OTHER)).rows[0];
  const cov = (await c.query('select count(*)::int total, count(embedding)::int co_vector from "Pin"')).rows[0];
  console.log(`\nXong: thành công ${ok}, lỗi ${fail}`);
  console.log('Độ phủ vector:', cov);
  console.log('SAU   — bảng của hệ thống khác:', after);
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(same ? '✅ Bảng hệ thống khác KHÔNG đổi.' : '⚠️  SỐ LIỆU ĐỔI — kiểm tra ngay!');
  await c.end();
})().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
