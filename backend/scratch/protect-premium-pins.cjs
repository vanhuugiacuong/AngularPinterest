/**
 * Đóng lỗ cho các ảnh Premium đăng TRƯỚC khi có cơ chế bảo vệ.
 *
 * Với những ảnh đó, `Pin.imageUrl` trỏ thẳng vào FILE GỐC trong bucket public —
 * nghĩa là thứ trình duyệt tải về để hiển thị chính là bản HD. Mở F12 → tab
 * Network → có file gốc, không cần mua. Kiểm tra entitlement ở endpoint tải về
 * (billing.getPremiumDownloadUrl) canh một cái cửa không có tường.
 *
 * Script này làm đúng thứ createUploadPin làm cho ảnh mới:
 *   1. tải ảnh công khai hiện tại (chính là bản gốc)
 *   2. đưa bản gốc vào bucket RIÊNG TƯ `pins-original`
 *   3. tạo bản preview thu nhỏ + đóng dấu chìm, upload thành object public MỚI
 *   4. cập nhật Pin: imageUrl/previewUrl -> preview, originalPath -> đường riêng tư
 *   5. XOÁ object public cũ
 *
 * Bước 5 là bước thật sự đóng lỗ. Không xoá thì file gốc vẫn nằm nguyên ở URL
 * cũ, và bất kỳ ai đã từng thấy URL đó (cache, history, ảnh chụp F12) vẫn tải
 * được — đổi imageUrl chỉ là ngừng chỉ đường tới nó.
 *
 * Thứ tự trên là có chủ ý: DB chỉ được cập nhật sau khi cả hai file mới đã nằm
 * yên trong storage, nên không có thời điểm nào Pin trỏ vào file chưa tồn tại.
 * Nếu bước 5 lỗi thì hàng DB vẫn đúng, chỉ còn file cũ sót lại — script báo rõ.
 *
 *   node scratch/protect-premium-pins.cjs            # chỉ xem, KHÔNG đổi gì
 *   node scratch/protect-premium-pins.cjs --apply    # thực thi
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const APPLY = process.argv.includes('--apply');
/**
 * --regenerate: lam lai preview cho nhung anh DA co originalPath, doc ban goc
 * tu bucket rieng tu. Can khi doi PREVIEW_BLUR_SIGMA / PREVIEW_MAX_EDGE, vi
 * che do mac dinh chi tim anh CHUA duoc bao ve (originalPath is null) nen se
 * khong thay chung nua.
 */
const REGENERATE = process.argv.includes('--regenerate');
const PUBLIC_BUCKET = 'pins';
const PRIVATE_BUCKET = 'pins-original';
// Phai khop watermark.service.ts, khong thi anh cu va anh moi trong khac nhau.
const PREVIEW_MAX_EDGE = 560;
const PREVIEW_BLUR_SIGMA = 18;

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const pick = (key) => {
  const m = env.match(new RegExp('^' + key + '\\s*=\\s*"?([^"\\n]+)"?', 'm'));
  if (!m) throw new Error('Thiếu ' + key + ' trong .env');
  return m[1];
};

/** Cùng một lưới chữ chìm như WatermarkService — phủ kín mặt ảnh, không phải
 *  một góc: dấu ở góc thì crop một phát là mất. */
function watermarkSvg(width, height, label) {
  const step = Math.max(150, Math.round(Math.min(width, height) / 3.2));
  const fontSize = Math.max(16, Math.round(step / 7));
  const safe = String(label).replace(/[<>&"']/g, '');
  const parts = [];
  for (let y = -height; y < height * 2; y += step) {
    for (let x = -width; x < width * 2; x += step) {
      parts.push(
        `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" ` +
          `font-weight="700" fill="#ffffff" fill-opacity="0.22">${safe}</text>`,
      );
    }
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-30 ${width / 2} ${height / 2})">${parts.join('')}</g>
  </svg>`;
}

async function makePreview(original, label) {
  const meta = await sharp(original, { failOn: 'none' }).metadata();
  const w = meta.width || PREVIEW_MAX_EDGE;
  const h = meta.height || PREVIEW_MAX_EDGE;
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  return sharp(original, { failOn: 'none' })
    .resize(outW, outH, { fit: 'inside', withoutEnlargement: true })
    .blur(PREVIEW_BLUR_SIGMA)
    .composite([{ input: Buffer.from(watermarkSvg(outW, outH, label)), blend: 'over' }])
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}

/** Lấy đường dẫn trong bucket từ URL public, để biết object nào phải xoá. */
function storagePathFromPublicUrl(url) {
  const marker = '/object/public/' + PUBLIC_BUCKET + '/';
  const at = url.indexOf(marker);
  if (at < 0) return null;
  return decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
}

(async () => {
  const db = new Client({ connectionString: pick('DATABASE_URL') });
  const storage = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await db.connect();
  try {
    const buckets = await storage.storage.listBuckets();
    const priv = (buckets.data || []).find((b) => b.name === PRIVATE_BUCKET);
    if (!priv) {
      console.log('DUNG: chua co bucket "' + PRIVATE_BUCKET + '". Tao bucket PRIVATE do truoc.');
      return;
    }
    if (priv.public) {
      console.log('DUNG: bucket "' + PRIVATE_BUCKET + '" dang PUBLIC. Chuyen sang private truoc.');
      return;
    }

    if (REGENERATE) {
      const { rows } = await db.query(
        `select id, title, "imageUrl", "originalPath"
           from "Pin"
          where "isPremium" = true and "originalPath" is not null
          order by "createdAt"`,
      );
      console.log(
        (APPLY ? 'APPLY' : 'DRY-RUN') + ' --regenerate: ' + rows.length +
        ' anh, blur=' + PREVIEW_BLUR_SIGMA + ' edge=' + PREVIEW_MAX_EDGE + '\n',
      );
      let n = 0;
      for (const pin of rows) {
        console.log('- ' + JSON.stringify(pin.title));
        if (!APPLY) {
          console.log('    se: doc goc tu ' + PRIVATE_BUCKET + ' -> lam lai preview (ghi de)');
          continue;
        }
        try {
          const dl = await storage.storage.from(PRIVATE_BUCKET).download(pin.originalPath);
          if (dl.error) throw new Error('tai ban goc: ' + dl.error.message);
          const original = Buffer.from(await dl.data.arrayBuffer());

          const previewPath = storagePathFromPublicUrl(pin.imageUrl);
          if (!previewPath) throw new Error('khong doc duoc duong dan preview tu imageUrl');

          const preview = await makePreview(original, 'PinHub');
          const up = await storage.storage
            .from(PUBLIC_BUCKET)
            .upload(previewPath, preview, { contentType: 'image/jpeg', upsert: true });
          if (up.error) throw new Error('ghi de preview: ' + up.error.message);

          console.log('    XONG: ' + preview.length + ' bytes (ghi de cung duong dan)');
          n++;
        } catch (error) {
          console.log('    LOI: ' + error.message);
        }
      }
      console.log('\nDa lam lai: ' + n + '/' + rows.length);
      if (!APPLY) console.log('Chay lai voi --apply --regenerate de thuc thi.');
      return;
    }

    const { rows } = await db.query(
      `select id, title, "imageUrl", "userId"
         from "Pin"
        where "isPremium" = true and "originalPath" is null
        order by "createdAt"`,
    );

    console.log((APPLY ? 'APPLY' : 'DRY-RUN') + ': ' + rows.length + ' anh Premium chua duoc bao ve\n');
    if (!rows.length) return;

    let done = 0;
    let leftover = 0;

    for (const pin of rows) {
      const oldPath = storagePathFromPublicUrl(pin.imageUrl);
      console.log('- ' + pin.id + '  ' + JSON.stringify(pin.title));
      console.log('    public hien tai : ' + (oldPath || '(khong phai file trong bucket "' + PUBLIC_BUCKET + '")'));

      if (!oldPath) {
        console.log('    BO QUA: anh nam ngoai storage cua minh, khong the di chuyen an toan.');
        continue;
      }
      if (!APPLY) {
        console.log('    se: goc -> ' + PRIVATE_BUCKET + ', preview moi -> ' + PUBLIC_BUCKET + ', xoa file cu');
        continue;
      }

      try {
        const res = await fetch(pin.imageUrl);
        if (!res.ok) throw new Error('tai anh that bai: HTTP ' + res.status);
        const original = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('Content-Type') || 'image/png';

        const base = pin.userId + '/premium_' + pin.id;
        const ext = (oldPath.split('.').pop() || 'png').split('?')[0];

        // 1. ban goc vao bucket rieng tu
        const up1 = await storage.storage
          .from(PRIVATE_BUCKET)
          .upload(base + '.' + ext, original, { contentType, upsert: true });
        if (up1.error) throw new Error('upload private: ' + up1.error.message);

        // 2. preview co watermark vao bucket public
        const preview = await makePreview(original, 'PinHub');
        const previewPath = base + '_preview.jpg';
        const up2 = await storage.storage
          .from(PUBLIC_BUCKET)
          .upload(previewPath, preview, { contentType: 'image/jpeg', upsert: true });
        if (up2.error) throw new Error('upload preview: ' + up2.error.message);

        const previewUrl = storage.storage.from(PUBLIC_BUCKET).getPublicUrl(previewPath)
          .data.publicUrl;

        // 3. DB tro sang preview, ghi lai duong dan ban goc
        await db.query(
          `update "Pin" set "imageUrl" = $1, "previewUrl" = $1, "originalPath" = $2 where id = $3`,
          [previewUrl, base + '.' + ext, pin.id],
        );

        // 4. xoa file goc khoi bucket public -- buoc that su dong lo
        const del = await storage.storage.from(PUBLIC_BUCKET).remove([oldPath]);
        if (del.error) {
          leftover++;
          console.log('    XONG nhung CHUA XOA duoc file cu: ' + del.error.message);
          console.log('    -> file goc VAN CONG KHAI o: ' + oldPath);
        } else {
          console.log('    XONG: da bao ve, da xoa file cu.');
        }
        done++;
      } catch (error) {
        console.log('    LOI (bo qua anh nay, khong de lai trang thai nua voi): ' + error.message);
      }
    }

    console.log('\nDa xu ly: ' + done + '/' + rows.length + (leftover ? '  |  con ' + leftover + ' file cu chua xoa duoc' : ''));
    if (!APPLY) console.log('Chay lai voi --apply de thuc thi.');
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error('LOI:', e.message);
  process.exitCode = 1;
});
