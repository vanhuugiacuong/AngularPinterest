/**
 * Đặt lại số credit khả dụng của MỌI tài khoản Pro còn hạn về đúng 300.
 *
 * Chỉ chạm tài khoản có `proExpiresAt` còn hạn (giống cách billing.service.ts
 * xác định Pro) — tài khoản thường không bị đụng tới.
 *
 * Ghi kèm một dòng CreditTransaction kiểu MONTHLY_GRANT cho mỗi ví bị đổi, để
 * lịch sử ví không bị "nhảy số" mà không có lý do.
 *
 * Cách chạy (in trước/sau, KHÔNG ghi gì nếu chạy thử):
 *   node scratch/reset-pro-credits.cjs           -> chỉ xem trước (dry-run)
 *   node scratch/reset-pro-credits.cjs --apply   -> thực sự ghi
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const TARGET = 300;
const APPLY = process.argv.includes('--apply');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
const connectionString = m ? m[1] : process.env.DATABASE_URL;

(async () => {
  const c = new Client({ connectionString });
  await c.connect();

  try {
    // Lưu ý: bảng Wallet dùng userId làm khoá chính, KHÔNG có cột id riêng.
    const { rows: pros } = await c.query(`
      SELECT u.id, u.username, w."userId" AS wallet_user, w.spendable
      FROM "User" u
      LEFT JOIN "Wallet" w ON w."userId" = u.id
      WHERE u."proExpiresAt" IS NOT NULL AND u."proExpiresAt" > NOW()
      ORDER BY u.username
    `);

    if (pros.length === 0) {
      console.log('Không có tài khoản Pro nào còn hạn.');
      return;
    }

    console.log(APPLY ? '=== THỰC THI ===' : '=== CHẠY THỬ (chưa ghi gì) ===');
    console.log(`Đặt lại credit về ${TARGET} cho ${pros.length} tài khoản Pro còn hạn:\n`);

    let changed = 0;
    for (const p of pros) {
      const before = p.wallet_user ? p.spendable : null;
      const label = before === null ? '(chưa có ví)' : String(before);

      if (before === TARGET) {
        console.log(`  = ${p.username.padEnd(22)} ${label}  -> giữ nguyên`);
        continue;
      }

      console.log(`  ~ ${p.username.padEnd(22)} ${label}  ->  ${TARGET}`);
      changed++;

      if (!APPLY) continue;

      await c.query(
        `INSERT INTO "Wallet" ("userId", spendable, earnings, "updatedAt")
         VALUES ($1,$2,0,NOW())
         ON CONFLICT ("userId") DO UPDATE SET spendable = EXCLUDED.spendable, "updatedAt" = NOW()`,
        [p.id, TARGET],
      );

      await c.query(
        `INSERT INTO "CreditTransaction" (id, "userId", type, amount, "balanceAfter", note, "createdAt")
         VALUES ($1,$2,'MONTHLY_GRANT',$3,$4,$5, NOW())`,
        [
          crypto.randomUUID(),
          p.id,
          TARGET - (before ?? 0),
          TARGET,
          `Đặt lại credit Pro về ${TARGET}`,
        ],
      );
    }

    console.log(`\nSố ví thay đổi: ${changed}/${pros.length}`);

    if (!APPLY) {
      console.log('\n(Chưa ghi gì. Chạy lại kèm --apply để thực sự áp dụng.)');
    } else {
      const { rows: after } = await c.query(`
        SELECT u.username, w.spendable
        FROM "User" u JOIN "Wallet" w ON w."userId" = u.id
        WHERE u."proExpiresAt" IS NOT NULL AND u."proExpiresAt" > NOW()
        ORDER BY u.username
      `);
      console.log('\n=== SAU KHI GHI ===');
      console.table(after);
    }
  } finally {
    await c.end();
  }
})();
