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

  it('rejects buying when the seller is no longer PRO (downgraded) - listing should be suspended', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' }); // seller downgraded
    await expect(service.purchase('buyer-1', 'pin-1')).rejects.toThrow(ForbiddenException);
  });

  it('creates a PENDING purchase (never PAID) when everything checks out - no free auto-grant', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO' });
    prisma.imagePurchase.findUnique.mockResolvedValue(null);
    prisma.imagePurchase.create.mockResolvedValue({ id: 'purchase-1', status: 'PENDING' });

    const result = await service.purchase('buyer-1', 'pin-1');

    expect(result.status).toBe('PENDING');
    expect(prisma.imagePurchase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('returns the existing purchase record instead of creating a duplicate on repeat calls', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: true, price: 50000 });
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO' });
    prisma.imagePurchase.findUnique.mockResolvedValue({ id: 'purchase-existing', status: 'PENDING' });

    const result = await service.purchase('buyer-1', 'pin-1');

    expect(result).toEqual({ id: 'purchase-existing', status: 'PENDING' });
    expect(prisma.imagePurchase.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService pin-purchase webhook confirmation', () => {
  const prisma = {
    membershipPayment: { findFirst: jest.fn() },
    imagePurchase: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const memberships = { activatePlan: jest.fn() };
  const service = new PaymentsService(prisma as never, memberships as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.membershipPayment.findFirst.mockResolvedValue(null);
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
