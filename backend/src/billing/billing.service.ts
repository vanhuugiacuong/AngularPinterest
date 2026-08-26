import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import {
  CREDIT_PACKS,
  PLANS,
  PLATFORM_FEE_PERCENT,
  QR_EXPIRE_MS,
  buildQrUrl,
  findPack,
  findPlan,
  getBank,
  getSepayApiToken,
} from './billing.config';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Cấu hình công khai ───────────────────────────────────────────────────────
  getPlansConfig() {
    return {
      plans: PLANS,
      creditPacks: CREDIT_PACKS,
      bank: (() => { const b = getBank(); return { shortName: b.shortName, accountName: b.accountName, accountNo: b.accountNo }; })(),
    };
  }

  // ── Trạng thái tài khoản + ví ────────────────────────────────────────────────
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    const wallet = await this.ensureWallet(userId);

    // Pro hết hạn thì coi như Free (không auto-renew ở bản này).
    const isPro = !!user.proExpiresAt && user.proExpiresAt.getTime() > Date.now();

    return {
      isPro,
      proExpiresAt: user.proExpiresAt,
      spendable: wallet.spendable,
      earnings: wallet.earnings,
      grantExpiresAt: wallet.grantExpiresAt,
    };
  }

  async getTransactions(userId: string) {
    return this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Tạo đơn thanh toán (QR) ──────────────────────────────────────────────────
  async createSubscription(userId: string, plan: string) {
    const p = findPlan(plan);
    if (!p) throw new BadRequestException('Gói không hợp lệ.');
    return this.createPayment(userId, {
      purpose: 'PRO_SUB',
      amountVnd: p.priceVnd,
      planCode: p.code,
      creditsGranted: p.grantCredits,
    });
  }

  async createCreditPurchase(userId: string, packCode: string) {
    const pack = findPack(packCode);
    if (!pack) throw new BadRequestException('Gói credit không hợp lệ.');
    return this.createPayment(userId, {
      purpose: 'CREDIT_PACK',
      amountVnd: pack.priceVnd,
      packCode: pack.code,
      creditsGranted: pack.credits,
    });
  }

  private async createPayment(
    userId: string,
    data: {
      purpose: 'PRO_SUB' | 'CREDIT_PACK';
      amountVnd: number;
      planCode?: string;
      packCode?: string;
      creditsGranted: number;
    },
  ) {
    const memo = await this.uniqueMemo();
    const expiresAt = new Date(Date.now() + QR_EXPIRE_MS);
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        provider: 'VIETQR',
        purpose: data.purpose,
        amountVnd: data.amountVnd,
        planCode: data.planCode,
        packCode: data.packCode,
        creditsGranted: data.creditsGranted,
        memo,
        expiresAt,
      },
    });

    return {
      ref: payment.id,
      memo: payment.memo,
      amountVnd: payment.amountVnd,
      qrUrl: buildQrUrl(payment.amountVnd, payment.memo),
      bank: (() => { const b = getBank(); return { shortName: b.shortName, accountName: b.accountName, accountNo: b.accountNo }; })(),
      expiresAt: payment.expiresAt,
    };
  }

  /** Nội dung CK định danh, chỉ chữ+số. Bảo đảm duy nhất (cột memo là @unique). */
  private async uniqueMemo(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const candidate = 'PINHUB' + randomBytes(5).toString('hex').toUpperCase();
      const existing = await this.prisma.payment.findUnique({ where: { memo: candidate } });
      if (!existing) return candidate;
    }
    // Cực hiếm khi tới đây; dùng timestamp để chắc chắn khác biệt.
    return 'PINHUB' + Date.now().toString(36).toUpperCase();
  }

  // ── Dò trạng thái (frontend polling) ─────────────────────────────────────────
  async getPaymentStatus(userId: string, ref: string) {
    let payment = await this.prisma.payment.findUnique({ where: { id: ref } });
    if (!payment || payment.userId !== userId) throw new NotFoundException('Không tìm thấy đơn.');

    // Còn chờ + có token SePay -> đối soát ngay để trả kết quả gần như tức thì.
    if (payment.status === 'PENDING' && payment.expiresAt.getTime() >= Date.now() && getSepayApiToken()) {
      const settled = await this.reconcileOneViaSepay(payment).catch(() => false);
      if (settled) payment = await this.prisma.payment.findUnique({ where: { id: ref } });
    }

    if (payment!.status === 'PENDING' && payment!.expiresAt.getTime() < Date.now()) {
      await this.prisma.payment.update({ where: { id: ref }, data: { status: 'EXPIRED' } });
      return { status: 'EXPIRED' as const };
    }
    return { status: payment!.status };
  }

  // ── Đối soát tự động qua API SePay (không cần webhook công khai) ──────────────
  /** Poll tất cả đơn đang chờ. Trả về số đơn vừa được ghi nhận đã trả. */
  async reconcilePendingViaSepay(): Promise<number> {
    if (!getSepayApiToken()) return 0;
    const pending = await this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    let n = 0;
    for (const p of pending) {
      try {
        if (await this.reconcileOneViaSepay(p)) n++;
      } catch (e) {
        // Lỗi mạng/timeout SePay -> bỏ qua, lần sau thử lại.
      }
    }
    return n;
  }

  /** Hỏi SePay xem đã có giao dịch tiền vào khớp memo + số tiền chưa; có thì markPaid. */
  private async reconcileOneViaSepay(payment: {
    id: string;
    memo: string;
    amountVnd: number;
    createdAt: Date;
  }): Promise<boolean> {
    const token = getSepayApiToken();
    if (!token) return false;

    const params = new URLSearchParams({
      transfer_type: 'in',
      amount_in_min: String(payment.amountVnd),
      transaction_date_from: new Date(payment.createdAt.getTime() - 5 * 60_000).toISOString(),
      per_page: '30',
      timestamp_format: 'iso8601',
    });

    const res = await fetch(`https://userapi.sepay.vn/v2/transactions?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;

    const payload = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const memo = payment.memo.toUpperCase();
    const tx = payload.data?.find(
      (item) =>
        item.transfer_type === 'in' &&
        Number(item.amount_in) >= payment.amountVnd &&
        String(item.transaction_content ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(memo),
    );
    if (!tx?.id) return false;

    await this.markPaid(payment.id, String(tx.id));
    return true;
  }

  async cancelPayment(userId: string, ref: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: ref } });
    if (!payment || payment.userId !== userId) throw new NotFoundException('Không tìm thấy đơn.');
    if (payment.status === 'PENDING') {
      await this.prisma.payment.update({ where: { id: ref }, data: { status: 'FAILED' } });
    }
    return { status: 'FAILED' as const };
  }

  // ── Webhook đối soát tự động (SePay/PayOS) ───────────────────────────────────
  /**
   * Xử lý một giao dịch tiền-vào: tìm đơn PENDING theo nội dung CK, đối chiếu số
   * tiền rồi ghi nhận đã trả. An toàn với gọi lặp (idempotent).
   */
  async settleIncomingTransfer(content: string, amountVnd: number, gatewayRef?: string) {
    const norm = (content || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!norm.includes('PINHUB')) return { matched: false, reason: 'no_memo' };

    // Lấy các đơn đang chờ còn hạn, tìm đơn có memo nằm trong nội dung CK.
    const pending = await this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const payment = pending.find((p) => norm.includes(p.memo));
    if (!payment) return { matched: false, reason: 'no_matching_payment' };

    if (amountVnd < payment.amountVnd) {
      return { matched: false, reason: 'amount_too_low', expected: payment.amountVnd, got: amountVnd };
    }

    await this.markPaid(payment.id, gatewayRef);
    return { matched: true, paymentId: payment.id };
  }

  /** Ghi nhận đơn đã trả + áp quyền lợi, trong 1 transaction, idempotent. */
  async markPaid(paymentId: string, gatewayRef?: string) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Không tìm thấy đơn.');
      if (payment.status === 'PAID') return; // idempotent

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID', paidAt: new Date(), gatewayRef: gatewayRef ?? payment.gatewayRef },
      });

      await this.ensureWalletTx(tx, payment.userId);

      if (payment.purpose === 'PRO_SUB') {
        const plan = findPlan(payment.planCode ?? undefined);
        const months = plan?.months ?? 1;
        const user = await tx.user.findUnique({ where: { id: payment.userId } });
        const now = Date.now();
        const base =
          user?.proExpiresAt && user.proExpiresAt.getTime() > now ? user.proExpiresAt.getTime() : now;
        const expires = new Date(base + months * 30 * 24 * 3600 * 1000);

        await tx.user.update({
          where: { id: payment.userId },
          data: { isPro: true, proExpiresAt: expires },
        });
        await tx.subscription.create({
          data: {
            userId: payment.userId,
            plan: payment.planCode as any,
            expiresAt: expires,
            paymentId: payment.id,
          },
        });

        const grant = payment.creditsGranted ?? 0;
        if (grant > 0) {
          await this.addCreditsTx(tx, payment.userId, grant, 'MONTHLY_GRANT', 'Credit tặng kèm Pro', {
            refPaymentId: payment.id,
            grantExpiresAt: expires,
          });
        }
      } else {
        const credits = payment.creditsGranted ?? 0;
        await this.addCreditsTx(tx, payment.userId, credits, 'PURCHASE', `Mua ${credits} credit`, {
          refPaymentId: payment.id,
        });
      }
    });
  }

  // ── Mua quyền tải ảnh Premium (trả credit) ───────────────────────────────────
  async purchasePin(userId: string, pinId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');
    if (!pin.isPremium || !pin.priceCredits) throw new BadRequestException('Ảnh này không phải Premium.');
    if (pin.userId === userId) throw new BadRequestException('Bạn là chủ ảnh, không cần mua.');

    const existing = await this.prisma.pinEntitlement.findUnique({
      where: { userId_pinId: { userId, pinId } },
    });
    if (existing) return { alreadyOwned: true };

    const price = pin.priceCredits;

    await this.prisma.$transaction(async (tx) => {
      const wallet = await this.ensureWalletTx(tx, userId);
      if (wallet.spendable < price) throw new ForbiddenException('Bạn không đủ credit.');

      // Trừ credit người mua
      await this.addCreditsTx(tx, userId, -price, 'SPEND_DOWNLOAD', `Tải HD ảnh Premium`, {
        refPinId: pinId,
      });

      // Chia doanh thu cho creator (earnings) + phí nền tảng
      const fee = Math.round((price * PLATFORM_FEE_PERCENT) / 100);
      const creatorGain = price - fee;
      await this.ensureWalletTx(tx, pin.userId);
      await tx.wallet.update({
        where: { userId: pin.userId },
        data: { earnings: { increment: creatorGain } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: pin.userId,
          type: 'EARN_SALE',
          amount: creatorGain,
          balanceAfter: 0, // earnings ledger — balanceAfter không dùng cho ví earnings
          refPinId: pinId,
          note: 'Bán ảnh Premium',
        },
      });

      await tx.pinEntitlement.create({ data: { userId, pinId, creditsPaid: price } });
    });

    return { alreadyOwned: false, pricePaid: price };
  }

  async getPinAccess(userId: string | undefined, pinId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');
    const owned = !!userId && pin.userId === userId;
    let purchased = false;
    if (userId && !owned) {
      const ent = await this.prisma.pinEntitlement.findUnique({
        where: { userId_pinId: { userId, pinId } },
      });
      purchased = !!ent;
    }
    return {
      isPremium: pin.isPremium,
      priceCredits: pin.priceCredits,
      owned,
      purchased,
      canDownload: owned || purchased,
    };
  }

  // ── Ví: tiện ích ─────────────────────────────────────────────────────────────
  private async ensureWallet(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private async ensureWalletTx(tx: any, userId: string) {
    return tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  private async addCreditsTx(
    tx: any,
    userId: string,
    amount: number,
    type: string,
    note: string,
    opts?: { refPinId?: string; refPaymentId?: string; grantExpiresAt?: Date },
  ) {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const balanceAfter = (wallet?.spendable ?? 0) + amount;
    await tx.wallet.update({
      where: { userId },
      data: {
        spendable: balanceAfter,
        ...(opts?.grantExpiresAt ? { grantExpiresAt: opts.grantExpiresAt } : {}),
      },
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        type: type as any,
        amount,
        balanceAfter,
        refPinId: opts?.refPinId,
        refPaymentId: opts?.refPaymentId,
        note,
      },
    });
  }
}
