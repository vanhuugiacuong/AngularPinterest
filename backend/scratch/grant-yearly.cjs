/**
 * Cấp gói Pro NĂM thủ công cho một tài khoản (dùng khi tặng / hỗ trợ khách).
 *
 * Tạo bản ghi Subscription YEARLY còn hạn 12 tháng và đẩy User.proExpiresAt
 * tương ứng — đúng hai thứ mà hệ thống dựa vào để xác định quyền lợi gói năm
 * (xem BillingService.isOnYearlyPlan và normalizePremium).
 *
 * KHÔNG tự cộng credit: credit là tiền trong hệ thống, muốn cộng thì chạy
 * riêng để việc đó luôn là quyết định có ý thức.
 *
 *   node scratch/grant-yearly.cjs <email>            -> xem trước
 *   node scratch/grant-yearly.cjs <email> --apply    -> thực sự ghi
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const email = process.argv[2];
const APPLY = process.argv.includes('--apply');
const MONTHS = 12;

if (!email) {
  console.error('Cách dùng: node scratch/grant-yearly.cjs <email> [--apply]');
  process.exit(1);
}

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);

(async () => {
  const c = new Client({ connectionString: m[1] });
  await c.connect();
  try {
    const { rows } = await c.query(
      'SELECT id, username, email, "proExpiresAt" FROM "User" WHERE email = $1',
      [email],
    );
    if (!rows.length) {
      console.error(`❌ Không tìm thấy tài khoản: ${email}`);
      return;
    }
    const u = rows[0];

    // Cộng dồn: còn hạn thì nối tiếp, hết hạn thì tính từ hôm nay.
    const now = new Date();
    const base = u.proExpiresAt && new Date(u.proExpiresAt) > now ? new Date(u.proExpiresAt) : now;
    const expires = new Date(base);
    expires.setMonth(expires.getMonth() + MONTHS);

    console.log(APPLY ? '=== THỰC THI ===' : '=== XEM TRƯỚC (chưa ghi gì) ===');
    console.log(`Tài khoản : ${u.username} <${u.email}>`);
    console.log(`Hạn Pro cũ: ${u.proExpiresAt ? new Date(u.proExpiresAt).toLocaleDateString('vi-VN') : '(chưa có)'}`);
    console.log(`Hạn Pro mới: ${expires.toLocaleDateString('vi-VN')}  (+${MONTHS} tháng, gói NĂM)`);

    if (!APPLY) {
      console.log('\n(Chạy lại kèm --apply để thực sự áp dụng.)');
      return;
    }

    await c.query('BEGIN');
    await c.query(
      `INSERT INTO "Subscription" (id, "userId", plan, status, "startedAt", "expiresAt")
       VALUES ($1, $2, 'YEARLY', 'ACTIVE', NOW(), $3)`,
      [crypto.randomUUID(), u.id, expires],
    );
    await c.query('UPDATE "User" SET "isPro" = true, "proExpiresAt" = $1 WHERE id = $2', [
      expires,
      u.id,
    ]);
    await c.query('COMMIT');

    const after = await c.query(
      `SELECT u.username, u."proExpiresAt", s.plan, s.status
       FROM "User" u JOIN "Subscription" s ON s."userId" = u.id
       WHERE u.id = $1 ORDER BY s."startedAt" DESC`,
      [u.id],
    );
    console.log('\n=== SAU KHI GHI ===');
    console.table(after.rows);
    console.log('Lưu ý: credit KHÔNG bị thay đổi. Muốn cộng credit thì làm riêng.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})();
