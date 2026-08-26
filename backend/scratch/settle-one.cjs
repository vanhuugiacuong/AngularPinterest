// Ghi nhận 1 đơn đã trả (dùng khi tiền vào thật nhưng chưa có SePay). markPaid idempotent.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = (envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m) || [])[1];
process.env.DATABASE_URL = url;
const { BillingService } = require('../dist/src/billing/billing.service');

const PAYMENT_ID = process.argv[2];
if (!PAYMENT_ID) { console.error('Thiếu paymentId'); process.exit(1); }

(async () => {
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const svc = new BillingService(prisma);
  try {
    const before = await prisma.payment.findUnique({ where: { id: PAYMENT_ID } });
    if (!before) { console.error('Không tìm thấy đơn', PAYMENT_ID); return; }
    console.log('Đơn:', { status: before.status, amountVnd: before.amountVnd, memo: before.memo, userId: before.userId });

    await svc.markPaid(PAYMENT_ID, 'MANUAL-VERIFIED-REAL-TRANSFER');
    console.log('✅ Đã ghi nhận PAID + áp quyền lợi.');

    const me = await svc.getMe(before.userId);
    console.log('Ví sau khi settle:', me);
  } catch (e) {
    console.error('ERR', e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
