import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipPlan } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PLAN_ENTITLEMENTS } from './entitlements';
import { writeAuditLog } from './audit.util';
import { isSupportedBankCode } from './vietqr-banks';
import { randomUUID } from 'node:crypto';

// Việt Nam / Asia-Bangkok đều UTC+7 quanh năm, không có DST - offset cố định
// nên tính mốc reset không cần thư viện timezone.
const RESET_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  private todayInTz(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return new Date(`${parts}T00:00:00.000Z`);
  }

  private nextResetAt(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [y, m, d] = parts.split('-').map(Number);
    const nextLocalMidnightUtcMs = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - RESET_TZ_OFFSET_MS;
    return new Date(nextLocalMidnightUtcMs);
  }

  // Nếu gói trả phí hiện tại đã hết hạn, tự hạ về FREE. Gọi trước mọi lần
  // đọc/tiêu quyền lợi để đảm bảo không dùng ké gói đã hết hạn.
  private async applyExpiry(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true },
    });
    if (!user || user.plan === 'FREE') return;
    if (user.planExpiresAt && user.planExpiresAt.getTime() < Date.now()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { plan: 'FREE', planStartedAt: new Date(), planExpiresAt: null },
      });
      await writeAuditLog(this.prisma, userId, 'PLAN_EXPIRED', { previousPlan: user.plan });
    }
  }

  /** Resolve only the currently active plan for authorization checks that do
   * not need AI-usage counters. Keeping this separate from status() avoids
   * unrelated reads while still applying the exact same lazy expiry rule. */
  private async activePlan(userId: string): Promise<MembershipPlan> {
    await this.applyExpiry(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    return user.plan;
  }

  async status(userId: string) {
    await this.applyExpiry(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, ownedPlans: true, planStartedAt: true, planExpiresAt: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');

    const usage = await this.prisma.aiUsage.findUnique({
      where: { userId_usageDate: { userId, usageDate: this.todayInTz() } },
    });
    const entitlements = PLAN_ENTITLEMENTS[user.plan];
    const used = usage?.count ?? 0;

    return {
      ...user,
      ...entitlements,
      aiUsed: used,
      aiLimit: entitlements.aiDailyLimit,
      aiRemaining: Math.max(0, entitlements.aiDailyLimit - used),
      aiResetAt: this.nextResetAt().toISOString(),
      // Giữ 2 field cũ để không phá tương thích với frontend hiện có.
      canDownloadClean: entitlements.cleanDownload,
      canSell: entitlements.canSell,
    };
  }

  async changePlan(userId: string, plan: MembershipPlan) {
    if (!Object.values(MembershipPlan).includes(plan)) {
      throw new BadRequestException('Gói không hợp lệ.');
    }

    if (plan === 'FREE') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { plan: 'FREE', planStartedAt: new Date(), planExpiresAt: null },
      });
      await writeAuditLog(this.prisma, userId, 'PLAN_CHANGED', { plan: 'FREE' });
      return this.status(userId);
    }

    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownedPlans: true },
    });
    if (!account) throw new NotFoundException('Không tìm thấy người dùng.');
    if (!account.ownedPlans.includes(plan)) {
      throw new ForbiddenException('Bạn chưa thanh toán cho gói này.');
    }

    const activeSub = await this.prisma.membershipSubscription.findFirst({
      where: { userId, plan, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    if (!activeSub) {
      throw new ForbiddenException('Gói này đã hết hạn, vui lòng gia hạn để tiếp tục sử dụng.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { plan, planStartedAt: new Date(), planExpiresAt: activeSub.expiresAt },
    });
    await writeAuditLog(this.prisma, userId, 'PLAN_CHANGED', { plan });
    return this.status(userId);
  }

  // Gọi sau khi 1 MembershipPayment chuyển sang PAID (webhook hoặc admin xác
  // nhận) - không bao giờ gọi trực tiếp từ 1 request do client khởi tạo.
  async activatePlan(userId: string, plan: MembershipPlan, paymentId: string, expiresAt: Date) {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { ownedPlans: true } });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
      const ownedPlans = user.ownedPlans.includes(plan) ? user.ownedPlans : [...user.ownedPlans, plan];
      await tx.user.update({
        where: { id: userId },
        data: { plan, planStartedAt: new Date(), planExpiresAt: expiresAt, ownedPlans },
      });
      await tx.membershipSubscription.create({
        data: { userId, plan, paymentId, expiresAt },
      });
    });
    await writeAuditLog(this.prisma, userId, 'PLAN_ACTIVATED', { plan, paymentId, expiresAt });
  }

  // Nguyên tử: INSERT..ON CONFLICT..WHERE đảm bảo nhiều request đồng thời
  // không thể cùng vượt hạn mức (tránh race condition đọc-rồi-ghi trước đây).
  async consumeAi(userId: string) {
    await this.applyExpiry(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');

    const limit = PLAN_ENTITLEMENTS[user.plan].aiDailyLimit;
    const usageDate = this.todayInTz();
    const id = randomUUID();

    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "AiUsage" ("id", "userId", "usageDate", "count")
      VALUES (${id}, ${userId}, ${usageDate}, 1)
      ON CONFLICT ("userId", "usageDate")
      DO UPDATE SET "count" = "AiUsage"."count" + 1
      WHERE "AiUsage"."count" < ${limit}
      RETURNING "count";
    `;

    if (rows.length === 0) {
      const resetAt = this.nextResetAt();
      throw new ForbiddenException(
        `Bạn đã dùng hết ${limit} lượt tạo AI hôm nay. Lượt mới sẽ được cấp lại lúc ${resetAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
      );
    }

    const used = rows[0].count;
    return { used, limit, remaining: limit - used, resetAt: this.nextResetAt().toISOString() };
  }

  // Tạo (hoặc trả lại) yêu cầu mua ảnh PENDING - không bao giờ tự cấp quyền
  // ngay. Chỉ webhook thanh toán đã xác thực hoặc admin xác nhận mới được
  // chuyển PENDING -> PAID (xem PaymentsService.handleSepayWebhook / adminConfirmPurchase).
  async purchase(userId: string, pinId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');
    if (pin.userId === userId) throw new BadRequestException('Bạn không thể mua ảnh của chính mình.');
    if (!pin.isForSale || !pin.price) throw new BadRequestException('Ảnh này hiện không được rao bán.');

    const buyerPlan = await this.activePlan(userId);
    if (buyerPlan !== 'PLUS' && buyerPlan !== 'PRO') {
      throw new ForbiddenException('Nâng cấp gói để mua và trao đổi tác phẩm có giá trị.');
    }

    const sellerPlan = await this.activePlan(pin.userId);
    if (sellerPlan !== 'PRO') {
      throw new ForbiddenException('Người bán không còn ở gói Pro, sản phẩm này đang tạm dừng bán.');
    }

    const seller = await this.prisma.user.findUnique({
      where: { id: pin.userId },
      select: { payoutBankCode: true, payoutAccountNumber: true, payoutAccountName: true },
    });
    if (!seller?.payoutBankCode || !seller.payoutAccountNumber || !seller.payoutAccountName) {
      throw new BadRequestException('Người bán chưa cấu hình thông tin nhận thanh toán.');
    }
    // Người mua chuyển thẳng vào tài khoản người bán - trả kèm thông tin này
    // để frontend tạo QR đúng, không còn dùng tài khoản chung của platform.
    const sellerPayout = {
      bankCode: seller.payoutBankCode,
      accountNumber: seller.payoutAccountNumber,
      accountName: seller.payoutAccountName,
    };

    const existing = await this.prisma.imagePurchase.findUnique({
      where: { pinId_buyerId: { pinId, buyerId: userId } },
    });
    if (existing) return { ...existing, sellerPayout };

    const paymentReference = `BUY${Date.now().toString(36).toUpperCase()}${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    const created = await this.prisma.imagePurchase.create({
      data: { pinId, buyerId: userId, sellerId: pin.userId, amount: pin.price, status: 'PENDING', paymentReference },
    });
    return { ...created, sellerPayout };
  }

  /** Tài khoản nhận tiền của chính user (null nếu chưa cấu hình đủ 3 trường). */
  async getPayoutAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { payoutBankCode: true, payoutAccountNumber: true, payoutAccountName: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    if (!user.payoutBankCode || !user.payoutAccountNumber || !user.payoutAccountName) return null;
    return {
      bankCode: user.payoutBankCode,
      accountNumber: user.payoutAccountNumber,
      accountName: user.payoutAccountName,
    };
  }

  async updatePayoutAccount(userId: string, body: Record<string, unknown>) {
    const plan = await this.activePlan(userId);
    if (plan !== 'PRO') {
      throw new ForbiddenException('Chỉ thành viên Pro mới có thể cấu hình tài khoản nhận thanh toán.');
    }

    const bankCode = typeof body.bankCode === 'string' ? body.bankCode.trim().toUpperCase() : '';
    const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber.trim() : '';
    const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';

    if (!isSupportedBankCode(bankCode)) {
      throw new BadRequestException('Ngân hàng không được hỗ trợ.');
    }
    if (!/^\d{6,19}$/.test(accountNumber)) {
      throw new BadRequestException('Số tài khoản không hợp lệ (chỉ chữ số, 6-19 ký tự).');
    }
    if (!accountName || accountName.length > 100) {
      throw new BadRequestException('Vui lòng nhập tên chủ tài khoản hợp lệ.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { payoutBankCode: bankCode, payoutAccountNumber: accountNumber, payoutAccountName: accountName },
    });
    await writeAuditLog(this.prisma, userId, 'PAYOUT_ACCOUNT_UPDATED', { bankCode });
    return this.getPayoutAccount(userId);
  }

  async listPendingSales(userId: string) {
    return this.prisma.imagePurchase.findMany({
      where: { sellerId: userId, status: 'PENDING' },
      include: { pin: { select: { id: true, title: true, imageUrl: true } }, buyer: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listSales(userId: string) {
    const sales = await this.prisma.imagePurchase.findMany({
      where: { sellerId: userId, status: 'PAID' },
      include: { pin: { select: { id: true, title: true, imageUrl: true } }, buyer: { select: { username: true } } },
      orderBy: { verifiedAt: 'desc' },
    });
    const revenue = sales.reduce((sum, s) => sum + Number(s.amount), 0);
    return { sales, revenue };
  }

  async listPurchases(userId: string) {
    return this.prisma.imagePurchase.findMany({
      where: { buyerId: userId },
      include: { pin: { select: { id: true, title: true, imageUrl: true } }, seller: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
