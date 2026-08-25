import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuctionsService } from './auctions.service';

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

describe('AuctionsService.createAuction', () => {
  const prisma = {
    pin: { findUnique: jest.fn(), update: jest.fn() },
    auction: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const memberships = { status: jest.fn(), getPayoutAccount: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  let service: AuctionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuctionsService(prisma as never, memberships as never, notifications as never);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    // Mặc định đã cấu hình tài khoản nhận tiền - test riêng cho case thiếu.
    memberships.getPayoutAccount.mockResolvedValue({
      bankCode: 'MB',
      accountNumber: '110605043105',
      accountName: 'NGUYEN VAN A',
    });
  });

  afterEach(() => {
    // Dừng interval sweep nền để Jest không treo sau khi test kết thúc.
    service.onModuleDestroy();
  });

  const basicBody = {
    pinId: 'pin-1',
    startingPrice: 100_000,
    minimumIncrement: 10_000,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  };

  it('rejects when the seller does not own the pin', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'someone-else', isForSale: false });
    await expect(service.createAuction('seller-1', basicBody)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the seller is not PRO (even if they own the pin)', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: false });
    memberships.status.mockResolvedValue({ plan: 'PLUS' });
    await expect(service.createAuction('seller-1', basicBody)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the seller has not configured a payout account yet (winner would have no QR to pay)', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: false });
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    memberships.getPayoutAccount.mockResolvedValue(null);
    await expect(service.createAuction('seller-1', basicBody)).rejects.toThrow(
      'cấu hình thông tin nhận thanh toán',
    );
  });

  it('rejects when the pin already has a non-ended auction', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: false });
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    prisma.auction.findFirst.mockResolvedValue({ id: 'existing-auction' });
    await expect(service.createAuction('seller-1', basicBody)).rejects.toThrow(BadRequestException);
  });

  it('rejects a starting price below 1.000đ or non-integer', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: false });
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    prisma.auction.findFirst.mockResolvedValue(null);
    await expect(
      service.createAuction('seller-1', { ...basicBody, startingPrice: 500 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects endsAt before startsAt', async () => {
    prisma.pin.findUnique.mockResolvedValue({ id: 'pin-1', userId: 'seller-1', isForSale: false });
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    prisma.auction.findFirst.mockResolvedValue(null);
    await expect(
      service.createAuction('seller-1', { ...basicBody, startsAt: basicBody.endsAt, endsAt: basicBody.startsAt }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AuctionsService.placeBid', () => {
  const prisma = {
    auction: { findUnique: jest.fn(), updateMany: jest.fn() },
    auctionBid: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    pin: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const memberships = { status: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  let service: AuctionsService;

  const activeAuction = {
    id: 'auction-1',
    pinId: 'pin-1',
    sellerId: 'seller-1',
    status: 'ACTIVE',
    startingPrice: decimal(100_000),
    currentPrice: decimal(100_000),
    minimumIncrement: decimal(10_000),
    bidCount: 0,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 60 * 60 * 1000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuctionsService(prisma as never, memberships as never, notifications as never);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.auctionBid.findUnique.mockResolvedValue(null);
    prisma.auctionBid.findFirst.mockResolvedValue(null);
    // Shared mock for every prisma.auction.findUnique call in the flow —
    // ensureAuctionUpToDate's plain read, the transaction's plain read, and
    // getAuction()'s final include-based read all go through this same mock,
    // so it carries both the flat Auction fields and the include shape.
    prisma.auction.findUnique.mockResolvedValue({
      ...activeAuction,
      pin: { id: 'pin-1', title: 'Tranh sơn dầu', imageUrl: 'https://img', userId: 'seller-1' },
      bids: [],
    });
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('rejects the seller bidding on their own auction', async () => {
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    await expect(
      service.placeBid('auction-1', 'seller-1', { amount: 110_000, requestKey: 'req-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a bid below the required minimum (starting price for the first bid)', async () => {
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    await expect(
      service.placeBid('auction-1', 'bidder-1', { amount: 90_000, requestKey: 'req-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a bid below currentPrice + minimumIncrement once there is already a bid', async () => {
    prisma.auction.findUnique.mockResolvedValue({ ...activeAuction, bidCount: 1, currentPrice: decimal(100_000) });
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    // 100_000 + 10_000 = 110_000 minimum; 105_000 must be rejected.
    await expect(
      service.placeBid('auction-1', 'bidder-1', { amount: 105_000, requestKey: 'req-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a bid from a FREE-plan user', async () => {
    memberships.status.mockResolvedValue({ plan: 'FREE' });
    await expect(
      service.placeBid('auction-1', 'bidder-1', { amount: 100_000, requestKey: 'req-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a bid placed after the auction has ended (server time)', async () => {
    prisma.auction.findUnique.mockResolvedValue({ ...activeAuction, endsAt: new Date(Date.now() - 1000), status: 'ACTIVE' });
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    // ensureAuctionUpToDate will finalize it first (no bids -> ENDED, no winner);
    // the subsequent transaction read must then see status !== 'ACTIVE'.
    prisma.auction.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      service.placeBid('auction-1', 'bidder-1', { amount: 100_000, requestKey: 'req-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid first bid at exactly the starting price and updates currentPrice atomically', async () => {
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    prisma.auction.updateMany.mockResolvedValue({ count: 1 });
    prisma.auctionBid.create.mockResolvedValue({
      id: 'bid-1',
      auctionId: 'auction-1',
      bidderId: 'bidder-1',
      amount: decimal(100_000),
      requestKey: 'req-1',
      createdAt: new Date(),
    });
    prisma.pin.findUnique.mockResolvedValue({ title: 'Tranh sơn dầu' });
    prisma.user.findUnique.mockResolvedValue({ username: 'bidder-name' });

    await service.placeBid('auction-1', 'bidder-1', { amount: 100_000, requestKey: 'req-1' });

    expect(prisma.auction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'auction-1',
          status: 'ACTIVE',
          currentPrice: activeAuction.currentPrice,
          bidCount: activeAuction.bidCount,
        },
        data: { currentPrice: 100_000, bidCount: { increment: 1 } },
      }),
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      'seller-1',
      'AUCTION_NEW_BID',
      expect.any(String),
      'bidder-1',
      'pin-1',
    );
  });

  it('rejects (optimistic-lock conflict) when currentPrice changed between read and update — the losing side of a concurrent bid race', async () => {
    memberships.status.mockResolvedValue({ plan: 'PRO' });
    // Another request already bumped currentPrice in the DB by the time this
    // updateMany runs — its WHERE clause (matching the stale currentPrice) no
    // longer matches any row, so count is 0.
    prisma.auction.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.placeBid('auction-1', 'bidder-1', { amount: 100_000, requestKey: 'req-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('replays an already-processed requestKey instead of creating a duplicate bid (double-click / retry safety)', async () => {
    const existing = {
      id: 'bid-existing',
      auctionId: 'auction-1',
      bidderId: 'bidder-1',
      amount: decimal(100_000),
      requestKey: 'req-1',
      createdAt: new Date(),
    };
    prisma.auctionBid.findUnique.mockResolvedValue(existing);

    await service.placeBid('auction-1', 'bidder-1', { amount: 100_000, requestKey: 'req-1' });

    expect(prisma.auction.updateMany).not.toHaveBeenCalled();
    expect(prisma.auctionBid.create).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});
