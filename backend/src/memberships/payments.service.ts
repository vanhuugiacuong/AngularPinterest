import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { MembershipPlan, PaymentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { PLAN_PRICE_VND, SUBSCRIPTION_DURATION_MS } from './entitlements';
import { MembershipsService } from './memberships.service';
import { writeAuditLog } from './audit.util';
import { NotificationsService } from '../notifications/notifications.service';
import { NovaTokenService } from './novatoken.service';

interface SepayWebhookPayload {
  id?: string | number;
  referenceCode?: string;
  content?: string;
  description?: string;
  transferAmount?: number | string;
  amount?: number | string;
  transferType?: string;
  type?: string;
  [key: string]: unknown;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly notifications: NotificationsService,
    private readonly novaTokens: NovaTokenService,
  ) {}

  private generatePaymentReference(): string {
    return `NOVA${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  async createPayment(userId: string, plan: MembershipPlan) {
    if (plan === 'FREE') {
      throw new BadRequestException('Gói FREE không cần thanh toán.');
    }
    if (!Object.values(MembershipPlan).includes(plan)) {
      throw new BadRequestException('Gói thành viên không hợp lệ.');
    }

    const validSince = new Date(Date.now() - 5 * 60_000);
    await this.prisma.membershipPayment.updateMany({
      where: { userId, plan, status: 'PENDING', createdAt: { lt: validSince } },
      data: { status: 'EXPIRED' },
    });
    const existingPending = await this.prisma.membershipPayment.findFirst({
      where: {
        userId,
        plan,
        status: 'PENDING',
        createdAt: { gte: validSince },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending) return existingPending;

    const amount = PLAN_PRICE_VND[plan];
    const paymentReference = this.generatePaymentReference();
    const payment = await this.prisma.membershipPayment.create({
      data: {
        userId,
        plan,
        amount,
        paymentReference,
        provider: 'sepay',
        status: 'PENDING',
      },
    });
    await writeAuditLog(this.prisma, userId, 'PAYMENT_CREATED', {
      paymentId: payment.id,
      plan,
      amount,
    });
    return payment;
  }

  async getPayment(userId: string, paymentId: string) {
    let payment = await this.prisma.membershipPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.userId !== userId)
      throw new NotFoundException('Không tìm thấy giao dịch.');
    if (payment.status === 'PENDING') {
      await this.reconcileMembershipPaymentWithSepay(payment);
      payment = await this.prisma.membershipPayment.findUnique({
        where: { id: paymentId },
      });
      if (!payment) throw new NotFoundException('Không tìm thấy giao dịch.');
    }
    return payment;
  }

  private async reconcileMembershipPaymentWithSepay(payment: {
    id: string;
    paymentReference: string;
    amount: Prisma.Decimal;
    createdAt: Date;
  }): Promise<void> {
    const apiToken = process.env.SEPAY_API_TOKEN;
    if (!apiToken) return;
    const amount = Number(payment.amount);
    const params = new URLSearchParams({
      q: payment.paymentReference,
      transfer_type: 'in',
      amount_in_min: String(amount),
      amount_in_max: String(amount),
      transaction_date_from: new Date(
        payment.createdAt.getTime() - 5 * 60_000,
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
      const reference = payment.paymentReference.toUpperCase();
      const transaction = payload.data?.find(
        (item) =>
          item.transfer_type === 'in' &&
          Number(item.amount_in) === amount &&
          String(item.transaction_content ?? '')
            .toUpperCase()
            .includes(reference),
      );
      if (!transaction?.id) return;
      await this.markPaidAndActivate(payment.id, {
        providerTransactionId: String(transaction.id),
        rawPayload: transaction,
        verifiedBy: 'sepay-api',
      });
    } catch {
      // Giữ PENDING khi SePay tạm thời không phản hồi; lần poll tiếp theo sẽ thử lại.
    }
  }

  async listPayments(userId: string) {
    return this.prisma.membershipPayment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Chuyển 1 payment PENDING -> PAID và kích hoạt gói. Dùng updateMany có
  // điều kiện status=PENDING để nguyên tử - 2 lệnh gọi trùng lặp (webhook lặp
  // lại hoặc admin bấm 2 lần) chỉ 1 lệnh thắng, các lệnh sau trả duplicate.
  private async markPaidAndActivate(
    paymentId: string,
    extra: {
      providerTransactionId?: string;
      rawPayload?: unknown;
      verifiedBy?: string;
    },
  ): Promise<{ ok: true; duplicate?: true }> {
    const payment = await this.prisma.membershipPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Không tìm thấy giao dịch.');

    const updateResult = await this.prisma.membershipPayment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: {
        status: 'PAID',
        verifiedAt: new Date(),
        providerTransactionId: extra.providerTransactionId,
        rawPayload: extra.rawPayload as Prisma.InputJsonValue | undefined,
        verifiedBy: extra.verifiedBy,
      },
    });
    if (updateResult.count === 0) return { ok: true, duplicate: true };

    const expiresAt = new Date(Date.now() + SUBSCRIPTION_DURATION_MS);
    await this.memberships.activatePlan(
      payment.userId,
      payment.plan,
      payment.id,
      expiresAt,
    );
    await writeAuditLog(this.prisma, payment.userId, 'PAYMENT_CONFIRMED', {
      paymentId,
      plan: payment.plan,
      provider: payment.provider,
      verifiedBy: extra.verifiedBy ?? 'webhook',
    });
    return { ok: true };
  }

  async adminConfirm(paymentId: string, adminId: string) {
    return this.markPaidAndActivate(paymentId, { verifiedBy: adminId });
  }

  /** Người bán tự xác nhận đã nhận được thanh toán chuyển thẳng vào tài
   * khoản riêng của họ (không qua tài khoản platform nên không có webhook
   * SePay nào xác nhận hộ). Chỉ chính người bán của giao dịch mới gọi được -
   * updateMany với where.sellerId chặn xác nhận hộ giao dịch của người khác. */
  async sellerConfirmPurchase(purchaseId: string, sellerId: string) {
    const purchase = await this.prisma.imagePurchase.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase) throw new NotFoundException('Không tìm thấy giao dịch.');
    if (purchase.sellerId !== sellerId)
      throw new ForbiddenException(
        'Bạn không phải người bán của giao dịch này.',
      );

    const updateResult = await this.prisma.imagePurchase.updateMany({
      where: { id: purchaseId, sellerId, status: 'PENDING' },
      data: { status: 'PAID', verifiedAt: new Date() },
    });
    if (updateResult.count === 0) return { ok: true, duplicate: true };

    await writeAuditLog(
      this.prisma,
      sellerId,
      'PIN_PURCHASE_CONFIRMED_BY_SELLER',
      {
        purchaseId,
        pinId: purchase.pinId,
        buyerId: purchase.buyerId,
      },
    );

    // Báo cho NGƯỜI MUA — ngược hướng với AUCTION_SALE_PAID (dùng cho nhánh
    // webhook/admin, nơi báo cho seller rằng nền tảng đã ghi nhận thanh
    // toán). Ở đây chính seller là người xác nhận nên buyer mới cần biết.
    try {
      const pin = await this.prisma.pin.findUnique({
        where: { id: purchase.pinId },
        select: { title: true },
      });
      const seller = await this.prisma.user.findUnique({
        where: { id: sellerId },
        select: { username: true },
      });
      await this.notifications.createNotification(
        purchase.buyerId,
        'PURCHASE_CONFIRMED_BY_SELLER',
        `${seller?.username ?? 'Người bán'} đã xác nhận nhận được thanh toán cho tác phẩm "${pin?.title ?? ''}". Bạn có thể tải bản gốc ngay.`,
        sellerId,
        purchase.pinId,
      );
    } catch (err) {
      console.error(
        '[PaymentsService] Không gửi được thông báo PURCHASE_CONFIRMED_BY_SELLER',
        err,
      );
    }

    return { ok: true };
  }

  async adminConfirmPurchase(purchaseId: string, adminId: string) {
    const purchase = await this.prisma.imagePurchase.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase)
      throw new NotFoundException('Không tìm thấy giao dịch mua ảnh.');
    const updateResult = await this.prisma.imagePurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING' },
      data: { status: 'PAID', verifiedAt: new Date() },
    });
    if (updateResult.count === 0) return { ok: true, duplicate: true };
    await writeAuditLog(
      this.prisma,
      purchase.buyerId,
      'PIN_PURCHASE_CONFIRMED',
      {
        purchaseId,
        pinId: purchase.pinId,
        verifiedBy: adminId,
      },
    );
    return { ok: true };
  }

  async adminRejectPurchase(
    purchaseId: string,
    adminId: string,
    reason?: string,
  ) {
    const purchase = await this.prisma.imagePurchase.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase)
      throw new NotFoundException('Không tìm thấy giao dịch mua ảnh.');
    const updateResult = await this.prisma.imagePurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    if (updateResult.count === 0)
      throw new ForbiddenException('Giao dịch không còn ở trạng thái chờ.');
    await writeAuditLog(
      this.prisma,
      purchase.buyerId,
      'PIN_PURCHASE_REJECTED',
      { purchaseId, adminId, reason },
    );
    return { ok: true };
  }

  async adminReject(paymentId: string, adminId: string, reason?: string) {
    const updateResult = await this.prisma.membershipPayment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED', verifiedAt: new Date(), verifiedBy: adminId },
    });
    if (updateResult.count === 0)
      throw new ForbiddenException('Giao dịch không còn ở trạng thái chờ.');
    const payment = await this.prisma.membershipPayment.findUnique({
      where: { id: paymentId },
    });
    await writeAuditLog(
      this.prisma,
      payment?.userId ?? null,
      'PAYMENT_REJECTED',
      {
        paymentId,
        adminId,
        reason,
      },
    );
    return { ok: true };
  }

  private extractPaymentReference(content: string): string | null {
    const match = content.toUpperCase().match(/(TOKEN|NOVA|BUY)[A-Z0-9]{6,}/);
    return match ? match[0] : null;
  }

  verifySepayApiKey(authHeader: string | undefined): void {
    const expectedKey = process.env.SEPAY_WEBHOOK_API_KEY;
    if (!expectedKey) {
      throw new NotImplementedException({
        ok: false,
        error: 'MISSING_ENV',
        missing: ['SEPAY_WEBHOOK_API_KEY'],
        message:
          'Webhook SePay chưa được cấu hình - thiếu biến môi trường SEPAY_WEBHOOK_API_KEY.',
      });
    }
    if (authHeader !== `Apikey ${expectedKey}`) {
      throw new UnauthorizedException('Chữ ký webhook không hợp lệ.');
    }
  }

  async handleSepayWebhook(payload: SepayWebhookPayload) {
    const providerTransactionId = String(
      payload.id ?? payload.referenceCode ?? '',
    );
    if (!providerTransactionId)
      throw new BadRequestException('Payload thiếu mã giao dịch.');

    const [existingPayment, existingPurchase, existingTopUp] =
      await Promise.all([
        this.prisma.membershipPayment.findFirst({
          where: { providerTransactionId },
        }),
        this.prisma.imagePurchase.findFirst({
          where: { providerTransactionId },
        }),
        this.prisma.novaTokenTopUp.findFirst({
          where: { providerTransactionId },
        }),
      ]);
    if (existingPayment || existingPurchase || existingTopUp)
      return { ok: true, duplicate: true };

    const transferType = String(
      payload.transferType ?? payload.type ?? '',
    ).toLowerCase();
    if (transferType && transferType !== 'in')
      return { ok: true, ignored: true };

    const content = String(payload.content ?? payload.description ?? '');
    const amount = Number(payload.transferAmount ?? payload.amount ?? 0);
    const reference = this.extractPaymentReference(content);
    if (!reference) return { ok: true, unmatched: true };

    if (reference.startsWith('BUY')) {
      return this.confirmPinPurchase(
        reference,
        amount,
        providerTransactionId,
        payload,
      );
    }
    if (reference.startsWith('TOKEN')) {
      const topUp = await this.prisma.novaTokenTopUp.findUnique({
        where: { paymentReference: reference },
      });
      if (!topUp || topUp.status !== 'PENDING')
        return { ok: true, unmatched: true };
      if (Number(topUp.vndAmount) !== amount) {
        await writeAuditLog(
          this.prisma,
          topUp.userId,
          'NOVATOKEN_TOPUP_AMOUNT_MISMATCH',
          {
            topUpId: topUp.id,
            expected: topUp.vndAmount,
            received: amount,
          },
        );
        return { ok: true, mismatch: true };
      }
      return this.novaTokens.confirmTopUp(topUp.id, {
        providerTransactionId,
        rawPayload: payload,
      });
    }

    const payment = await this.prisma.membershipPayment.findUnique({
      where: { paymentReference: reference },
    });
    if (!payment || payment.status !== ('PENDING' as PaymentStatus))
      return { ok: true, unmatched: true };

    if (Number(payment.amount) !== amount) {
      await writeAuditLog(
        this.prisma,
        payment.userId,
        'PAYMENT_AMOUNT_MISMATCH',
        {
          paymentId: payment.id,
          expected: payment.amount,
          received: amount,
        },
      );
      return { ok: true, mismatch: true };
    }

    return this.markPaidAndActivate(payment.id, {
      providerTransactionId,
      rawPayload: payload,
    });
  }

  private async confirmPinPurchase(
    reference: string,
    amount: number,
    providerTransactionId: string,
    rawPayload: unknown,
  ) {
    const purchase = await this.prisma.imagePurchase.findUnique({
      where: { paymentReference: reference },
    });
    if (!purchase || purchase.status !== 'PENDING')
      return { ok: true, unmatched: true };

    if (Number(purchase.amount) !== amount) {
      await writeAuditLog(
        this.prisma,
        purchase.buyerId,
        'PIN_PURCHASE_AMOUNT_MISMATCH',
        {
          purchaseId: purchase.id,
          expected: purchase.amount,
          received: amount,
        },
      );
      return { ok: true, mismatch: true };
    }

    const updateResult = await this.prisma.imagePurchase.updateMany({
      where: { id: purchase.id, status: 'PENDING' },
      data: {
        status: 'PAID',
        providerTransactionId,
        verifiedAt: new Date(),
      },
    });
    if (updateResult.count === 0) return { ok: true, duplicate: true };

    await writeAuditLog(
      this.prisma,
      purchase.buyerId,
      'PIN_PURCHASE_CONFIRMED',
      {
        purchaseId: purchase.id,
        pinId: purchase.pinId,
        sellerId: purchase.sellerId,
      },
    );

    // Giao dịch thanh toán của người thắng đấu giá — báo cho seller. Lỗi
    // notification không được làm rollback việc xác nhận thanh toán đã commit.
    if (purchase.auctionId) {
      try {
        const [buyer, pin] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: purchase.buyerId },
            select: { username: true },
          }),
          this.prisma.pin.findUnique({
            where: { id: purchase.pinId },
            select: { title: true },
          }),
        ]);
        await this.notifications.createNotification(
          purchase.sellerId,
          'AUCTION_SALE_PAID',
          `${buyer?.username ?? 'Người thắng đấu giá'} đã thanh toán thành công cho tác phẩm "${pin?.title ?? ''}" bạn đã đấu giá.`,
          purchase.buyerId,
          purchase.pinId,
        );
      } catch (err) {
        console.error(
          '[PaymentsService] Không gửi được thông báo AUCTION_SALE_PAID',
          err,
        );
      }
    }

    return { ok: true };
  }
}
