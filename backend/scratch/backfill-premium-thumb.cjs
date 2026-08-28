/**
 * Tách ảnh Premium cũ thành hai bản công khai: thumbnail SẠCH cho feed và
 * preview CÓ watermark cho trang chi tiết.
 *
 * Vì sao cần: trước đây `imageUrl` (thứ feed hiển thị) chính là bản watermark,
 * nên ngoài feed ảnh Premium vừa bị phủ chữ vừa mờ — người lướt không buồn bấm
 * vào, mà không bấm vào thì không ai mua. Nhiều bản còn bị thu quá nhỏ
 * (430x560 từ ảnh gốc 749x976) nên nhìn nhoè hẳn.
 *
 * Sau khi chạy:
 *   imageUrl    -> <base>_thumb.jpg    (600px, KHÔNG watermark)  → feed
 *   previewUrl  -> <base>_preview.jpg  (1200px, CÓ watermark)    → chi tiết
 *   originalPath-> giữ nguyên          (HD riêng tư)             → người đã mua
 *
 * Nguồn để tạo lại LUÔN là file gốc HD trong bucket riêng tư — không bao giờ
 * lấy bản watermark cũ làm nguồn, vì làm vậy là nướng chữ chìm vĩnh viễn vào
 * thumbnail.
 *
 * Chạy thử (không ghi gì):   node scratch/backfill-premium-thumb.cjs
 * Chạy thật:                 node scratch/backfill-premium-thumb.cjs --apply
 */
require('dotenv').config();
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const APPLY = process.argv.includes('--apply');

const THUMB_MAX_EDGE = 600;
const PREVIEW_MAX_EDGE = 1200;

/** Lưới chữ chìm nghiêng 30°, lặp kín khung ảnh (giống watermark.service.ts). */
function buildWatermarkSvg(width, height, label) {
  const step = Math.max(150, Math.round(Math.min(width, height) / 3.2));
  const fontSize = Math.max(16, Math.round(step / 7));
  const safe = String(label).replace(/[<>&"']/g, '');
  const rows = [];
  for (let y = -height; y < height * 2; y += step) {
    for (let x = -width; x < width * 2; x += step) {
      rows.push(
        `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" ` +
          `font-weight="700" fill="#ffffff" fill-opacity="0.22">${safe}</text>`,
      );
    }
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-30 ${width / 2} ${height / 2})">${rows.join('')}</g>
    </svg>`;
}

async function makeThumb(buf) {
  return sharp(buf, { failOn: 'none' })
    .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

async function makePreview(buf, label = 'PinHub') {
  const meta = await sharp(buf, { failOn: 'none' }).metadata();
  const w = meta.width ?? PREVIEW_MAX_EDGE;
  const h = meta.height ?? PREVIEW_MAX_EDGE;
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const overlay = Buffer.from(buildWatermarkSvg(outW, outH, label));
  return sharp(buf, { failOn: 'none' })
    .resize(outW, outH, { fit: 'inside', withoutEnlargement: true })
    .composite([{ input: overlay, blend: 'over' }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Đếm bảng của hệ thống DÙNG CHUNG trước/sau để chắc chắn không đụng vào.
  const otherBefore = await pg.query(
    `select (select count(*) from "MembershipPayment") mp,
            (select count(*) from "UserReport") ur,
            (select count(*) from "CoinTransaction") ct`,
  );
  console.log('Bảng hệ thống khác (trước):', otherBefore.rows[0]);

  const { rows } = await pg.query(
    `select id, title, "imageUrl", "previewUrl", "originalPath"
       from "Pin"
      where "isPremium" = true and "originalPath" is not null
      order by "createdAt" desc`,
  );
  console.log(`\nTìm thấy ${rows.length} ảnh Premium có file gốc.\n`);

  let done = 0;
  let skipped = 0;

  for (const p of rows) {
    // Đã tách rồi (imageUrl khác previewUrl và trỏ vào _thumb) thì bỏ qua —
    // chạy lại script nhiều lần không tạo rác.
    if (p.imageUrl && p.imageUrl !== p.previewUrl && p.imageUrl.includes('_thumb')) {
      skipped++;
      continue;
    }

    const { data, error } = await sb.storage.from('pins-original').download(p.originalPath);
    if (error) {
      console.log(`  ✗ ${p.title}: không tải được file gốc (${error.message})`);
      continue;
    }
    const orig = Buffer.from(await data.arrayBuffer());
    const meta = await sharp(orig, { failOn: 'none' }).metadata();

    const base = p.originalPath.replace(/\.[^.]+$/, '');
    const thumbBuf = await makeThumb(orig);
    const previewBuf = await makePreview(orig);
    const tMeta = await sharp(thumbBuf).metadata();
    const pMeta = await sharp(previewBuf).metadata();

    console.log(
      `  ${p.title}\n` +
        `    gốc     ${meta.width}x${meta.height} (${Math.round(orig.length / 1024)}KB)\n` +
        `    thumb   ${tMeta.width}x${tMeta.height} (${Math.round(thumbBuf.length / 1024)}KB) sạch\n` +
        `    preview ${pMeta.width}x${pMeta.height} (${Math.round(previewBuf.length / 1024)}KB) watermark`,
    );

    if (!APPLY) {
      done++;
      continue;
    }

    const thumbPath = `${base}_thumb.jpg`;
    const previewPath = `${base}_preview.jpg`;

    for (const [path, buf] of [
      [thumbPath, thumbBuf],
      [previewPath, previewBuf],
    ]) {
      const up = await sb.storage
        .from('pins')
        .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw new Error(`upload ${path}: ${up.error.message}`);
    }

    const thumbUrl = sb.storage.from('pins').getPublicUrl(thumbPath).data.publicUrl;
    const previewUrl = sb.storage.from('pins').getPublicUrl(previewPath).data.publicUrl;

    await pg.query(`update "Pin" set "imageUrl" = $1, "previewUrl" = $2 where id = $3`, [
      thumbUrl,
      previewUrl,
      p.id,
    ]);
    done++;
  }

  const otherAfter = await pg.query(
    `select (select count(*) from "MembershipPayment") mp,
            (select count(*) from "UserReport") ur,
            (select count(*) from "CoinTransaction") ct`,
  );
  console.log('\nBảng hệ thống khác (sau):', otherAfter.rows[0]);
  console.log(
    `\n${APPLY ? 'ĐÃ CẬP NHẬT' : 'THỬ (chưa ghi gì)'}: ${done} ảnh` +
      (skipped ? `, bỏ qua ${skipped} ảnh đã tách trước đó.` : '.'),
  );
  if (!APPLY) console.log('Chạy lại kèm --apply để ghi thật.');

  await pg.end();
})().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
