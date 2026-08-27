/**
 * Thêm bảng "PaymentReport" — người dùng báo cáo sự cố chuyển khoản để admin
 * xử lý (đã chuyển tiền nhưng chưa nhận, sai số tiền, sai nội dung...).
 *
 * Additive-only: chỉ CREATE TABLE IF NOT EXISTS, không sửa/xoá gì của hệ thống
 * khác đang dùng chung database. In số bản ghi các bảng cũ trước/sau để chứng
 * minh không đụng vào chúng.
 *
 *   node scratch/apply-payment-report.cjs
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);

// Bảng của hệ thống KHÁC dùng chung DB — phải giữ nguyên tuyệt đối.
const OTHER_TABLES = ['MembershipPayment', 'UserReport', 'NovaTokenTopUp', 'CoinTransaction'];

const SQL = `
CREATE TABLE IF NOT EXISTS "PaymentReport" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "paymentId"  TEXT,
  "memo"       TEXT,
  "reason"     TEXT NOT NULL,
  "note"       TEXT,
  "status"     TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedAt" TIMESTAMP,
  "createdAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PaymentReport_status_idx" ON "PaymentReport" ("status");
CREATE INDEX IF NOT EXISTS "PaymentReport_userId_idx" ON "PaymentReport" ("userId");
`;

async function counts(c, tables) {
  const out = {};
  for (const t of tables) {
    try {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      out[t] = r.rows[0].n;
    } catch {
      out[t] = 'n/a';
    }
  }
  return out;
}

(async () => {
  const c = new Client({ connectionString: m[1] });
  await c.connect();
  try {
    console.log('TRƯỚC — bảng của hệ thống khác (không được đổi):', await counts(c, OTHER_TABLES));

    await c.query(SQL);

    console.log('SAU  — bảng của hệ thống khác:', await counts(c, OTHER_TABLES));

    const cols = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'PaymentReport' ORDER BY ordinal_position`,
    );
    console.log('\n✅ Bảng PaymentReport:');
    console.table(cols.rows);
  } finally {
    await c.end();
  }
})();
