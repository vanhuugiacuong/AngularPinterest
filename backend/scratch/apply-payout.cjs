/**
 * Thêm bảng "PayoutRequest" — người bán ảnh gửi yêu cầu rút tiền từ credit
 * kiếm được (Wallet.earnings), admin duyệt rồi chuyển khoản tay.
 *
 * KHÔNG dùng các cột payoutBankCode/payoutAccountNumber/payoutAccountName có
 * sẵn trong bảng User — đó là của hệ thống khác đang dùng chung database.
 *
 * Additive-only: chỉ CREATE TABLE IF NOT EXISTS. In số bản ghi các bảng của hệ
 * khác trước/sau để chứng minh không đụng tới chúng.
 *
 *   node scratch/apply-payout.cjs
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);

const OTHER_TABLES = ['MembershipPayment', 'UserReport', 'NovaTokenTopUp', 'CoinTransaction'];

const SQL = `
CREATE TABLE IF NOT EXISTS "PayoutRequest" (
  "id"            TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "credits"       INTEGER NOT NULL,
  "amountVnd"     INTEGER NOT NULL,
  "bankName"      TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountName"   TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "rejectReason"  TEXT,
  "bankRef"       TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PayoutRequest_status_idx" ON "PayoutRequest" ("status");
CREATE INDEX IF NOT EXISTS "PayoutRequest_userId_idx" ON "PayoutRequest" ("userId");
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
    console.log('TRƯỚC — bảng của hệ thống khác:', await counts(c, OTHER_TABLES));
    await c.query(SQL);
    console.log('SAU  — bảng của hệ thống khác:', await counts(c, OTHER_TABLES));

    const cols = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'PayoutRequest' ORDER BY ordinal_position`,
    );
    console.log('\n✅ Bảng PayoutRequest:');
    console.table(cols.rows);
  } finally {
    await c.end();
  }
})();
