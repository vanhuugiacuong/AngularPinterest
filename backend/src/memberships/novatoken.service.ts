import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NovaTokenEntryType, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

export const NOVATOKEN_VND_RATE = 1;
export const NOVATOKEN_PACKAGES = [
  10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
] as const;
// Cắt từ mỗi giao dịch bán (giá cố định lẫn đấu giá) cho tài khoản nền
// tảng - phần còn lại mới là doanh thu thực nhận của người bán. Tài khoản
// nhận được cấu hình qua PLATFORM_TREASURY_USER_ID (xem backend/.env).
export const PLATFORM_FEE_PERCENT = 30;
// Loại ledger được tính là "doanh thu" có thể rút thử - doanh thu bán hàng
// của người bán VÀ phần phí nền tảng tích lũy vào tài khoản treasury.
const EARNINGS_ENTRY_TYPES: NovaTokenEntryType[] = [
  'FIXED_SALE',
  'AUCTION_SALE',
  'PLATFORM_FEE',
];

type Tx = Prisma.TransactionClient;

@Injectable()
export class NovaTokenService {
  constructor(private readonly prisma: PrismaService) {}

  static fromVnd(value: Prisma.Decimal | number | string): number {
    return Math.max(1, Math.ceil(Number(value) / NOVATOKEN_VND_RATE));
  }

  async getWallet(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        novaTokenBalance: true,
        payoutBankCode: true,
        payoutAccountNumber: true,
        payoutAccountName: true,
      },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    const [entries, topUps, withdrawals, saleCredits] = await Promise.all([
      this.prisma.novaTokenLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.novaTokenTopUp.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.demoWithdrawal.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.novaTokenLedger.aggregate({
        where: { userId, type: { in: EARNINGS_ENTRY_TYPES } },
        _sum: { amount: true },
      }),
    ]);
    const withdrawn = withdrawals.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    const withdrawableBalance = Math.max(
      0,
      Math.min(
        Number(user.novaTokenBalance),
        Number(saleCredits._sum.amount ?? 0) - withdrawn,
      ),
    );
    return {
      balance: user.novaTokenBalance.toString(),
      rateVnd: NOVATOKEN_VND_RATE,
      packages: NOVATOKEN_PACKAGES.map((tokens) => ({
        tokens,
        vndAmount: tokens,
      })),
      entries: entries.map((entry) => ({
        ...entry,
        amount: entry.amount.toString(),
        balanceAfter: entry.balanceAfter.toString(),
      })),
      topUps: topUps.map((topUp) => ({
        ...topUp,
        tokenAmount: topUp.tokenAmount.toString(),
        vndAmount: topUp.vndAmount.toString(),
      })),
      withdrawableBalance: String(withdrawableBalance),
      payoutAccount:
        user.payoutBankCode &&
        user.payoutAccountNumber &&
        user.payoutAccountName
          ? {
              bankCode: user.payoutBankCode,
              accountNumber: user.payoutAccountNumber,
              accountName: user.payoutAccountName,
            }
          : null,
      withdrawals: withdrawals.map((item) => ({
        ...item,
        amount: item.amount.toString(),
      })),
    };
  }

  async createDemoWithdrawal(userId: string, rawAmount: unknown) {
    const amount = Number(rawAmount);
    if (!Number.isSafeInteger(amount) || amount < 10_000) {
      throw new BadRequestException('Số tiền rút thử tối thiểu là 10.000đ.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            novaTokenBalance: true,
            payoutBankCode: true,
            payoutAccountNumber: true,
            payoutAccountName: true,
          },
        });
        if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
        if (
          !user.payoutBankCode ||
          !user.payoutAccountNumber ||
          !user.payoutAccountName
        ) {
          throw new BadRequestException(
            'Vui lòng cấu hình tài khoản nhận tiền trong Cài đặt trước.',
          );
        }
        const [saleCredits, previousWithdrawals] = await Promise.all([
          tx.novaTokenLedger.aggregate({
            where: { userId, type: { in: EARNINGS_ENTRY_TYPES } },
            _sum: { amount: true },
          }),
          tx.demoWithdrawal.aggregate({
            where: { userId },
            _sum: { amount: true },
          }),
        ]);
        const earningsAvailable = Math.max(
          0,
          Number(saleCredits._sum.amount ?? 0) -
            Number(previousWithdrawals._sum.amount ?? 0),
        );
        const available = Math.min(
          Number(user.novaTokenBalance),
          earningsAvailable,
        );
        if (amount > available) {
          throw new BadRequestException(
            `Doanh thu có thể rút thử hiện là ${available.toLocaleString('vi-VN')}đ.`,
          );
        }
        const debited = await tx.user.updateMany({
          where: { id: userId, novaTokenBalance: { gte: amount } },
          data: { novaTokenBalance: { decrement: amount } },
        });
        if (debited.count === 0)
          throw new ConflictException('Số dư vừa thay đổi, vui lòng thử lại.');
        const after = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { novaTokenBalance: true },
        });
        const withdrawal = await tx.demoWithdrawal.create({
          data: {
            userId,
            amount,
            bankCode: user.payoutBankCode,
            accountNumber: user.payoutAccountNumber,
            accountName: user.payoutAccountName,
          },
        });
        await this.addLedger(
          tx,
          userId,
          'ADMIN_ADJUSTMENT',
          -amount,
          after.novaTokenBalance,
          `demo-withdrawal:${withdrawal.id}`,
          `Rút tiền mô phỏng ${amount.toLocaleString('vi-VN')}đ`,
          { withdrawalId: withdrawal.id, demoOnly: true },
        );
        return { ...withdrawal, amount: withdrawal.amount.toString() };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createTopUp(userId: string, rawTokens: unknown) {
    const tokens = Number(rawTokens);
    if (
      !NOVATOKEN_PACKAGES.includes(
        tokens as (typeof NOVATOKEN_PACKAGES)[number],
      )
    ) {
      throw new BadRequestException(
        'Số tiền nạp phải từ 10.000đ đến 500.000đ.',
      );
    }
    const validSince = new Date(Date.now() - 5 * 60_000);
    await this.prisma.novaTokenTopUp.updateMany({
      where: { userId, status: 'PENDING', createdAt: { lt: validSince } },
      data: { status: 'EXPIRED' },
    });
    const existing = await this.prisma.novaTokenTopUp.findFirst({
      where: {
        userId,
        tokenAmount: tokens,
        status: 'PENDING',
        createdAt: { gte: validSince },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.serializeTopUp(existing);
    const paymentReference = `NAP${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
    return this.serializeTopUp(
      await this.prisma.novaTokenTopUp.create({
        data: {
          userId,
          tokenAmount: tokens,
          vndAmount: tokens,
          paymentReference,
        },
      }),
    );
  }

  async getTopUp(userId: string, id: string) {
    let topUp = await this.prisma.novaTokenTopUp.findUnique({ where: { id } });
    if (!topUp || topUp.userId !== userId)
      throw new NotFoundException('Không tìm thấy giao dịch nạp tiền.');
    if (topUp.status === 'PENDING') {
      await this.reconcileTopUpWithSepay(topUp);
      topUp = await this.prisma.novaTokenTopUp.findUnique({ where: { id } });
      if (!topUp)
        throw new NotFoundException('Không tìm thấy giao dịch nạp tiền.');
    }
    return this.serializeTopUp(topUp);
  }

  private async reconcileTopUpWithSepay(topUp: {
    id: string;
    paymentReference: string;
    vndAmount: Prisma.Decimal;
    createdAt: Date;
  }): Promise<void> {
    const apiToken = process.env.SEPAY_API_TOKEN;
    if (!apiToken) return;

    const amount = Number(topUp.vndAmount);
    const params = new URLSearchParams({
      q: topUp.paymentReference,
      transfer_type: 'in',
      amount_in_min: String(amount),
      amount_in_max: String(amount),
      transaction_date_from: new Date(
        topUp.createdAt.getTime() - 5 * 60_000,
      ).toISOString(),
      per_page: '20',
      timestamp_format: 'iso8601',
    });
    try {
      const response = await fetch(
        `https://userapi.sepay.vn/v2/transactions?${params}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
      };
      const reference = topUp.paymentReference.toUpperCase();
      const transaction = payload.data?.find((item) => {
        const content = String(item.transaction_content ?? '').toUpperCase();
        return (
          item.transfer_type === 'in' &&
          Number(item.amount_in) === amount &&
          content.includes(reference)
        );
      });
      if (!transaction?.id) return;
      await this.confirmTopUp(topUp.id, {
        providerTransactionId: String(transaction.id),
        rawPayload: transaction,
        verifiedBy: 'sepay-api',
      });
    } catch {
      // SePay tạm thời không phản hồi: giữ giao dịch PENDING để lần poll kế tiếp thử lại.
    }
  }

  async confirmTopUp(
    topUpId: string,
    details: {
      providerTransactionId?: string;
      rawPayload?: unknown;
      verifiedBy?: string;
    },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const topUp = await tx.novaTokenTopUp.findUnique({
          where: { id: topUpId },
        });
        if (!topUp)
          throw new NotFoundException('Không tìm thấy giao dịch nạp tiền.');
        if (topUp.status === 'PAID')
          return { ok: true as const, duplicate: true as const };
        if (topUp.status !== 'PENDING')
          throw new ConflictException('Giao dịch nạp không còn chờ xác nhận.');
        const claimed = await tx.novaTokenTopUp.updateMany({
          where: { id: topUp.id, status: 'PENDING' },
          data: {
            status: 'PAID',
            verifiedAt: new Date(),
            verifiedBy: details.verifiedBy,
            providerTransactionId: details.providerTransactionId,
            rawPayload: details.rawPayload as Prisma.InputJsonValue | undefined,
          },
        });
        if (claimed.count === 0)
          return { ok: true as const, duplicate: true as const };
        const user = await tx.user.update({
          where: { id: topUp.userId },
          data: { novaTokenBalance: { increment: topUp.tokenAmount } },
          select: { novaTokenBalance: true },
        });
        await this.addLedger(
          tx,
          topUp.userId,
          'TOP_UP',
          topUp.tokenAmount,
          user.novaTokenBalance,
          `topup:${topUp.id}`,
          `Nạp ${Number(topUp.tokenAmount).toLocaleString('vi-VN')}đ`,
          { topUpId: topUp.id },
        );
        return { ok: true as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async purchaseFixedPin(userId: string, pinId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const pin = await tx.pin.findUnique({ where: { id: pinId } });
        if (!pin) throw new NotFoundException('Không tìm thấy tác phẩm.');
        if (pin.userId === userId)
          throw new BadRequestException(
            'Bạn không thể mua tác phẩm của chính mình.',
          );
        if (!pin.isForSale || !pin.price)
          throw new BadRequestException(
            'Tác phẩm này không được bán với giá cố định.',
          );
        const activeAuction = await tx.auction.findFirst({
          where: { pinId, status: { in: ['DRAFT', 'SCHEDULED', 'ACTIVE'] } },
          select: { id: true },
        });
        if (activeAuction)
          throw new BadRequestException('Tác phẩm này đang được đấu giá.');
        const [buyer, seller] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            select: { plan: true, planExpiresAt: true, isAdmin: true },
          }),
          tx.user.findUnique({
            where: { id: pin.userId },
            select: { plan: true, planExpiresAt: true, isAdmin: true },
          }),
        ]);
        // Admin luôn được coi như có gói Plus/Pro còn hiệu lực - toàn quyền
        // mua/bán, không phụ thuộc gói thực tế.
        const hasSellingPlan = (user: typeof buyer) =>
          !!user &&
          (user.isAdmin ||
            ((user.plan === 'PLUS' || user.plan === 'PRO') &&
              (!user.planExpiresAt || user.planExpiresAt.getTime() > Date.now())));
        if (!hasSellingPlan(buyer))
          throw new ForbiddenException(
            'Cần gói Plus hoặc Pro còn hiệu lực để mua tác phẩm.',
          );
        if (!hasSellingPlan(seller))
          throw new ForbiddenException(
            'Gói của người bán đã hết hạn nên tác phẩm đang tạm dừng giao dịch.',
          );
        const existing = await tx.imagePurchase.findUnique({
          where: { pinId_buyerId: { pinId, buyerId: userId } },
        });
        if (existing?.status === 'PAID')
          return this.serializePurchase(existing);
        const tokens = NovaTokenService.fromVnd(pin.price);
        const { sellerAmount, platformFee, treasuryUserId } = this.splitSaleRevenue(
          tokens,
          pin.userId,
        );
        const debited = await tx.user.updateMany({
          where: { id: userId, novaTokenBalance: { gte: tokens } },
          data: { novaTokenBalance: { decrement: tokens } },
        });
        if (debited.count === 0)
          throw new ForbiddenException(
            `Số dư không đủ. Bạn cần ${tokens.toLocaleString('vi-VN')}đ.`,
          );
        const [buyerAfter, sellerAfter, treasuryAfter] = await Promise.all([
          tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { novaTokenBalance: true },
          }),
          tx.user.update({
            where: { id: pin.userId },
            data: { novaTokenBalance: { increment: sellerAmount } },
            select: { novaTokenBalance: true },
          }),
          treasuryUserId
            ? tx.user.update({
                where: { id: treasuryUserId },
                data: { novaTokenBalance: { increment: platformFee } },
                select: { novaTokenBalance: true },
              })
            : Promise.resolve(null),
        ]);
        const purchase = existing
          ? await tx.imagePurchase.update({
              where: { id: existing.id },
              data: {
                amount: tokens,
                currency: 'VND',
                status: 'PAID',
                paymentReference: null,
                verifiedAt: new Date(),
              },
            })
          : await tx.imagePurchase.create({
              data: {
                pinId,
                buyerId: userId,
                sellerId: pin.userId,
                amount: tokens,
                currency: 'VND',
                status: 'PAID',
                verifiedAt: new Date(),
              },
            });
        const ledgerWrites = [
          this.addLedger(
            tx,
            userId,
            'FIXED_PURCHASE',
            -tokens,
            buyerAfter.novaTokenBalance,
            `purchase:${purchase.id}:buyer`,
            `Mua tác phẩm “${pin.title}”`,
            { pinId, purchaseId: purchase.id },
          ),
          this.addLedger(
            tx,
            pin.userId,
            'FIXED_SALE',
            sellerAmount,
            sellerAfter.novaTokenBalance,
            `purchase:${purchase.id}:seller`,
            `Bán tác phẩm “${pin.title}”`,
            { pinId, purchaseId: purchase.id, totalAmount: tokens, platformFee },
          ),
        ];
        if (treasuryUserId && treasuryAfter) {
          ledgerWrites.push(
            this.addLedger(
              tx,
              treasuryUserId,
              'PLATFORM_FEE',
              platformFee,
              treasuryAfter.novaTokenBalance,
              `purchase:${purchase.id}:platform-fee`,
              `Phí nền tảng ${PLATFORM_FEE_PERCENT}% từ “${pin.title}”`,
              { pinId, purchaseId: purchase.id, sellerId: pin.userId },
            ),
          );
        }
        await Promise.all(ledgerWrites);
        return this.serializePurchase(purchase);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reserveBid(
    tx: Tx,
    auctionId: string,
    bidderId: string,
    amountVnd: Prisma.Decimal,
    requestKey: string,
    previousTopBidderId: string | null,
  ) {
    const tokens = NovaTokenService.fromVnd(amountVnd);
    const existingHold = await tx.auctionTokenHold.findUnique({
      where: { auctionId_bidderId: { auctionId, bidderId } },
    });
    const current = existingHold ? Number(existingHold.amount) : 0;
    const delta = tokens - current;
    if (delta > 0) {
      const debited = await tx.user.updateMany({
        where: { id: bidderId, novaTokenBalance: { gte: delta } },
        data: { novaTokenBalance: { decrement: delta } },
      });
      if (debited.count === 0)
        throw new ForbiddenException(
          `Số dư không đủ để giữ chỗ ${tokens.toLocaleString('vi-VN')}đ.`,
        );
      const after = await tx.user.findUniqueOrThrow({
        where: { id: bidderId },
        select: { novaTokenBalance: true },
      });
      await this.addLedger(
        tx,
        bidderId,
        'BID_HOLD',
        -delta,
        after.novaTokenBalance,
        `bid:${requestKey}:hold`,
        `Giữ chỗ cho lượt đấu giá`,
        { auctionId, tokens },
      );
    }
    await tx.auctionTokenHold.upsert({
      where: { auctionId_bidderId: { auctionId, bidderId } },
      create: { auctionId, bidderId, amount: tokens },
      update: { amount: tokens },
    });
    if (previousTopBidderId && previousTopBidderId !== bidderId)
      await this.releaseHold(
        tx,
        auctionId,
        previousTopBidderId,
        `bid:${requestKey}:release`,
      );
    return tokens;
  }

  async settleAuction(
    tx: Tx,
    auction: { id: string; sellerId: string; pinId: string },
    winnerId: string | null,
    title: string,
  ) {
    const holds = await tx.auctionTokenHold.findMany({
      where: { auctionId: auction.id },
    });
    for (const hold of holds) {
      if (!winnerId || hold.bidderId !== winnerId)
        await this.releaseHold(
          tx,
          auction.id,
          hold.bidderId,
          `auction:${auction.id}:refund:${hold.bidderId}`,
        );
    }
    if (!winnerId) return null;
    const winnerHold = await tx.auctionTokenHold.findUnique({
      where: {
        auctionId_bidderId: { auctionId: auction.id, bidderId: winnerId },
      },
    });
    if (!winnerHold)
      throw new ConflictException(
        'Không tìm thấy số tiền đã giữ chỗ của người thắng.',
      );
    const totalAmount = Number(winnerHold.amount);
    const { sellerAmount, platformFee, treasuryUserId } = this.splitSaleRevenue(
      totalAmount,
      auction.sellerId,
    );
    const seller = await tx.user.update({
      where: { id: auction.sellerId },
      data: { novaTokenBalance: { increment: sellerAmount } },
      select: { novaTokenBalance: true },
    });
    await this.addLedger(
      tx,
      auction.sellerId,
      'AUCTION_SALE',
      sellerAmount,
      seller.novaTokenBalance,
      `auction:${auction.id}:sale`,
      `Đấu giá thành công “${title}”`,
      { auctionId: auction.id, pinId: auction.pinId, winnerId, totalAmount, platformFee },
    );
    if (treasuryUserId) {
      const treasury = await tx.user.update({
        where: { id: treasuryUserId },
        data: { novaTokenBalance: { increment: platformFee } },
        select: { novaTokenBalance: true },
      });
      await this.addLedger(
        tx,
        treasuryUserId,
        'PLATFORM_FEE',
        platformFee,
        treasury.novaTokenBalance,
        `auction:${auction.id}:platform-fee`,
        `Phí nền tảng ${PLATFORM_FEE_PERCENT}% từ đấu giá “${title}”`,
        { auctionId: auction.id, pinId: auction.pinId, sellerId: auction.sellerId },
      );
    }
    await tx.auctionTokenHold.delete({ where: { id: winnerHold.id } });
    return totalAmount;
  }

  private async releaseHold(
    tx: Tx,
    auctionId: string,
    bidderId: string,
    referenceKey: string,
  ) {
    const hold = await tx.auctionTokenHold.findUnique({
      where: { auctionId_bidderId: { auctionId, bidderId } },
    });
    if (!hold) return;
    await tx.auctionTokenHold.delete({ where: { id: hold.id } });
    const user = await tx.user.update({
      where: { id: bidderId },
      data: { novaTokenBalance: { increment: hold.amount } },
      select: { novaTokenBalance: true },
    });
    await this.addLedger(
      tx,
      bidderId,
      'BID_RELEASE',
      hold.amount,
      user.novaTokenBalance,
      referenceKey,
      'Hoàn tiền do bị vượt giá',
      { auctionId },
    );
  }

  /** Chia một khoản bán hàng giữa người bán và tài khoản nền tảng theo
   * PLATFORM_FEE_PERCENT. Không cắt phí nếu chưa cấu hình treasury, hoặc
   * nếu chính treasury là người bán (tự bán cho mình thì không có gì để cắt). */
  private splitSaleRevenue(
    totalAmount: number,
    sellerId: string,
  ): { sellerAmount: number; platformFee: number; treasuryUserId: string | null } {
    const treasuryUserId = process.env.PLATFORM_TREASURY_USER_ID || null;
    if (!treasuryUserId || treasuryUserId === sellerId) {
      return { sellerAmount: totalAmount, platformFee: 0, treasuryUserId: null };
    }
    const platformFee = Math.round((totalAmount * PLATFORM_FEE_PERCENT) / 100);
    return { sellerAmount: totalAmount - platformFee, platformFee, treasuryUserId };
  }

  private addLedger(
    tx: Tx,
    userId: string,
    type: NovaTokenEntryType,
    amount: Prisma.Decimal | number,
    balanceAfter: Prisma.Decimal,
    referenceKey: string,
    description: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return tx.novaTokenLedger.create({
      data: {
        userId,
        type,
        amount,
        balanceAfter,
        referenceKey,
        description,
        metadata,
      },
    });
  }

  private serializeTopUp(topUp: {
    tokenAmount: Prisma.Decimal;
    vndAmount: Prisma.Decimal;
    [key: string]: unknown;
  }) {
    return {
      ...topUp,
      tokenAmount: topUp.tokenAmount.toString(),
      vndAmount: topUp.vndAmount.toString(),
    };
  }

  private serializePurchase(purchase: {
    amount: Prisma.Decimal;
    [key: string]: unknown;
  }) {
    return { ...purchase, amount: purchase.amount.toString() };
  }
}
