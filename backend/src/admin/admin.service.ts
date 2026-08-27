import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PAYOUT_VND_PER_CREDIT } from '../billing/billing.config';

/**
 * Nghiệp vụ trang quản trị: duyệt yêu cầu rút tiền, xử lý báo cáo vi phạm và
 * báo sự cố chuyển khoản, xem người dùng / doanh thu / nội dung.
 *
 * Mọi thứ ở đây đã qua AdminGuard nên không kiểm tra quyền lại, nhưng vẫn kiểm
 * tra tính hợp lệ của từng thao tác (trạng thái đơn, số dư...) vì đụng tiền thật.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Tổng quan ───────────────────────────────────────────────────────────────
  async getStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      users,
      pins,
      premiumPins,
      openReports,
      openPaymentReports,
      pendingPayouts,
      paidAgg,
      monthAgg,
      proCount,
      walletAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.pin.count(),
      this.prisma.pin.count({ where: { isPremium: true } }),
      this.prisma.pinReport.count({ where: { status: 'OPEN' } }),
      this.prisma.paymentReport.count({ where: { status: 'OPEN' } }),
      this.prisma.payoutRequest.count({ where: { status: { in: ['PENDING', 'APPROVED'] } } }),
      this.prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amountVnd: true } }),
      this.prisma.payment.aggregate({
        where: { status: 'PAID', createdAt: { gte: monthStart } },
        _sum: { amountVnd: true },
      }),
      this.prisma.user.count({ where: { proExpiresAt: { gt: now } } }),
      this.prisma.wallet.aggregate({ _sum: { spendable: true, earnings: true } }),
    ]);

    return {
      users,
      pins,
      premiumPins,
      openReports,
      openPaymentReports,
      pendingPayouts,
      revenueTotal: paidAgg._sum.amountVnd ?? 0,
      revenueMonth: monthAgg._sum.amountVnd ?? 0,
      proCount,
      // Credit đang lưu hành = nghĩa vụ chưa thanh toán của nền tảng.
      creditsCirculating: walletAgg._sum.spendable ?? 0,
      creditsEarnedTotal: walletAgg._sum.earnings ?? 0,
    };
  }

  // ── Rút tiền ────────────────────────────────────────────────────────────────
  async listPayouts(status?: string) {
    const where = status && status !== 'ALL' ? { status } : {};
    const rows = await this.prisma.payoutRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });

    // Kèm thông tin người gửi để admin không phải tra thủ công.
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, email: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => ({ ...r, user: byId.get(r.userId) ?? null }));
  }

  /** Duyệt: chỉ đổi trạng thái, tiền đã bị giữ từ lúc người dùng gửi yêu cầu. */
  async approvePayout(id: string) {
    const req = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Không tìm thấy yêu cầu.');
    if (req.status !== 'PENDING') {
      throw new BadRequestException('Chỉ duyệt được yêu cầu đang chờ.');
    }
    return this.prisma.payoutRequest.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
  }

  /** Đánh dấu đã chuyển khoản — lưu mã giao dịch ngân hàng để đối chiếu sau. */
  async markPayoutPaid(id: string, bankRef?: string) {
    const req = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Không tìm thấy yêu cầu.');
    if (req.status !== 'APPROVED' && req.status !== 'PENDING') {
      throw new BadRequestException('Yêu cầu này đã kết thúc.');
    }
    return this.prisma.payoutRequest.update({
      where: { id },
      data: {
        status: 'PAID',
        bankRef: (bankRef || '').trim().slice(0, 100) || null,
        processedAt: new Date(),
      },
    });
  }

  /**
   * Từ chối — PHẢI hoàn credit về ví, vì credit đã bị trừ ngay lúc người dùng
   * gửi yêu cầu (xem BillingService.createPayoutRequest).
   */
  async rejectPayout(id: string, reason: string) {
    const clean = (reason || '').trim().slice(0, 300);
    if (!clean) throw new BadRequestException('Vui lòng nhập lý do từ chối.');

    return this.prisma.$transaction(async (tx) => {
      const req = await tx.payoutRequest.findUnique({ where: { id } });
      if (!req) throw new NotFoundException('Không tìm thấy yêu cầu.');
      if (req.status === 'PAID' || req.status === 'REJECTED') {
        throw new BadRequestException('Yêu cầu này đã kết thúc.');
      }

      const wallet = await tx.wallet.findUnique({ where: { userId: req.userId } });
      const before = wallet?.spendable ?? 0;

      await tx.wallet.upsert({
        where: { userId: req.userId },
        create: { userId: req.userId, spendable: req.credits, earnings: 0 },
        update: { spendable: { increment: req.credits } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: req.userId,
          type: 'REFUND',
          amount: req.credits,
          balanceAfter: before + req.credits,
          note: `Hoàn credit — yêu cầu rút bị từ chối: ${clean}`,
        },
      });

      return tx.payoutRequest.update({
        where: { id },
        data: { status: 'REJECTED', rejectReason: clean, processedAt: new Date() },
      });
    });
  }

  // ── Báo cáo ảnh vi phạm ─────────────────────────────────────────────────────
  /** Gom theo ảnh: một ảnh bị nhiều người báo cáo chỉ là một dòng. */
  async listPinReports(status = 'OPEN') {
    const where = status === 'ALL' ? {} : { status };
    const reports = await this.prisma.pinReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    if (reports.length === 0) return [];

    const pinIds = [...new Set(reports.map((r) => r.pinId))];
    const pins = await this.prisma.pin.findMany({
      where: { id: { in: pinIds } },
      select: {
        id: true,
        title: true,
        imageUrl: true,
        isPremium: true,
        user: { select: { id: true, username: true, avatarUrl: true, isPinhubBanned: true } },
      },
    });
    const pinById = new Map(pins.map((p) => [p.id, p]));

    const grouped = new Map<string, { pin: any; count: number; reasons: string[]; latest: Date }>();
    for (const r of reports) {
      const pin = pinById.get(r.pinId);
      if (!pin) continue; // ảnh đã bị xoá
      const g = grouped.get(r.pinId) ?? { pin, count: 0, reasons: [], latest: r.createdAt };
      g.count++;
      if (r.reason) g.reasons.push(r.reason);
      if (r.createdAt > g.latest) g.latest = r.createdAt;
      grouped.set(r.pinId, g);
    }

    return [...grouped.values()].sort((a, b) => b.count - a.count);
  }

  /** Bỏ qua: đánh dấu mọi báo cáo của ảnh này là đã xử lý. */
  async resolvePinReports(pinId: string) {
    const res = await this.prisma.pinReport.updateMany({
      where: { pinId, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return { resolved: res.count };
  }

  /** Gỡ ảnh vi phạm. Báo cáo liên quan tự mất theo (onDelete: Cascade). */
  async deletePin(pinId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');
    await this.prisma.pin.delete({ where: { id: pinId } });
    return { deleted: true };
  }

  // ── Báo sự cố chuyển khoản ──────────────────────────────────────────────────
  async listPaymentReports(status = 'OPEN') {
    const where = status === 'ALL' ? {} : { status };
    const rows = await this.prisma.paymentReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const paymentIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);

    const [users, payments] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true, avatarUrl: true },
      }),
      this.prisma.payment.findMany({
        where: { id: { in: paymentIds } },
        select: { id: true, amountVnd: true, status: true, purpose: true, createdAt: true },
      }),
    ]);
    const uById = new Map(users.map((u) => [u.id, u]));
    const pById = new Map(payments.map((p) => [p.id, p]));

    return rows.map((r) => ({
      ...r,
      user: uById.get(r.userId) ?? null,
      payment: r.paymentId ? pById.get(r.paymentId) ?? null : null,
    }));
  }

  async resolvePaymentReport(id: string) {
    const r = await this.prisma.paymentReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Không tìm thấy báo cáo.');
    return this.prisma.paymentReport.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  // ── Người dùng ──────────────────────────────────────────────────────────────
  async listUsers(q?: string) {
    const search = (q || '').trim();
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
        proExpiresAt: true,
        pinhubProPlan: true,
        isPinhubAdmin: true,
        isPinhubBanned: true,
        wallet: { select: { spendable: true, earnings: true } },
        _count: { select: { pins: true } },
      },
    });

    const now = Date.now();
    return users.map((u) => ({
      ...u,
      isProActive: !!u.proExpiresAt && u.proExpiresAt.getTime() > now,
    }));
  }

  /** Khoá / mở khoá tài khoản. */
  async setUserBanned(userId: string, banned: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    if (user.isPinhubAdmin && banned) {
      throw new BadRequestException('Không thể khoá tài khoản quản trị viên.');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { isPinhubBanned: banned },
      select: { id: true, username: true, isPinhubBanned: true },
    });
  }

  // ── Doanh thu ───────────────────────────────────────────────────────────────
  async listPayments(status?: string) {
    // Payment.status là enum QrPaymentStatus (không phải chuỗi tự do) nên phải
    // lọc theo giá trị hợp lệ, tránh truyền rác từ query string vào Prisma.
    const VALID = ['PENDING', 'PAID', 'FAILED', 'EXPIRED'] as const;
    type PayStatus = (typeof VALID)[number];
    const where =
      status && status !== 'ALL' && (VALID as readonly string[]).includes(status)
        ? { status: status as PayStatus }
        : {};
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, user: byId.get(r.userId) ?? null }));
  }

  /** Doanh thu 30 ngày gần nhất cho biểu đồ. */
  async revenueDaily() {
    const from = new Date();
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);

    const rows = await this.prisma.payment.findMany({
      where: { status: 'PAID', createdAt: { gte: from } },
      select: { amountVnd: true, createdAt: true },
    });

    const byDay = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      byDay.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      const key = r.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + r.amountVnd);
    }
    return [...byDay.entries()].map(([date, amountVnd]) => ({ date, amountVnd }));
  }

  /** Số dư credit của từng người — phát hiện tài khoản bất thường. */
  async listWallets() {
    const wallets = await this.prisma.wallet.findMany({
      orderBy: { spendable: 'desc' },
      take: 100,
      select: {
        userId: true,
        spendable: true,
        earnings: true,
        user: { select: { username: true, email: true, proExpiresAt: true } },
      },
    });
    return wallets.map((w) => ({
      ...w,
      vndValue: w.spendable * PAYOUT_VND_PER_CREDIT,
    }));
  }

  // ── Nội dung ────────────────────────────────────────────────────────────────
  async listPins(filter = 'all', q?: string) {
    const search = (q || '').trim();
    const where: any = {};
    if (filter === 'premium') where.isPremium = true;
    if (filter === 'ai') where.isAiGenerated = true;
    if (search) where.title = { contains: search, mode: 'insensitive' };

    return this.prisma.pin.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true,
        title: true,
        imageUrl: true,
        isPremium: true,
        priceCredits: true,
        isAiGenerated: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatarUrl: true } },
        _count: { select: { likes: true, reports: true } },
      },
    });
  }
}
