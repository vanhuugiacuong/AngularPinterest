import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { PaymentsService } from './payments.service';

describe('MembershipsService.purchase (marketplace gating)', () => {
  const prisma = {
    pin: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    imagePurchase: { findUnique: jest.fn(), create: jest.fn() },
  };
  const service = new MembershipsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects buying your own pin', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'user-1', isForSale: true, price: 50000 });
    await expect(service.purchase('user-1', 'pin-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects buying a pin that is not for sale', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: false, price: null });
    await expect(service.purchase('buyer-1', 'pin-1')).rejects.toThrow('không được rao bán');
  });

  it('rejects a FREE buyer even when calling the purchase API directly', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });

    await expect(service.purchase('buyer-1', 'pin-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.imagePurchase.create).not.toHaveBeenCalled();
  });

  it('rejects buying when the seller no longer has a selling plan', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique
      .mockResolvedValueOnce({ plan: 'PLUS', planExpiresAt: null })
      .mockResolvedValueOnce({ plan: 'FREE', planExpiresAt: null });
    await expect(service.purchase('buyer-1', 'pin-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects buying when the seller has not configured a payout account yet (money now goes straight to the seller)', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO', payoutBankCode: null, payoutAccountNumber: null, payoutAccountName: null });
    await expect(service.purchase('buyer-1', 'pin-1')).rejects.toThrow('chưa cấu hình thông tin nhận thanh toán');
  });

  it('creates a PENDING purchase (never PAID) when everything checks out - no free auto-grant, and includes the seller payout account for the QR', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({
      plan: 'PRO',
      payoutBankCode: 'MB',
      payoutAccountNumber: '110605043105',
      payoutAccountName: 'NGUYEN VAN A',
    });
    prisma.imagePurchase.findUnique.mockResolvedValue(null);
    prisma.imagePurchase.create.mockResolvedValue({ id: 'purchase-1', status: 'PENDING' });

    const result = await service.purchase('buyer-1', 'pin-1');

    expect(result.status).toBe('PENDING');
    expect(result.sellerPayout).toEqual({
      bankCode: 'MB',
      accountNumber: '110605043105',
      accountName: 'NGUYEN VAN A',
    });
    expect(prisma.imagePurchase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('returns the existing purchase record (with sellerPayout attached) instead of creating a duplicate on repeat calls', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({
      plan: 'PRO',
      payoutBankCode: 'MB',
      payoutAccountNumber: '110605043105',
      payoutAccountName: 'NGUYEN VAN A',
    });
    prisma.imagePurchase.findUnique.mockResolvedValue({ id: 'purchase-existing', status: 'PENDING' });

    const result = await service.purchase('buyer-1', 'pin-1');

    expect(result).toEqual({
      id: 'purchase-existing',
      status: 'PENDING',
      sellerPayout: { bankCode: 'MB', accountNumber: '110605043105', accountName: 'NGUYEN VAN A' },
    });
    expect(prisma.imagePurchase.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService pin-purchase webhook confirmation', () => {
  const prisma = {
    membershipPayment: { findFirst: jest.fn() },
    imagePurchase: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    novaTokenTopUp: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const memberships = { activatePlan: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  const service = new PaymentsService(prisma as never, memberships as never, notifications as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.membershipPayment.findFirst.mockResolvedValue(null);
    prisma.novaTokenTopUp.findFirst.mockResolvedValue(null);
  });

  it('confirms a pin purchase (BUY... reference) without touching membership plan activation', async () => {
    prisma.imagePurchase.findFirst.mockResolvedValue(null); // no duplicate providerTransactionId
    prisma.imagePurchase.findUnique.mockResolvedValue({
      id: 'purchase-1', buyerId: 'buyer-1', pinId: 'pin-1', sellerId: 'seller-1', status: 'PENDING', amount: 50000,
    });
    prisma.imagePurchase.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.handleSepayWebhook({
      id: 'txn-buy-1',
      content: 'CHUYEN KHOAN BUYABC123XYZ',
      transferAmount: 50000,
      transferType: 'in',
    });

    expect(result).toEqual({ ok: true });
    expect(memberships.activatePlan).not.toHaveBeenCalled();
    expect(prisma.imagePurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'purchase-1', status: 'PENDING' } }),
    );
  });

  it('does not confirm a pin purchase when the transferred amount is wrong', async () => {
    prisma.imagePurchase.findFirst.mockResolvedValue(null);
    prisma.imagePurchase.findUnique.mockResolvedValue({
      id: 'purchase-1', buyerId: 'buyer-1', pinId: 'pin-1', sellerId: 'seller-1', status: 'PENDING', amount: 50000,
    });

    const result = await service.handleSepayWebhook({
      id: 'txn-buy-2',
      content: 'BUYABC123XYZ',
      transferAmount: 10000, // wrong amount
      transferType: 'in',
    });

    expect(result).toEqual({ ok: true, mismatch: true });
    expect(prisma.imagePurchase.updateMany).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.sellerConfirmPurchase (thanh toán trực tiếp cho người bán)', () => {
  const prisma = {
    imagePurchase: { findUnique: jest.fn(), updateMany: jest.fn() },
    pin: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const memberships = { activatePlan: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  const service = new PaymentsService(prisma as never, memberships as never, notifications as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects when the caller is not the seller of this purchase', async () => {
    prisma.imagePurchase.findUnique.mockResolvedValue({
      id: 'purchase-1', buyerId: 'buyer-1', sellerId: 'seller-1', pinId: 'pin-1', status: 'PENDING',
    });

    await expect(service.sellerConfirmPurchase('purchase-1', 'someone-else')).rejects.toThrow(ForbiddenException);
    expect(prisma.imagePurchase.updateMany).not.toHaveBeenCalled();
  });

  it('flips PENDING -> PAID and notifies the buyer when the seller confirms', async () => {
    prisma.imagePurchase.findUnique.mockResolvedValue({
      id: 'purchase-1', buyerId: 'buyer-1', sellerId: 'seller-1', pinId: 'pin-1', status: 'PENDING',
    });
    prisma.imagePurchase.updateMany.mockResolvedValue({ count: 1 });
    prisma.pin.findUnique.mockResolvedValue({ title: 'Tranh sơn dầu' });
    prisma.user.findUnique.mockResolvedValue({ username: 'artist' });

    const result = await service.sellerConfirmPurchase('purchase-1', 'seller-1');

    expect(result).toEqual({ ok: true });
    expect(prisma.imagePurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'purchase-1', sellerId: 'seller-1', status: 'PENDING' } }),
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      'buyer-1',
      'PURCHASE_CONFIRMED_BY_SELLER',
      expect.any(String),
      'seller-1',
      'pin-1',
    );
  });

  it('is idempotent — confirming an already-PAID purchase again is a no-op, not a duplicate notification', async () => {
    prisma.imagePurchase.findUnique.mockResolvedValue({
      id: 'purchase-1', buyerId: 'buyer-1', sellerId: 'seller-1', pinId: 'pin-1', status: 'PAID',
    });
    prisma.imagePurchase.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.sellerConfirmPurchase('purchase-1', 'seller-1');

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});
