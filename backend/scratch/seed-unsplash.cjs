/**
 * Seed nội dung nền cho PinHub từ Unsplash (hợp pháp, có credit tác giả).
 *
 * Vì sao: khi chưa có nhiều user đăng ảnh, feed/gợi ý trống. Script này đổ
 * vài trăm ảnh aesthetic (tông Y2K / retro / film...) vào bảng "Pin" để feed
 * và "ảnh liên quan" có nội dung ngay. KHÔNG dùng Pinterest API (cấm + vi phạm
 * bản quyền) — dùng Unsplash API (miễn phí, cho phép hiển thị kèm credit).
 *
 * Cách chạy:
 *   1. Lấy Access Key: https://unsplash.com/developers -> New Application
 *   2. Thêm vào backend/.env:  UNSPLASH_ACCESS_KEY="xxxxxxxx"
 *   3. node scratch/seed-unsplash.cjs            (mặc định 1 trang/từ khoá ~30 ảnh/từ)
 *      node scratch/seed-unsplash.cjs 2          (2 trang/từ khoá ~60 ảnh/từ)
 *
 * Lưu ý:
 *  - Ảnh dùng trực tiếp CDN Unsplash (hotlink hợp lệ theo hướng dẫn Unsplash),
 *    không tải về Supabase -> không tốn storage.
 *  - Mỗi pin lưu tên tác giả (description) + link ảnh gốc (sourceUrl, kèm UTM).
 *  - Chủ sở hữu kỹ thuật là user hệ thống "unsplash" (Pin.userId bắt buộc có).
 *  - Sau khi seed, chạy để bật gợi ý theo hình ảnh:
 *       npx ts-node scratch/backfill_embeddings.ts
 *       npx ts-node scratch/classify_visual_categories.ts
 *  - Rate limit Demo Unsplash = 50 request/giờ. Mỗi trang = 1 request (tối đa
 *    30 ảnh). Script tự dừng gọn khi bị giới hạn (HTTP 403) -> chạy lại sau.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

// ---- Đọc .env thủ công (giống các script scratch khác) ------------------
const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
function env(key) {
  const m = envRaw.match(new RegExp('^' + key + '\\s*=\\s*"?([^"\\n]+)"?', 'm'));
  return m ? m[1].trim() : process.env[key];
}
const connectionString = env('DATABASE_URL');
const ACCESS_KEY = env('UNSPLASH_ACCESS_KEY');

if (!connectionString) {
  console.error('❌ Thiếu DATABASE_URL trong .env');
  process.exit(1);
}
if (!ACCESS_KEY || ACCESS_KEY === 'xxxxxxxx') {
  console.error('❌ Thiếu UNSPLASH_ACCESS_KEY trong .env.');
  console.error('   Lấy tại https://unsplash.com/developers rồi thêm dòng:');
  console.error('   UNSPLASH_ACCESS_KEY="your_access_key"');
  process.exit(1);
}

const PAGES = Math.max(1, parseInt(process.argv[2] || '1', 10)); // số trang/từ khoá
const PER_PAGE = 30;

// User hệ thống sở hữu ảnh seed (Pin.userId bắt buộc). ID cố định để chạy lại tái dùng.
const SYSTEM_USER = {
  id: 'e5f00000-0000-4000-8000-000000000001',
  username: 'unsplash',
  email: 'explore@pinhub.local',
  avatarUrl: 'https://api.dicebear.com/7.x/shapes/svg?seed=unsplash',
};

// ---- Từ khoá aesthetic (tông Y2K/retro/film) map sang category của app ----
// category hợp lệ: meme | kpop | drawing | anime | nature | food | fashion | other
const QUERIES = [
  { q: 'y2k aesthetic', category: 'other' },
  { q: 'y2k fashion', category: 'fashion' },
  { q: '2000s aesthetic', category: 'other' },
  { q: 'grunge aesthetic', category: 'other' },
  { q: 'film photography aesthetic', category: 'other' },
  { q: 'polaroid aesthetic', category: 'other' },
  { q: 'vintage aesthetic', category: 'other' },
  { q: 'retro aesthetic', category: 'other' },
  { q: 'vaporwave', category: 'drawing' },
  { q: 'cyber y2k', category: 'anime' },
  { q: 'streetwear aesthetic', category: 'fashion' },
  { q: 'old money aesthetic', category: 'fashion' },
  { q: 'coquette aesthetic', category: 'fashion' },
  { q: 'aesthetic outfit', category: 'fashion' },
  { q: 'aesthetic sky', category: 'nature' },
  { q: 'sunset aesthetic', category: 'nature' },
  { q: 'ocean aesthetic', category: 'nature' },
  { q: 'flower aesthetic', category: 'nature' },
  { q: 'aesthetic coffee', category: 'food' },
  { q: 'cute cafe food', category: 'food' },
  { q: 'anime aesthetic', category: 'anime' },
  { q: 'cyberpunk city', category: 'anime' },
  { q: 'aesthetic collage', category: 'drawing' },
  { q: 'retro poster art', category: 'drawing' },
  { q: 'cute cat aesthetic', category: 'meme' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchUnsplash(query, page) {
  const url =
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
    `&per_page=${PER_PAGE}&page=${page}&content_filter=high&orientation=portrait`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}`, 'Accept-Version': 'v1' },
  });
  if (res.status === 403 || res.status === 429) {
    return { rateLimited: true, results: [] };
  }
  if (!res.ok) {
    console.warn(`  ⚠️  ${query} p${page}: HTTP ${res.status}`);
    return { results: [] };
  }
  const json = await res.json();
  return { results: json.results || [] };
}

// Gọi endpoint download_location theo hướng dẫn Unsplash (best-effort).
async function triggerDownload(photo) {
  try {
    const loc = photo.links && photo.links.download_location;
    if (!loc) return;
    await fetch(loc, { headers: { Authorization: `Client-ID ${ACCESS_KEY}` } });
  } catch {
    /* bỏ qua */
  }
}

(async () => {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  let inserted = 0;
  let skipped = 0;
  let rateLimited = false;

  try {
    // 1. Tạo user hệ thống nếu chưa có
    await client.query(
      `INSERT INTO "User" (id, username, email, "avatarUrl", "isPro")
       VALUES ($1,$2,$3,$4,false)
       ON CONFLICT (id) DO NOTHING`,
      [SYSTEM_USER.id, SYSTEM_USER.username, SYSTEM_USER.email, SYSTEM_USER.avatarUrl],
    );

    // 2. Nạp danh sách sourceUrl đã có để tránh trùng
    const existing = new Set();
    const ex = await client.query(
      `SELECT "sourceUrl" FROM "Pin" WHERE "sourceUrl" IS NOT NULL`,
    );
    for (const r of ex.rows) if (r.sourceUrl) existing.add(r.sourceUrl.split('?')[0]);

    console.log(`🌱 Seed Unsplash — ${QUERIES.length} từ khoá × ${PAGES} trang. Đã có ${existing.size} ảnh nguồn.`);

    for (const { q, category } of QUERIES) {
      if (rateLimited) break;
      let addedForQuery = 0;

      for (let page = 1; page <= PAGES; page++) {
        const { results, rateLimited: rl } = await searchUnsplash(q, page);
        if (rl) {
          rateLimited = true;
          console.log('⏳ Bị giới hạn tần suất Unsplash (403). Dừng lại — chạy lại sau 1 giờ để nạp tiếp.');
          break;
        }
        if (results.length === 0) break;

        for (const photo of results) {
          const baseLink = (photo.links && photo.links.html) || '';
          const key = baseLink.split('?')[0];
          const imageUrl = photo.urls && (photo.urls.regular || photo.urls.small);
          if (!key || !imageUrl || existing.has(key)) {
            skipped++;
            continue;
          }
          existing.add(key);

          const author = (photo.user && photo.user.name) || 'Unsplash';
          const authorLink =
            (photo.user && photo.user.links && photo.user.links.html) || 'https://unsplash.com';
          const sourceUrl = `${baseLink}?utm_source=pinhub&utm_medium=referral`;
          const rawTitle = photo.alt_description || photo.description || q;
          const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1, 90);
          const description =
            `Ảnh bởi ${author} trên Unsplash\n${authorLink}?utm_source=pinhub&utm_medium=referral`;
          const id = crypto.randomUUID();

          await client.query(
            `INSERT INTO "Pin"
               (id, title, description, "imageUrl", "sourceUrl", "userId", category,
                "isAiGenerated", "isPremium", "isArchived", "createdAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,false,false,false, NOW() - ($8 || ' minutes')::interval)`,
            [
              id,
              title,
              description,
              imageUrl,
              sourceUrl,
              SYSTEM_USER.id,
              category,
              String(Math.floor(Math.random() * 20160)), // rải createdAt trong ~14 ngày
            ],
          );
          inserted++;
          addedForQuery++;
          await triggerDownload(photo);
        }

        await sleep(400); // nhẹ tay giữa các request
      }

      console.log(`  ✔ ${q.padEnd(28)} +${addedForQuery}`);
      if (!rateLimited) await sleep(800);
    }

    // Tổng kết
    const total = await client.query(`SELECT COUNT(*)::int c FROM "Pin"`);
    console.log('\n──────────────────────────────');
    console.log(`✅ Thêm mới: ${inserted} ảnh | Bỏ qua (trùng/thiếu): ${skipped}`);
    console.log(`📊 Tổng Pin trong DB: ${total.rows[0].c}`);
    if (!rateLimited) {
      console.log('\nBước tiếp theo (bật gợi ý theo hình ảnh):');
      console.log('  npx ts-node scratch/backfill_embeddings.ts');
      console.log('  npx ts-node scratch/classify_visual_categories.ts');
    }
  } catch (e) {
    console.error('❌ Lỗi seed:', e.message || e);
  } finally {
    client.release();
    await pool.end();
  }
})();
