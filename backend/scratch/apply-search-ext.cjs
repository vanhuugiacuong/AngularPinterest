/**
 * Cài `unaccent` + `pg_trgm` để tìm kiếm chữ hoạt động tử tế.
 *
 * Vì sao cần:
 *  - `unaccent`: gõ "cho" phải tìm ra "chó", gõ "meo" ra "mèo". Giao diện đã bỏ
 *    dấu khi lọc gợi ý, nhưng backend thì so chuỗi thô nên hai bên lệch nhau.
 *  - `pg_trgm`: cho phép đánh chỉ mục GIN trên biểu thức đã bỏ dấu, nếu không
 *    mỗi lần tìm là quét toàn bảng.
 *
 * An toàn với database DÙNG CHUNG: hai tiện ích này chỉ THÊM hàm và kiểu chỉ
 * mục vào schema, không sửa/khoá bảng nào đang có. Script vẫn đếm bảng của hệ
 * thống khác trước/sau để chứng minh.
 *
 * Chạy thử:  node scratch/apply-search-ext.cjs
 * Chạy thật: node scratch/apply-search-ext.cjs --apply
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const OTHER = `select (select count(*) from "MembershipPayment") "MembershipPayment",
                      (select count(*) from "UserReport") "UserReport",
                      (select count(*) from "NovaTokenTopUp") "NovaTokenTopUp",
                      (select count(*) from "CoinTransaction") "CoinTransaction"`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(APPLY ? '=== THỰC THI ===' : '=== CHẠY THỬ (không ghi gì) ===');
  const before = await c.query(OTHER);
  console.log('TRƯỚC — bảng của hệ thống khác:', before.rows[0]);

  const have = (await c.query(
    `select extname from pg_extension where extname in ('unaccent','pg_trgm')`,
  )).rows.map((r) => r.extname);
  console.log('Đã có sẵn:', have.join(', ') || '(chưa có gì)');

  if (!APPLY) {
    console.log('\nSẽ chạy:');
    console.log('  CREATE EXTENSION IF NOT EXISTS unaccent;');
    console.log('  CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    console.log('  CREATE FUNCTION pinhub_norm(text)  -- bỏ dấu + thường hoá, IMMUTABLE để index được');
    console.log('  CREATE INDEX pin_title_norm_trgm  ON "Pin" USING gin (pinhub_norm(title) gin_trgm_ops)');
    console.log('  CREATE INDEX pin_desc_norm_trgm   ON "Pin" USING gin (pinhub_norm(description) gin_trgm_ops)');
    console.log('\nChạy lại kèm --apply để thực hiện.');
    await c.end();
    return;
  }

  await c.query('CREATE EXTENSION IF NOT EXISTS unaccent');
  await c.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  // unaccent() mặc định KHÔNG immutable (phụ thuộc từ điển) nên Postgres từ
  // chối dùng nó trong index. Bọc lại thành hàm immutable của riêng mình —
  // cách chuẩn, và đặt tiền tố `pinhub_` để không đụng tên của hệ thống khác.
  await c.query(`
    CREATE OR REPLACE FUNCTION pinhub_norm(t text)
    RETURNS text AS $$
      SELECT lower(public.unaccent('public.unaccent', coalesce(t, '')))
    $$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  `);

  await c.query(`CREATE INDEX IF NOT EXISTS pin_title_norm_trgm
                 ON "Pin" USING gin (pinhub_norm(title) gin_trgm_ops)`);
  await c.query(`CREATE INDEX IF NOT EXISTS pin_desc_norm_trgm
                 ON "Pin" USING gin (pinhub_norm(description) gin_trgm_ops)`);

  const test = await c.query(`select pinhub_norm('Chó Border Collie hóng gió') as a,
                                     pinhub_norm('MÈO Tabby dễ thương') as b`);
  console.log('\nThử hàm bỏ dấu:');
  console.log('  "Chó Border Collie hóng gió" ->', test.rows[0].a);
  console.log('  "MÈO Tabby dễ thương"        ->', test.rows[0].b);

  const after = await c.query(OTHER);
  console.log('\nSAU  — bảng của hệ thống khác:', after.rows[0]);
  console.log('\n✅ Xong. Tìm kiếm giờ bỏ dấu được và có chỉ mục.');
  await c.end();
})().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
