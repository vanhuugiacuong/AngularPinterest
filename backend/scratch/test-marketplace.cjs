// Test chợ ảnh Premium end-to-end với DB thật, dùng user/pin TẠM rồi xoá sạch.
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
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const svc = new BillingService(prisma);

  const buyer = 'test-buyer-' + randomUUID();
  const seller = 'test-seller-' + randomUUID();
  let pinId = null;
  let ok = true;
  const assert = (c, m) => { console.log((c ? '✅' : '❌') + ' ' + m); if (!c) ok = false; };

  try {
    await prisma.user.create({ data: { id: buyer, username: buyer, email: buyer + '@t.local' } });
    await prisma.user.create({ data: { id: seller, username: seller, email: seller + '@t.local' } });

    // Nạp 300 credit cho buyer qua luồng mua pack
    const pack = await svc.createCreditPurchase(buyer, 'M');
    await svc.settleIncomingTransfer(pack.memo, 55000, 'FT-M-1');
    assert((await svc.getMe(buyer)).spendable === 300, 'Buyer có 300 credit');

    // Seller tạo pin Premium giá 50 credit
    const pin = await prisma.pin.create({
      data: { title: 'test premium', imageUrl: 'https://example.com/x.jpg', userId: seller, isPremium: true, priceCredits: 50 },
    });
    pinId = pin.id;

    // Access trước khi mua
    let acc = await svc.getPinAccess(buyer, pinId);
    assert(acc.isPremium && acc.priceCredits === 50 && !acc.canDownload, `Access trước mua: khoá, giá ${acc.priceCredits}`);

    // Mua
    const buy = await svc.purchasePin(buyer, pinId);
    assert(buy.alreadyOwned === false && buy.pricePaid === 50, 'Mua thành công, trừ 50');

    assert((await svc.getMe(buyer)).spendable === 250, 'Buyer còn 250 credit');
    assert((await svc.getMe(seller)).earnings === 35, 'Seller nhận 35 (70% của 50)');

    acc = await svc.getPinAccess(buyer, pinId);
    assert(acc.canDownload === true && acc.purchased === true, 'Access sau mua: tải được');

    // Mua lại -> idempotent
    const buy2 = await svc.purchasePin(buyer, pinId);
    assert(buy2.alreadyOwned === true, 'Mua lại: alreadyOwned (không trừ thêm)');
    assert((await svc.getMe(buyer)).spendable === 250, 'Vẫn 250 (không trừ trùng)');

    // Chủ ảnh không mua ảnh của mình
    let selfErr = false;
    try { await svc.purchasePin(seller, pinId); } catch { selfErr = true; }
    assert(selfErr, 'Chủ ảnh không mua được ảnh của mình');

    console.log('\n' + (ok ? '🎉 TẤT CẢ PASS' : '⚠️ CÓ CASE FAIL'));
  } catch (e) {
    console.error('ERR', e); ok = false;
  } finally {
    try { if (pinId) await prisma.pin.delete({ where: { id: pinId } }); } catch {}
    try { await prisma.user.delete({ where: { id: buyer } }); } catch {}
    try { await prisma.user.delete({ where: { id: seller } }); } catch {}
    console.log('🧹 Đã dọn user/pin tạm');
    await prisma.$disconnect(); await pool.end();
    process.exitCode = ok ? 0 : 1;
  }
})();
