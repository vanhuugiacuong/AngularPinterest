/**
 * Seed thêm pin cho các user mẫu.
 *
 * Vì sao trỏ thẳng URL Unsplash thay vì tải lên bucket: 960/1080 pin đang có
 * trong DB đã làm đúng như vậy (images.unsplash.com / images.pexels.com). Giữ
 * nguyên cách đó thì seed không tốn dung lượng storage, không đụng tới luồng
 * kiểm duyệt ảnh, và ảnh mới trông đồng nhất với ảnh cũ.
 *
 * Vì sao cần API key: dựng URL Unsplash bằng cách bịa id sẽ ra ảnh 404. Chỉ có
 * endpoint search mới trả về id CÓ THẬT, và nó cũng là thứ duy nhất cho phép
 * lấy ảnh ĐÚNG CHỦ ĐỀ của từng category — không có nó thì tiêu đề "Túi xách da
 * nữ" rất dễ nằm trên một tấm phong cảnh.
 *
 * Hạn mức Unsplash demo là 50 request/giờ. Script lấy 30 ảnh mỗi request nên
 * 500 ảnh tốn khoảng 17-20 request, còn dư nhiều.
 *
 *   node scratch/seed_sample_pins.cjs                 # chỉ xem, KHÔNG ghi gì
 *   node scratch/seed_sample_pins.cjs --apply         # ghi vào DB
 *   node scratch/seed_sample_pins.cjs --apply --count 100
 *   node scratch/seed_sample_pins.cjs --apply --no-embeddings
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const WITH_EMBEDDINGS = !argv.includes('--no-embeddings');
const COUNT = (() => {
  const i = argv.indexOf('--count');
  const n = i >= 0 ? Number(argv[i + 1]) : 500;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
})();

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const pick = (key, required = true) => {
  const m = env.match(new RegExp('^' + key + '\\s*=\\s*"?([^"\\n]+)"?', 'm'));
  if (!m && required) throw new Error('Thiếu ' + key + ' trong backend/.env');
  return m ? m[1] : null;
};

/** Các user mẫu nhận pin mới. Lấy theo username để không phụ thuộc id cứng. */
const SAMPLE_USERNAMES = [
  'lucas_acoustics',
  'meme_lord',
  'charlie_creative',
  'alex_explorer',
  'jane_chef',
  'emily_fashion',
  'chloe_kpop',
  'oliver_sketches',
];

/**
 * category -> truy vấn Unsplash + mẫu tiêu đề tiếng Việt.
 *
 * Danh sách category khớp đúng 16 giá trị đang có trong DB; thêm giá trị lạ sẽ
 * tạo ra một chip lọc không ai bấm được từ nơi khác.
 */
const CATEGORIES = [
  { key: 'nature',       query: 'landscape nature',      titles: ['Khoảnh khắc thiên nhiên', 'Sớm mai trên vùng cao', 'Rừng và sương', 'Ánh sáng cuối ngày'] },
  { key: 'animals',      query: 'animal portrait',       titles: ['Người bạn nhỏ', 'Ánh mắt hoang dã', 'Một buổi chiều lười', 'Chân dung loài vật'] },
  { key: 'fashion',      query: 'fashion street style',  titles: ['Phong cách xuống phố', 'Set đồ tối giản', 'Chất riêng mùa này', 'Layer nhẹ ngày se lạnh'] },
  { key: 'food',         query: 'food photography',      titles: ['Bữa sáng chậm rãi', 'Món ngon cuối tuần', 'Góc bếp ấm', 'Đĩa đẹp vị ngon'] },
  { key: 'art',          query: 'fine art painting',     titles: ['Mảng màu ngẫu hứng', 'Phác thảo cảm xúc', 'Bố cục tĩnh', 'Nét cọ ngày mưa'] },
  { key: 'drawing',      query: 'sketch illustration',   titles: ['Nét chì thô', 'Ký hoạ nhanh', 'Trang sổ tay', 'Hình khối cơ bản'] },
  { key: 'anime',        query: 'anime illustration',    titles: ['Khung hình anime', 'Nhân vật mới', 'Thành phố về đêm', 'Sắc màu hoạt hoạ'] },
  { key: 'meme',         query: 'funny cat',             titles: ['Chuyện thường ngày', 'Mặt mình lúc deadline', 'Không bình luận', 'Hôm nay cũng vậy'] },
  { key: 'kpop',         query: 'concert stage lights',  titles: ['Đêm sân khấu', 'Ánh đèn concert', 'Khoảnh khắc bùng nổ', 'Fan chant'] },
  { key: 'cars',         query: 'car photography',       titles: ['Xe và phố', 'Đường dài', 'Chi tiết kim loại', 'Đỗ bên hiên'] },
  { key: 'tech',         query: 'technology workspace',  titles: ['Góc làm việc', 'Bàn phím và cà phê', 'Thiết bị mới', 'Setup tối giản'] },
  { key: 'acoustics',    query: 'acoustic guitar music', titles: ['Chiều acoustic', 'Dây và gỗ', 'Buổi tập nhỏ', 'Giai điệu chậm'] },
  { key: 'fitness',      query: 'fitness training',      titles: ['Buổi tập sáng', 'Giữ nhịp', 'Sức bền', 'Thói quen mỗi ngày'] },
  { key: 'architecture', query: 'modern architecture',   titles: ['Khối và bóng', 'Đường nét công trình', 'Kính và thép', 'Không gian mở'] },
  { key: 'sports',       query: 'sports action',         titles: ['Khoảnh khắc quyết định', 'Trên sân', 'Tốc độ', 'Tinh thần thi đấu'] },
  { key: 'other',        query: 'minimal aesthetic',     titles: ['Một ngày bình thường', 'Ghi chú thị giác', 'Chi tiết nhỏ', 'Khoảng lặng'] },
];

const UNSPLASH_PER_PAGE = 30;

async function fetchUnsplash(query, needed, accessKey) {
  const out = [];
  const seen = new Set();
  for (let page = 1; out.length < needed && page <= 10; page++) {
    const url =
      'https://api.unsplash.com/search/photos?per_page=' + UNSPLASH_PER_PAGE +
      '&page=' + page + '&content_filter=high&orientation=portrait&query=' +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Authorization: 'Client-ID ' + accessKey } });
    if (res.status === 403) {
      throw new Error('Unsplash tra ve 403 — het han muc gio, hoac key sai.');
    }
    if (!res.ok) throw new Error('Unsplash HTTP ' + res.status);
    const body = await res.json();
    const results = body.results || [];
    if (!results.length) break;
    for (const photo of results) {
      // Cùng dạng tham số với các pin đang có trong DB.
      const src = photo.urls?.raw;
      if (!src || seen.has(photo.id)) continue;
      seen.add(photo.id);
      out.push({
        imageUrl: src + '&w=800&auto=format&fit=crop',
        sourceUrl: photo.links?.html || null,
      });
      if (out.length >= needed) break;
    }
  }
  return out;
}

async function embed(imageUrl, clipUrl) {
  // Cùng đường đi với scratch/backfill_embeddings.ts: tải ảnh, đẩy lên CLIP.
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error('tai anh HTTP ' + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: res.headers.get('Content-Type') || 'image/jpeg' }),
    'image.jpg',
  );
  const clip = await fetch(clipUrl + '/embed/image', { method: 'POST', body: form });
  if (!clip.ok) throw new Error('CLIP HTTP ' + clip.status);
  // `embedding` la ten truong that, xac nhan o clip-service/main.py va o
  // backfill_embeddings.ts — khong doan them nhanh du phong nao.
  const vector = (await clip.json()).embedding;
  if (!Array.isArray(vector) || vector.length !== 512) {
    throw new Error('CLIP tra ve vector la (' + (vector && vector.length) + ')');
  }
  return vector;
}

(async () => {
  const accessKey = pick('UNSPLASH_ACCESS_KEY');
  const clipUrl = pick('CLIP_SERVICE_URL', false) || 'http://127.0.0.1:8001';
  const db = new Client({ connectionString: pick('DATABASE_URL') });
  await db.connect();

  try {
    const users = await db.query(
      'select id, username from "User" where username = any($1::text[])',
      [SAMPLE_USERNAMES],
    );
    if (!users.rows.length) throw new Error('Khong tim thay user mau nao.');
    const missing = SAMPLE_USERNAMES.filter((u) => !users.rows.some((r) => r.username === u));
    if (missing.length) console.log('Bo qua (khong co trong DB):', missing.join(', '));

    // Không chèn lại ảnh đã có: seed chạy hai lần sẽ nhân đôi catalog.
    const existing = await db.query('select "imageUrl" from "Pin"');
    const known = new Set(existing.rows.map((r) => r.imageUrl));

    const perCategory = Math.ceil(COUNT / CATEGORIES.length);
    console.log(
      (APPLY ? 'APPLY' : 'DRY-RUN') + ': muc tieu ' + COUNT + ' pin, ' +
      users.rows.length + ' user mau, ' + CATEGORIES.length + ' category (~' +
      perCategory + '/category), embedding=' + (WITH_EMBEDDINGS ? 'co' : 'khong') + '\n',
    );

    const planned = [];
    for (const cat of CATEGORIES) {
      if (planned.length >= COUNT) break;
      let photos;
      try {
        photos = await fetchUnsplash(cat.query, perCategory, accessKey);
      } catch (error) {
        console.log('  ' + cat.key.padEnd(13) + ' LOI: ' + error.message);
        continue;
      }
      let added = 0;
      for (const photo of photos) {
        if (planned.length >= COUNT) break;
        if (known.has(photo.imageUrl)) continue;
        known.add(photo.imageUrl);
        const user = users.rows[planned.length % users.rows.length];
        const title = cat.titles[added % cat.titles.length] + ' #' + (added + 1);
        planned.push({
          title,
          category: cat.key,
          imageUrl: photo.imageUrl,
          sourceUrl: photo.sourceUrl,
          userId: user.id,
          username: user.username,
        });
        added++;
      }
      console.log('  ' + cat.key.padEnd(13) + ' +' + added);
    }

    console.log('\nTong ke hoach: ' + planned.length + ' pin');
    if (!APPLY) {
      console.log('Vi du 3 dong dau:');
      for (const p of planned.slice(0, 3)) {
        console.log('  [' + p.category + '] ' + p.title + '  <- ' + p.username);
        console.log('     ' + p.imageUrl.slice(0, 96));
      }
      console.log('\nChay lai voi --apply de ghi vao DB.');
      return;
    }

    let inserted = 0;
    let embedded = 0;
    let embedFailed = 0;
    for (const [index, pin] of planned.entries()) {
      try {
        // createdAt trải đều 90 ngày gần đây: cùng một mốc thời gian sẽ khiến
        // feed sắp xếp theo thời gian đổ ra thành một khối.
        const daysAgo = Math.random() * 90;
        const row = await db.query(
          `insert into "Pin" (title, description, "imageUrl", "sourceUrl", "userId", category, "createdAt")
           values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval)
           returning id`,
          [
            pin.title,
            'Ảnh mẫu cho thư viện nội dung.',
            pin.imageUrl,
            pin.sourceUrl,
            pin.userId,
            pin.category,
            daysAgo.toFixed(4),
          ],
        );
        inserted++;

        if (WITH_EMBEDDINGS) {
          try {
            const vector = await embed(pin.imageUrl, clipUrl);
            await db.query('update "Pin" set embedding = $1::vector where id = $2', [
              JSON.stringify(vector),
              row.rows[0].id,
            ]);
            embedded++;
          } catch (error) {
            // Pin vẫn giữ lại: nó hiện đủ ở feed và category, chỉ vắng mặt
            // trong tìm-kiếm-bằng-ảnh. backfill_embeddings.ts bù được sau.
            embedFailed++;
            if (embedFailed <= 3) console.log('    embed loi: ' + error.message);
          }
        }
      } catch (error) {
        console.log('  chen loi (' + pin.category + '): ' + error.message);
      }

      if ((index + 1) % 50 === 0) {
        console.log('  ... ' + (index + 1) + '/' + planned.length);
      }
    }

    console.log(
      '\nDa chen: ' + inserted + '/' + planned.length +
      (WITH_EMBEDDINGS ? '  |  embedding ok ' + embedded + ', loi ' + embedFailed : ''),
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error('LOI:', e.message);
  process.exitCode = 1;
});
