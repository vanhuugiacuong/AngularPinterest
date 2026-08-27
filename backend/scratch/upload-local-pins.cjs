/**
 * Đăng tải một loạt ảnh cục bộ (folder trên máy) thành Pin thật của 1 user.
 * Dùng khi cần bơm nhanh ảnh có sẵn trên máy vào app mà không qua UI từng cái.
 *
 * Cách chạy:
 *   node scratch/upload-local-pins.cjs "<đường-dẫn-thư-mục>" <userId>
 *
 * Ví dụ:
 *   node scratch/upload-local-pins.cjs "C:\Users\Acer\Downloads\PIN" 993f80f5-d524-475b-a28a-f63b57601353
 *
 * Lưu ý:
 *  - Không tự lấy CLIP embedding ở đây (clip-service không chạy sẵn trong môi
 *    trường này). Sau khi upload xong, chạy 1 lần để bật gợi ý ảnh liên quan:
 *      npx ts-node scratch/backfill_embeddings.ts
 *      npx ts-node scratch/classify_visual_categories.ts
 *  - Ảnh được coi là "nội dung người dùng thật" — KHÔNG gắn cờ hệ thống,
 *    nên sẽ được ưu tiên hơn ảnh seed Unsplash trong bảng xếp hạng feed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
function env(key) {
  const m = envRaw.match(new RegExp('^' + key + '\\s*=\\s*"?([^"\\n]+)"?', 'm'));
  return m ? m[1].trim() : process.env[key];
}

const connectionString = env('DATABASE_URL');
const supabaseUrl = env('SUPABASE_URL');
const supabaseServiceKey = env('SUPABASE_SERVICE_ROLE_KEY');

const dir = process.argv[2];
const userId = process.argv[3];

if (!dir || !userId) {
  console.error('Cách dùng: node scratch/upload-local-pins.cjs "<thư mục ảnh>" <userId>');
  process.exit(1);
}
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`❌ Không tìm thấy thư mục: ${dir}`);
  process.exit(1);
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif']);
function mimeFor(ext) {
  switch (ext) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/jpeg'; // .jpg/.jpeg/.jfif
  }
}

// Dọn tên file thành tiêu đề dễ đọc (bỏ đuôi, id số dài, ký tự lạ dư thừa).
function titleFromFilename(name) {
  let base = name.replace(/\.[^.]+$/, '');
  if (/^\d{10,}$/.test(base)) return 'Ảnh sưu tầm';
  base = base.replace(/[_-]+/g, ' ').trim();
  if (!base) return 'Ảnh sưu tầm';
  return base.length > 90 ? base.slice(0, 90) : base;
}

(async () => {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const userRes = await client.query('SELECT id, username FROM "User" WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      console.error(`❌ Không tìm thấy user với id: ${userId}`);
      process.exit(1);
    }
    console.log(`👤 Đăng dưới tài khoản: ${userRes.rows[0].username} (${userId})`);

    const files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));

    if (files.length === 0) {
      console.log('Không có ảnh nào trong thư mục.');
      return;
    }
    console.log(`🖼️  Tìm thấy ${files.length} ảnh.\n`);

    let ok = 0;
    let failed = 0;

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const filePath = path.join(dir, file);
      const buffer = fs.readFileSync(filePath);
      const mimetype = mimeFor(ext);
      const storagePath = `${userId}/pin_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext === '.jfif' ? '.jpg' : ext}`;

      try {
        const { error: upErr } = await supabase.storage
          .from('pins')
          .upload(storagePath, buffer, { contentType: mimetype, upsert: true });
        if (upErr) throw new Error(upErr.message);

        const { data: urlData } = supabase.storage.from('pins').getPublicUrl(storagePath);
        const imageUrl = urlData.publicUrl;

        const title = titleFromFilename(file);
        const id = crypto.randomUUID();

        await client.query(
          `INSERT INTO "Pin"
             (id, title, "imageUrl", "userId", category,
              "isAiGenerated", "isPremium", "isArchived", "createdAt")
           VALUES ($1,$2,$3,$4,'other',false,false,false, NOW())`,
          [id, title, imageUrl, userId],
        );

        console.log(`  ✔ ${file}  ->  "${title}"`);
        ok++;
      } catch (e) {
        console.error(`  ✘ ${file}: ${e.message || e}`);
        failed++;
      }
    }

    console.log('\n──────────────────────────────');
    console.log(`✅ Đăng thành công: ${ok} | ❌ Lỗi: ${failed}`);
    console.log('\nBước tiếp theo (bật gợi ý ảnh liên quan cho các ảnh vừa đăng):');
    console.log('  1) Chạy CLIP service (backend/services/clip-service): setup.bat 1 lần rồi run.bat');
    console.log('  2) npx ts-node scratch/backfill_embeddings.ts');
    console.log('  3) npx ts-node scratch/classify_visual_categories.ts');
  } finally {
    client.release();
    await pool.end();
  }
})();
