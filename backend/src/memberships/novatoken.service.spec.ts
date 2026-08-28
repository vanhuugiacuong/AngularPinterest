import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NovaTokenService } from './novatoken.service';

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

describe('NovaTokenService.createDemoWithdrawal', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    novaTokenLedger: { aggregate: jest.fn(), create: jest.fn() },
    demoWithdrawal: { aggregate: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: NovaTokenService;

  const payoutConfigured = {
    novaTokenBalance: decimal(200_000),
    payoutBankCode: 'MB',
    payoutAccountNumber: '110605043105',
    payoutAccountName: 'NGUYEN VAN A',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NovaTokenService(prisma as never);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ novaTokenBalance: decimal(0) });
    prisma.demoWithdrawal.create.mockResolvedValue({
      id: 'withdrawal-1',
      amount: decimal(0),
    });
    prisma.novaTokenLedger.create.mockResolvedValue({});
    prisma.demoWithdrawal.aggregate.mockResolvedValue({ _sum: { amount: null } });
  });

  it('rejects amounts below the 10.000đ minimum', async () => {
    await expect(service.createDemoWithdrawal('user-1', 5_000)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects non-integer / unsafe amounts', async () => {
    await expect(service.createDemoWithdrawal('user-1', 'abc')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.createDemoWithdrawal('user-1', 10_000)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects when no payout account has been configured', async () => {
    prisma.user.findUnique.mockResolvedValue({
      novaTokenBalance: decimal(200_000),
      payoutBankCode: null,
      payoutAccountNumber: null,
      payoutAccountName: null,
    });
    await expect(service.createDemoWithdrawal('user-1', 10_000)).rejects.toThrow(
      'cấu hình tài khoản nhận tiền',
    );
  });

  it('rejects withdrawing deposited (top-up) funds that were never earned as sale revenue', async () => {
    // Balance is entirely from a top-up: no FIXED_SALE/AUCTION_SALE credits at all.
    prisma.user.findUnique.mockResolvedValue(payoutConfigured);
    prisma.novaTokenLedger.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await expect(service.createDemoWithdrawal('user-1', 10_000)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects withdrawing more than the remaining sale revenue even if the balance covers it', async () => {
    prisma.user.findUnique.mockResolvedValue(payoutConfigured);
    prisma.novaTokenLedger.aggregate.mockResolvedValue({ _sum: { amount: decimal(50_000) } });
    prisma.demoWithdrawal.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await expect(service.createDemoWithdrawal('user-1', 60_000)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('subtracts previously withdrawn amounts from the available sale revenue', async () => {
    prisma.user.findUnique.mockResolvedValue(payoutConfigured);
    prisma.novaTokenLedger.aggregate.mockResolvedValue({ _sum: { amount: decimal(100_000) } });
    prisma.demoWithdrawal.aggregate.mockResolvedValue({ _sum: { amount: decimal(95_000) } });
    // Only 5.000đ of sale revenue left to withdraw.
    await expect(service.createDemoWithdrawal('user-1', 10_000)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('creates the withdrawal, debits the balance and logs a demo-only ledger entry', async () => {
    prisma.user.findUnique.mockResolvedValue(payoutConfigured);
    prisma.novaTokenLedger.aggregate.mockResolvedValue({ _sum: { amount: decimal(150_000) } });
    prisma.demoWithdrawal.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ novaTokenBalance: decimal(150_000) });
    prisma.demoWithdrawal.create.mockResolvedValue({
      id: 'withdrawal-1',
      amount: decimal(50_000),
    });

    const result = await service.createDemoWithdrawal('user-1', 50_000);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', novaTokenBalance: { gte: 50_000 } },
      data: { novaTokenBalance: { decrement: 50_000 } },
    });
    expect(prisma.demoWithdrawal.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        amount: 50_000,
        bankCode: 'MB',
        accountNumber: '110605043105',
        accountName: 'NGUYEN VAN A',
      },
    });
    const ledgerCall = prisma.novaTokenLedger.create.mock.calls[0][0];
    expect(ledgerCall.data.type).toBe('ADMIN_ADJUSTMENT');
    expect(ledgerCall.data.amount).toBe(-50_000);
    expect(ledgerCall.data.metadata).toMatchObject({ demoOnly: true, withdrawalId: 'withdrawal-1' });
    expect(result.amount).toBe('50000');
  });

  it('surfaces a conflict if the balance changed concurrently', async () => {
    prisma.user.findUnique.mockResolvedValue(payoutConfigured);
    prisma.novaTokenLedger.aggregate.mockResolvedValue({ _sum: { amount: decimal(150_000) } });
    prisma.demoWithdrawal.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.createDemoWithdrawal('user-1', 50_000)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('NovaTokenService platform fee split', () => {
  const treasuryId = 'treasury-1';
  const originalTreasuryEnv = process.env.PLATFORM_TREASURY_USER_ID;

  afterEach(() => {
    if (originalTreasuryEnv === undefined) delete process.env.PLATFORM_TREASURY_USER_ID;
    else process.env.PLATFORM_TREASURY_USER_ID = originalTreasuryEnv;
  });

  describe('purchaseFixedPin', () => {
    const activePlan = { plan: 'PRO', planExpiresAt: null };
    const prisma = {
      pin: { findUnique: jest.fn() },
      auction: { findFirst: jest.fn() },
      user: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      imagePurchase: { findUnique: jest.fn(), create: jest.fn() },
      novaTokenLedger: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    let service: NovaTokenService;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new NovaTokenService(prisma as never);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
      prisma.pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        userId: 'seller-1',
        title: 'Tác phẩm demo',
        isForSale: true,
        price: decimal(100_000),
      });
      prisma.auction.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(activePlan);
      prisma.imagePurchase.findUnique.mockResolvedValue(null);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ novaTokenBalance: decimal(0) });
      prisma.user.update.mockImplementation((args: any) =>
        Promise.resolve({
          novaTokenBalance: decimal(args.where.id === treasuryId ? 30_000 : 70_000),
        }),
      );
      prisma.imagePurchase.create.mockResolvedValue({
        id: 'purchase-1',
        amount: decimal(100_000),
      });
      prisma.novaTokenLedger.create.mockResolvedValue({});
    });

    it('splits 70/30 between the seller and the platform treasury when configured', async () => {
      process.env.PLATFORM_TREASURY_USER_ID = treasuryId;

      await service.purchaseFixedPin('buyer-1', 'pin-1');

      const calls = prisma.user.update.mock.calls as any[];
      const sellerCall = calls.find((call) => call[0].where.id === 'seller-1');
      const treasuryCall = calls.find((call) => call[0].where.id === treasuryId);
      expect(sellerCall[0].data.novaTokenBalance.increment).toBe(70_000);
      expect(treasuryCall[0].data.novaTokenBalance.increment).toBe(30_000);

      const ledgerTypes = (prisma.novaTokenLedger.create.mock.calls as any[]).map(
        (call) => call[0].data.type,
      );
      expect(ledgerTypes).toEqual(
        expect.arrayContaining(['FIXED_PURCHASE', 'FIXED_SALE', 'PLATFORM_FEE']),
      );
    });

    it('gives the seller 100% when no platform treasury is configured', async () => {
      delete process.env.PLATFORM_TREASURY_USER_ID;

      await service.purchaseFixedPin('buyer-1', 'pin-1');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const [sellerArgs] = prisma.user.update.mock.calls[0] as any[];
      expect(sellerArgs.where.id).toBe('seller-1');
      expect(sellerArgs.data.novaTokenBalance.increment).toBe(100_000);

      const ledgerTypes = (prisma.novaTokenLedger.create.mock.calls as any[]).map(
        (call) => call[0].data.type,
      );
      expect(ledgerTypes).not.toContain('PLATFORM_FEE');
    });

    it('lets an admin buy and sell even on the FREE plan (no Plus/Pro required)', async () => {
      delete process.env.PLATFORM_TREASURY_USER_ID;
      prisma.user.findUnique.mockResolvedValue({
        plan: 'FREE',
        planExpiresAt: null,
        isAdmin: true,
      });

      await expect(service.purchaseFixedPin('buyer-1', 'pin-1')).resolves.toBeDefined();
    });
  });

  describe('settleAuction', () => {
    const tx = {
      auctionTokenHold: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      user: { update: jest.fn() },
      novaTokenLedger: { create: jest.fn() },
    };
    let service: NovaTokenService;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new NovaTokenService({} as never);
      tx.auctionTokenHold.findMany.mockResolvedValue([]);
      tx.auctionTokenHold.findUnique.mockResolvedValue({ id: 'hold-1', amount: decimal(100_000) });
      tx.auctionTokenHold.delete.mockResolvedValue({});
      tx.user.update.mockImplementation((args: any) =>
        Promise.resolve({
          novaTokenBalance: decimal(args.where.id === treasuryId ? 30_000 : 70_000),
        }),
      );
      tx.novaTokenLedger.create.mockResolvedValue({});
    });

    it('splits the winning bid 70/30 but still returns the full sale amount (used as the purchase receipt)', async () => {
      process.env.PLATFORM_TREASURY_USER_ID = treasuryId;

      const total = await service.settleAuction(
        tx as never,
        { id: 'auction-1', sellerId: 'seller-1', pinId: 'pin-1' },
        'winner-1',
        'Tác phẩm đấu giá',
      );

      expect(total).toBe(100_000);
      const calls = tx.user.update.mock.calls as any[];
      const sellerCall = calls.find((call) => call[0].where.id === 'seller-1');
      const treasuryCall = calls.find((call) => call[0].where.id === treasuryId);
      expect(sellerCall[0].data.novaTokenBalance.increment).toBe(70_000);
      expect(treasuryCall[0].data.novaTokenBalance.increment).toBe(30_000);
    });

    it('credits the seller in full when no platform treasury is configured', async () => {
      delete process.env.PLATFORM_TREASURY_USER_ID;

      const total = await service.settleAuction(
        tx as never,
        { id: 'auction-1', sellerId: 'seller-1', pinId: 'pin-1' },
        'winner-1',
        'Tác phẩm đấu giá',
      );

      expect(total).toBe(100_000);
      expect(tx.user.update).toHaveBeenCalledTimes(1);
      const [sellerArgs] = tx.user.update.mock.calls[0] as any[];
      expect(sellerArgs.data.novaTokenBalance.increment).toBe(100_000);
    });
  });
});
