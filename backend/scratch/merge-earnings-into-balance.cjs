/**
 * Gộp credit bán ảnh (Wallet.earnings) vào số dư chính (Wallet.spendable).
 *
 * Trước đây ví tách hai loại: `spendable` để tiêu, `earnings` chỉ rút được.
 * Nay gộp làm MỘT số dư duy nhất — credit bán ảnh cũng tiêu được, và cả số dư
 * đều rút được. Những khoản `earnings` phát sinh trước khi đổi vẫn đang nằm
 * riêng nên phải chuyển sang, nếu không người bán thấy như bị mất credit.
 *
 * Sau khi chạy, `earnings` GIỮ NGUYÊN giá trị — từ nay nó là bộ đếm "tổng đã
 * kiếm từ trước tới nay", chỉ dùng thống kê, không còn là số dư.
 *
 * Chạy được nhiều lần vẫn an toàn: chỉ chuyển ví nào CHƯA có bút toán đánh dấu
 * đã gộp (note = MERGE_NOTE).
 *
 *   node scratch/merge-earnings-into-balance.cjs           -> xem trước
 *   node scratch/merge-earnings-into-balance.cjs --apply   -> thực sự ghi
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const MERGE_NOTE = 'Gộp credit bán ảnh vào số dư chính';

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);

(async () => {
  const c = new Client({ connectionString: m[1] });
  await c.connect();
  try {
    const { rows } = await c.query(`
      SELECT u.id, u.username, w.spendable, w.earnings,
             EXISTS(
               SELECT 1 FROM "CreditTransaction" ct
               WHERE ct."userId" = u.id AND ct.note = $1
             ) AS already_merged
      FROM "Wallet" w
      JOIN "User" u ON u.id = w."userId"
      WHERE w.earnings > 0
      ORDER BY w.earnings DESC
    `, [MERGE_NOTE]);

    if (rows.length === 0) {
      console.log('Không có ví nào còn credit bán ảnh cần gộp.');
      return;
    }

    console.log(APPLY ? '=== THỰC THI ===' : '=== XEM TRƯỚC (chưa ghi gì) ===');
    let changed = 0;

    for (const r of rows) {
      if (r.already_merged) {
        console.log(`  = ${r.username.padEnd(24)} đã gộp trước đó -> bỏ qua`);
        continue;
      }
      const after = r.spendable + r.earnings;
      console.log(`  ~ ${r.username.padEnd(24)} ${r.spendable} + ${r.earnings} bán ảnh  ->  ${after}`);
      changed++;

      if (!APPLY) continue;

      await c.query('BEGIN');
      await c.query('UPDATE "Wallet" SET spendable = spendable + earnings WHERE "userId" = $1', [r.id]);
      await c.query(
        `INSERT INTO "CreditTransaction" (id, "userId", type, amount, "balanceAfter", note, "createdAt")
         VALUES ($1, $2, 'EARN_SALE', $3, $4, $5, NOW())`,
        [crypto.randomUUID(), r.id, r.earnings, after, MERGE_NOTE],
      );
      await c.query('COMMIT');
    }

    console.log(`\nSố ví cần gộp: ${changed}/${rows.length}`);

    if (!APPLY) {
      console.log('\n(Chưa ghi gì. Chạy lại kèm --apply để thực sự áp dụng.)');
    } else {
      const after = await c.query(`
        SELECT u.username, w.spendable AS "số dư", w.earnings AS "tổng đã kiếm"
        FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
        WHERE w.spendable > 0 OR w.earnings > 0 ORDER BY w.spendable DESC
      `);
      console.log('\n=== SAU KHI GHI ===');
      console.table(after.rows);
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})();
