// Tạo sẵn 1 đơn thật cho user (để test auto không cần qua frontend/login).
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = (envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m) || [])[1];
process.env.DATABASE_URL = url;
// nạp BANK_* để buildQrUrl dùng VA
for (const k of ['BANK_BIN', 'BANK_ACCOUNT_NO', 'BANK_ACCOUNT_NAME', 'BANK_SHORT_NAME']) {
  const m = envRaw.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+)"?', 'm'));
  if (m) process.env[k] = m[1];
}
const { BillingService } = require('../dist/src/billing/billing.service');

const USER_ID = process.argv[2] || 'cd2a57cf-be2e-4c40-8782-f486bee89077'; // thanhliem
const PACK = process.argv[3] || 'S'; // S=20k

(async () => {
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const svc = new BillingService(prisma);
  try {
    const o = await svc.createCreditPurchase(USER_ID, PACK);
    console.log('\n===== ĐƠN ĐÃ TẠO — QUÉT QR NÀY ĐỂ TRẢ =====');
    console.log('Số tiền   :', o.amountVnd, 'đ');
    console.log('Nội dung  :', o.memo, '  (BẮT BUỘC giữ nguyên)');
    console.log('Nhận vào  : BIDV /', o.bank.accountNo, '(VA) /', o.bank.accountName);
    console.log('QR (mở link này rồi quét):');
    console.log(o.qrUrl);
    console.log('ref =', o.ref);
    console.log('============================================\n');
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    await prisma.$disconnect(); await pool.end();
  }
})();
