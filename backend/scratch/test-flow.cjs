// Test end-to-end billing service với DB thật, dùng 1 user TẠM rồi xoá sạch.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID } = require('crypto');

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = (envRaw.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m) || [])[1];
process.env.DATABASE_URL = url;

const { BillingService } = require('../dist/src/billing/billing.service');

(async () => {
  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const svc = new BillingService(prisma);

  const uid = 'test-billing-' + randomUUID();
  let ok = true;
  const assert = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) ok = false; };

  try {
    await prisma.user.create({ data: { id: uid, username: uid, email: uid + '@test.local' } });

    // 1) Tạo đơn Pro tháng
    const order = await svc.createSubscription(uid, 'MONTHLY');
    assert(!!order.ref && !!order.memo && order.amountVnd === 79000, `Tạo đơn Pro: ${order.amountVnd}đ, memo=${order.memo}`);
    assert(order.qrUrl.includes('img.vietqr.io'), 'Có URL VietQR');

    // 2) Trạng thái PENDING
    const st1 = await svc.getPaymentStatus(uid, order.ref);
    assert(st1.status === 'PENDING', `Trạng thái ban đầu: ${st1.status}`);

    // 3) Webhook báo tiền vào đúng memo + đủ tiền -> settle
    const res = await svc.settleIncomingTransfer(`CT DEN:123 ${order.memo} chuyen tien`, 79000, 'FT-TEST-001');
    assert(res.matched === true, `Đối soát khớp đơn: ${JSON.stringify(res)}`);

    // 4) Trạng thái PAID
    const st2 = await svc.getPaymentStatus(uid, order.ref);
    assert(st2.status === 'PAID', `Sau webhook: ${st2.status}`);

    // 5) getMe: đã Pro + được 300 credit tặng
    const me = await svc.getMe(uid);
    assert(me.isPro === true, `isPro = ${me.isPro}`);
    assert(me.spendable === 300, `Credit tặng = ${me.spendable}`);

    // 6) Gọi webhook lần nữa (idempotent) -> credit không nhân đôi
    await svc.settleIncomingTransfer(`${order.memo}`, 79000, 'FT-TEST-001');
    const me2 = await svc.getMe(uid);
    assert(me2.spendable === 300, `Idempotent (vẫn 300, không thành 600): ${me2.spendable}`);

    // 7) Mua credit pack M -> +300
    const pack = await svc.createCreditPurchase(uid, 'M');
    await svc.settleIncomingTransfer(pack.memo, 55000, 'FT-TEST-002');
    const me3 = await svc.getMe(uid);
    assert(me3.spendable === 600, `Sau mua pack M: ${me3.spendable}`);

    console.log('\n' + (ok ? '🎉 TẤT CẢ PASS' : '⚠️ CÓ CASE FAIL'));
  } catch (e) {
    console.error('ERR', e);
    ok = false;
  } finally {
    // Dọn sạch user tạm (cascade xoá wallet/payment/subscription/credittxn)
    try { await prisma.user.delete({ where: { id: uid } }); console.log('🧹 Đã xoá user tạm ' + uid); } catch (e) { console.error('Cleanup fail', e.message); }
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = ok ? 0 : 1;
  }
})();
