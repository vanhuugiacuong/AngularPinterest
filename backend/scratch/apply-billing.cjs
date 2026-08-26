const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const m = envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
const connectionString = m ? m[1] : process.env.DATABASE_URL;
const sql = fs.readFileSync(path.join(__dirname, 'apply-billing.sql'), 'utf8');

const oldTables = ['MembershipPayment', 'NovaTokenTopUp', 'CoinTransaction', 'ImagePurchase', 'MembershipSubscription'];
const myTables = ['Wallet', 'Subscription', 'Payment', 'PinEntitlement', 'CreditTransaction'];

async function counts(client, tables) {
  const out = {};
  for (const t of tables) {
    try {
      const r = await client.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      out[t] = r.rows[0].c;
    } catch {
      out[t] = 'n/a';
    }
  }
  return out;
}

(async () => {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    console.log('BEFORE — bảng cũ (không được đổi):', await counts(client, oldTables));

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('\n✅ Áp SQL chỉ-thêm thành công.');

    console.log('\nAFTER — bảng cũ (phải y nguyên):', await counts(client, oldTables));
    console.log('AFTER — bảng mới (đã tạo):', await counts(client, myTables));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Lỗi, đã ROLLBACK — không thay đổi gì:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
