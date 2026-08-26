const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = (envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m) || [])[1];

const EMAIL = process.argv[2] || 'thanhliem21112006@gmail.com';

(async () => {
  const pool = new Pool({ connectionString: url });
  try {
    const u = await pool.query('SELECT id, username, email, "isPro", "proExpiresAt" FROM "User" WHERE email=$1', [EMAIL]);
    if (u.rows.length === 0) { console.log('Không tìm thấy user', EMAIL); return; }
    const user = u.rows[0];
    console.log('User:', user);

    const p = await pool.query(
      `SELECT id, purpose, "amountVnd", "planCode", "packCode", "creditsGranted", status, memo, "createdAt", "expiresAt"
       FROM "Payment" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 10`,
      [user.id],
    );
    console.log('\nĐơn thanh toán gần đây:');
    for (const r of p.rows) {
      console.log(`- ${r.status} | ${r.purpose} ${r.planCode || r.packCode || ''} | ${r.amountVnd}đ | memo=${r.memo} | ${new Date(r.createdAt).toLocaleString('vi-VN')} | hết hạn ${new Date(r.expiresAt).toLocaleString('vi-VN')} | id=${r.id}`);
    }
  } finally {
    await pool.end();
  }
})();
