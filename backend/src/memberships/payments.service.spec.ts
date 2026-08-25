import { NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

describe('PaymentsService webhook signature', () => {
  const prisma = {};
  const memberships = {};
  const notifications = { createNotification: jest.fn() };
  const service = new PaymentsService(prisma as never, memberships as never, notifications as never, {} as never);
  const originalEnv = process.env.SEPAY_WEBHOOK_API_KEY;

  afterEach(() => {
    process.env.SEPAY_WEBHOOK_API_KEY = originalEnv;
  });

  it('refuses to fake success and lists the missing env var when SEPAY_WEBHOOK_API_KEY is unset', () => {
    delete process.env.SEPAY_WEBHOOK_API_KEY;
    expect(() => service.verifySepayApiKey('Apikey anything')).toThrow(NotImplementedException);
  });

  it('rejects a request whose Authorization header does not match the configured key', () => {
    process.env.SEPAY_WEBHOOK_API_KEY = 'real-secret';
    expect(() => service.verifySepayApiKey('Apikey wrong-key')).toThrow(UnauthorizedException);
  });

  it('accepts a request with the correct Apikey header', () => {
    process.env.SEPAY_WEBHOOK_API_KEY = 'real-secret';
    expect(() => service.verifySepayApiKey('Apikey real-secret')).not.toThrow();
  });
});

describe('PaymentsService.handleSepayWebhook', () => {
  const prisma = {
    membershipPayment: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    imagePurchase: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    novaTokenTopUp: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const memberships = { activatePlan: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  const service = new PaymentsService(prisma as never, memberships as never, notifications as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.imagePurchase.findFirst.mockResolvedValue(null);
    prisma.novaTokenTopUp.findFirst.mockResolvedValue(null);
  });

  it('is idempotent: a webhook replay with the same providerTransactionId is skipped, not double-processed', async () => {
    prisma.membershipPayment.findFirst.mockResolvedValue({ id: 'already-processed' });

    const result = await service.handleSepayWebhook({ id: 'txn-1', content: 'NOVAABC123', transferAmount: 99000, transferType: 'in' });

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(memberships.activatePlan).not.toHaveBeenCalled();
  });

  it('ignores outgoing transfers', async () => {
    prisma.membershipPayment.findFirst.mockResolvedValue(null);

    const result = await service.handleSepayWebhook({ id: 'txn-2', transferType: 'out' });

    expect(result).toEqual({ ok: true, ignored: true });
    expect(memberships.activatePlan).not.toHaveBeenCalled();
  });

  it('does not activate anything when the transferred amount does not match the payment amount', async () => {
    prisma.membershipPayment.findFirst.mockResolvedValue(null);
    prisma.membershipPayment.findUnique.mockResolvedValue({ id: 'pay-1', userId: 'user-1', status: 'PENDING', amount: 99000 });

    const result = await service.handleSepayWebhook({
      id: 'txn-3',
      content: 'chuyen khoan NOVAABC123 upgrade',
      transferAmount: 50000,
      transferType: 'in',
    });

    expect(result).toEqual({ ok: true, mismatch: true });
    expect(memberships.activatePlan).not.toHaveBeenCalled();
  });

  it('activates the plan exactly once when amount and reference both match, using an atomic PENDING->PAID guard', async () => {
    prisma.membershipPayment.findFirst.mockResolvedValue(null);
    prisma.membershipPayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      userId: 'user-1',
      plan: 'PLUS',
      status: 'PENDING',
      amount: 99000,
    });
    prisma.membershipPayment.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.handleSepayWebhook({
      id: 'txn-4',
      content: 'CHUYEN KHOAN NOVAABC123XYZ',
      transferAmount: 99000,
      transferType: 'in',
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.membershipPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pay-1', status: 'PENDING' } }),
    );
    expect(memberships.activatePlan).toHaveBeenCalledWith('user-1', 'PLUS', 'pay-1', expect.any(Date));
  });

  it('does not activate twice when two webhook deliveries race on the same payment (updateMany count 0 on the loser)', async () => {
    prisma.membershipPayment.findFirst.mockResolvedValue(null);
    prisma.membershipPayment.findUnique.mockResolvedValue({
      id: 'pay-2',
      userId: 'user-2',
      plan: 'PRO',
      status: 'PENDING',
      amount: 199000,
    });
    prisma.membershipPayment.updateMany.mockResolvedValue({ count: 0 }); // another request already flipped it to PAID

    const result = await service.handleSepayWebhook({
      id: 'txn-5',
      content: 'NOVAXYZ999',
      transferAmount: 199000,
      transferType: 'in',
    });

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(memberships.activatePlan).not.toHaveBeenCalled();
  });
});
