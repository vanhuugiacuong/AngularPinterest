import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipPlan } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const LIMITS: Record<MembershipPlan, number> = { FREE: 3, PLUS: 10, PRO: 20 };

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  private today() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { plan: true, ownedPlans: true, planStartedAt: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    const usage = await this.prisma.aiUsage.findUnique({ where: { userId_usageDate: { userId, usageDate: this.today() } } });
    const limit = LIMITS[user.plan];
    return { ...user, aiUsed: usage?.count ?? 0, aiLimit: limit, aiRemaining: Math.max(0, limit - (usage?.count ?? 0)), canDownloadClean: user.plan !== 'FREE', canSell: user.plan === 'PRO' };
  }

  async changePlan(userId: string, plan: MembershipPlan) {
    if (!Object.values(MembershipPlan).includes(plan)) throw new BadRequestException('Gói không hợp lệ.');
    const account = await this.prisma.user.findUnique({ where: { id: userId }, select: { ownedPlans: true } });
    if (!account) throw new NotFoundException('Không tìm thấy người dùng.');
    if (!account.ownedPlans.includes(plan)) throw new ForbiddenException('Bạn chưa thanh toán cho gói này.');
    await this.prisma.user.update({ where: { id: userId }, data: { plan, planStartedAt: new Date() } });
    return this.status(userId);
  }

  async consumeAi(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { plan: true } });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
      const usageDate = this.today();
      const current = await tx.aiUsage.findUnique({ where: { userId_usageDate: { userId, usageDate } } });
      const limit = LIMITS[user.plan];
      if ((current?.count ?? 0) >= limit) throw new ForbiddenException(`Bạn đã dùng hết ${limit} lượt tạo AI hôm nay.`);
      const usage = await tx.aiUsage.upsert({ where: { userId_usageDate: { userId, usageDate } }, create: { userId, usageDate, count: 1 }, update: { count: { increment: 1 } } });
      return { used: usage.count, limit, remaining: limit - usage.count };
    });
  }

  async purchase(userId: string, pinId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');
    if (pin.userId === userId) return { paid: false, owned: true, imageUrl: pin.imageUrl };
    if (!pin.isForSale || !pin.price) return { paid: false, imageUrl: pin.imageUrl };
    const purchase = await this.prisma.imagePurchase.upsert({ where: { pinId_buyerId: { pinId, buyerId: userId } }, create: { pinId, buyerId: userId, sellerId: pin.userId, amount: pin.price }, update: {} });
    return { paid: true, purchaseId: purchase.id, imageUrl: pin.imageUrl };
  }
}
