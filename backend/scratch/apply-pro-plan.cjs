/**
 * Thêm cột "User.pinhubProPlan" — lưu cấp gói Pro (MONTHLY / YEARLY) ngay trên
 * bảng User để mọi nơi hiển thị avatar biết được người đó dùng gói năm mà
 * KHÔNG phải join bảng Subscription (feed load 20 pin sẽ thành 20 lần join).
 *
 * Tên có tiền tố "pinhub" vì bảng User dùng chung với hệ thống khác — hệ đó đã
 * có sẵn plan/planStartedAt/ownedPlans/planExpiresAt, đặt trùng tên sẽ gây
 * nhầm lẫn nguy hiểm khi đọc code.
 *
 * Additive-only: chỉ ADD COLUMN IF NOT EXISTS + backfill dữ liệu của CHÍNH
 * hệ này (dựa trên bảng Subscription mình tạo). Không đụng cột nào của hệ kia.
 *
 *   node scratch/apply-pro-plan.cjs
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);

// Cột của hệ thống khác — in ra trước/sau để chứng minh không đụng tới.
const OTHER_COLS = ['plan', 'planStartedAt', 'ownedPlans', 'planExpiresAt', 'isAdmin'];

(async () => {
  const c = new Client({ connectionString: m[1] });
  await c.connect();
  try {
    const before = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = ANY($1) ORDER BY column_name`,
      [OTHER_COLS],
    );
    console.log('TRƯỚC — cột của hệ thống khác:');
    console.table(before.rows);

    await c.query(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pinhubProPlan" TEXT`,
    );

    // Backfill: suy ra cấp gói từ Subscription còn hạn của chính hệ này.
    const upd = await c.query(`
      UPDATE "User" u SET "pinhubProPlan" = sub.plan::text
      FROM (
        SELECT DISTINCT ON ("userId") "userId", plan
        FROM "Subscription"
        WHERE "expiresAt" > NOW()
        ORDER BY "userId", (plan = 'YEARLY') DESC, "expiresAt" DESC
      ) sub
      WHERE u.id = sub."userId"
        AND (u."pinhubProPlan" IS DISTINCT FROM sub.plan::text)
    `);
    console.log(`\n✅ Đã thêm cột + backfill ${upd.rowCount} tài khoản.`);

    const after = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = ANY($1) ORDER BY column_name`,
      [OTHER_COLS],
    );
    console.log('\nSAU  — cột của hệ thống khác (phải y hệt):');
    console.table(after.rows);

    const rows = await c.query(`
      SELECT username, "pinhubProPlan", "proExpiresAt"
      FROM "User" WHERE "pinhubProPlan" IS NOT NULL ORDER BY username
    `);
    console.log('\nCấp gói hiện tại:');
    console.table(rows.rows);
  } finally {
    await c.end();
  }
})();
