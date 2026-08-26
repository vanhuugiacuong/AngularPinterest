const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID } = require('crypto');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = (envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m) || [])[1];
const tok = (envRaw.match(/^SEPAY_API_TOKEN\s*=\s*"?([^"\n]+)"?/m) || [])[1];
process.env.DATABASE_URL = url;
process.env.SEPAY_API_TOKEN = tok;
const { BillingService } = require('../dist/src/billing/billing.service');

(async () => {
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const svc = new BillingService(prisma);
  const uid = 'test-poll-' + randomUUID();
  try {
    console.log('Token nạp:', tok ? tok.slice(0, 8) + '…' : '(trống)');
    await prisma.user.create({ data: { id: uid, username: uid, email: uid + '@t.local' } });
    const order = await svc.createSubscription(uid, 'MONTHLY');
    console.log('Đơn tạm memo=', order.memo, 'amount=', order.amountVnd);
    const n = await svc.reconcilePendingViaSepay();
    console.log('Số đơn tự khớp từ SePay:', n, '(kỳ vọng 0 vì chưa có giao dịch mới) — code chạy OK, không lỗi.');
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    try { await prisma.user.delete({ where: { id: uid } }); } catch {}
    await prisma.$disconnect(); await pool.end();
  }
})();
