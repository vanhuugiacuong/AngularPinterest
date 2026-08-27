/**
 * Thêm các cột/bảng cho trang Quản trị — additive-only.
 *
 *  1. User.isPinhubAdmin   — quyền admin RIÊNG của hệ này. KHÔNG dùng cột
 *     `isAdmin` có sẵn: đó là của hệ thống khác đang dùng chung database
 *     (tài khoản sau3e_123 đang bật cờ đó, không phải người của nhóm).
 *  2. User.isPinhubBanned  — khoá tài khoản.
 *  3. PinReport.status + resolvedAt — phân biệt báo cáo đã xử lý hay chưa;
 *     không có thì danh sách chờ không bao giờ sạch.
 *
 * Mọi tên đều mang tiền tố `pinhub` để không bao giờ đụng tên với hệ khác —
 * cùng nguyên tắc đã áp dụng cho QrPaymentStatus.
 *
 *   node scratch/apply-admin.cjs                 -> xem trước
 *   node scratch/apply-admin.cjs --apply         -> thực sự ghi
 *   node scratch/apply-admin.cjs --apply --grant email@x.com   -> kèm cấp quyền
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const grantIdx = process.argv.indexOf('--grant');
const grantEmail = grantIdx !== -1 ? process.argv[grantIdx + 1] : null;

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);

// Bảng/cột của hệ thống khác — in trước/sau để chứng minh không đụng tới.
const OTHER_TABLES = ['MembershipPayment', 'UserReport', 'NovaTokenTopUp', 'CoinTransaction'];
const OTHER_COLS = ['isAdmin', 'plan', 'ownedPlans', 'planExpiresAt'];

const SQL = `
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPinhubAdmin"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPinhubBanned" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PinReport" ADD COLUMN IF NOT EXISTS "status"     TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "PinReport" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "PinReport_status_idx" ON "PinReport" ("status");
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
    console.log(APPLY ? '=== THỰC THI ===' : '=== XEM TRƯỚC (chưa ghi gì) ===\n');
    console.log('TRƯỚC — bảng của hệ thống khác:', await counts(c, OTHER_TABLES));

    const colsBefore = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='User' AND column_name = ANY($1) ORDER BY column_name`,
      [OTHER_COLS],
    );
    console.log('TRƯỚC — cột của hệ khác:', colsBefore.rows.map((r) => r.column_name).join(', '));

    if (!APPLY) {
      console.log('\nSẽ thêm:');
      console.log('  • User.isPinhubAdmin   (BOOLEAN, mặc định false)');
      console.log('  • User.isPinhubBanned  (BOOLEAN, mặc định false)');
      console.log('  • PinReport.status     (TEXT, mặc định OPEN)');
      console.log('  • PinReport.resolvedAt (TIMESTAMP)');
      console.log('\n(Chưa ghi gì. Chạy lại kèm --apply để áp dụng.)');
      return;
    }

    await c.query(SQL);

    console.log('SAU  — bảng của hệ thống khác:', await counts(c, OTHER_TABLES));
    const colsAfter = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='User' AND column_name = ANY($1) ORDER BY column_name`,
      [OTHER_COLS],
    );
    console.log('SAU  — cột của hệ khác:', colsAfter.rows.map((r) => r.column_name).join(', '));

    if (grantEmail) {
      const r = await c.query(
        'UPDATE "User" SET "isPinhubAdmin" = true WHERE email = $1 RETURNING username, email',
        [grantEmail],
      );
      console.log(
        r.rowCount
          ? `\n✅ Đã cấp quyền admin cho ${r.rows[0].username} <${r.rows[0].email}>`
          : `\n❌ Không tìm thấy tài khoản ${grantEmail}`,
      );
    }

    const admins = await c.query(
      'SELECT username, email FROM "User" WHERE "isPinhubAdmin" = true ORDER BY username',
    );
    console.log('\nDanh sách admin của PinHub:');
    console.table(admins.rows.length ? admins.rows : [{ username: '(chưa có ai)', email: '' }]);
  } finally {
    await c.end();
  }
})();
