import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuctionStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { MembershipsService } from '../memberships/memberships.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NovaTokenService } from '../memberships/novatoken.service';
import { writeAuditLog } from '../memberships/audit.util';
import { PUBLIC_USER_SELECT, isUniqueConstraintError } from '../common/relationship.util';
import { resolveSinglePinImageUrl, applyPinImageProtection } from '../common/pin-access.util';
import { PinPreviewProtectionService } from '../watermark/pin-preview-protection.service';

const NON_TERMINAL_STATUSES: AuctionStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE'];

@Injectable()
export class AuctionsService implements OnModuleInit, OnModuleDestroy {
  private static readonly MIN_DURATION_MS = 60 * 60 * 1000; // 1 giờ
  private static readonly MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly notifications: NotificationsService,
    private readonly novaTokens: NovaTokenService,
    private readonly pinPreviewProtection: PinPreviewProtectionService,
  ) {}

  // Sweep nền "best effort" để phiên hết hạn vẫn được finalize (winner +
  // thông báo) kể cả khi không ai mở lại phiên đó. Tính đúng đắn KHÔNG phụ
  // thuộc vào interval này — mọi endpoint đọc/ghi phiên đều tự finalize lazy
  // trước khi xử lý (ensureAuctionUpToDate), giống cách MembershipsService
  // áp dụng lazy-expiry cho gói hết hạn.
  onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      this.sweepDueAuctions().catch((err) => console.error('[AuctionsService] Lỗi khi quét phiên đấu giá quá hạn', err));
    }, AuctionsService.SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private parseVndAmount(raw: unknown, label: string): number {
    const value = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1000) {
      throw new BadRequestException(`${label} phải là số nguyên VND hợp lệ, tối thiểu 1.000đ.`);
    }
    return value;
  }

  private parseDate(raw: unknown, label: string): Date {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new BadRequestException(`${label} không hợp lệ.`);
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label} không hợp lệ.`);
    }
    return date;
  }

  async createAuction(
    sellerId: string,
    body: Record<string, unknown>,
  ) {
    const pinId = typeof body.pinId === 'string' ? body.pinId : '';
    if (!pinId) throw new BadRequestException('Thiếu pinId.');

    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');
    if (pin.userId !== sellerId) throw new ForbiddenException('Bạn không sở hữu ảnh này.');

    // Kiểm tra Pro trực tiếp qua status() (tự áp dụng lazy-expiry) — không
    // đọc User.plan thô — để gói Pro đã hết hạn không còn được mở đấu giá.
    const sellerStatus = await this.memberships.status(sellerId);
    if (sellerStatus.plan !== 'PRO') {
      throw new ForbiddenException('Chỉ thành viên Pro mới có thể tạo phiên đấu giá.');
    }
    // Người thắng sẽ chuyển thẳng vào tài khoản người bán - bắt buộc phải
    // cấu hình trước, tránh người thắng bị kẹt không có QR để trả tiền.
    const payoutAccount = await this.memberships.getPayoutAccount(sellerId);
    if (!payoutAccount) {
      throw new BadRequestException('Vui lòng cấu hình thông tin nhận thanh toán trong Cài đặt trước khi tạo phiên đấu giá.');
    }

    const existingAuction = await this.prisma.auction.findFirst({
      where: { pinId, status: { in: NON_TERMINAL_STATUSES } },
    });
    if (existingAuction) {
      throw new BadRequestException('Ảnh này đang có một phiên đấu giá chưa kết thúc.');
    }

    const startingPrice = this.parseVndAmount(body.startingPrice, 'Giá khởi điểm');
    const minimumIncrement = this.parseVndAmount(body.minimumIncrement, 'Bước giá tối thiểu');
    const startsAt = this.parseDate(body.startsAt, 'Thời gian bắt đầu');
    const endsAt = this.parseDate(body.endsAt, 'Thời gian kết thúc');

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('Thời gian kết thúc phải sau thời gian bắt đầu.');
    }
    const durationMs = endsAt.getTime() - startsAt.getTime();
    if (durationMs < AuctionsService.MIN_DURATION_MS || durationMs > AuctionsService.MAX_DURATION_MS) {
      throw new BadRequestException('Thời lượng phiên đấu giá phải từ 1 giờ đến 30 ngày.');
    }

    const now = new Date();
    const initialStatus: AuctionStatus = startsAt.getTime() <= now.getTime() ? 'ACTIVE' : 'SCHEDULED';

    let auctionId: string;
    try {
      const auction = await this.prisma.$transaction(async (tx) => {
        // Loại trừ với bán giá cố định — 1 pin không bao giờ vừa bán cố định
        // vừa có phiên đấu giá đang hoạt động.
        if (pin.isForSale) {
          await tx.pin.update({ where: { id: pinId }, data: { isForSale: false } });
        }
        return tx.auction.create({
          data: {
            pinId,
            sellerId,
            startingPrice,
            currentPrice: startingPrice,
            minimumIncrement,
            startsAt,
            endsAt,
            status: initialStatus,
          },
        });
      });
      auctionId = auction.id;
    } catch (err) {
      // Defense-in-depth: partial unique index ở DB (một pin chỉ 1 phiên
      // chưa kết thúc) không khai báo được trong schema.prisma nên không có
      // check tự động của Prisma — bắt lỗi unique violation thủ công ở đây.
      if (isUniqueConstraintError(err)) {
        throw new BadRequestException('Ảnh này đang có một phiên đấu giá chưa kết thúc.');
      }
      throw err;
    }

    await writeAuditLog(this.prisma, sellerId, 'AUCTION_CREATED', {
      auctionId,
      pinId,
      startingPrice,
      minimumIncrement,
      startsAt,
      endsAt,
    });

    // Generate the watermarked preview non-winning viewers will see instead
    // of the real one — an auctioned pin is commerce-restricted the moment
    // the auction exists, same as a pin listed for a fixed price at upload.
    await this.pinPreviewProtection.ensureProtectedPreview(pinId);

    return this.getAuction(auctionId, sellerId);
  }

  async getAuction(id: string, viewerId?: string) {
    await this.ensureAuctionUpToDate(id);

    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: {
        pin: { select: { id: true, title: true, imageUrl: true, protectedImageUrl: true, userId: true, isForSale: true } },
        bids: { orderBy: { createdAt: 'desc' }, include: { bidder: { select: PUBLIC_USER_SELECT } } },
        purchase: true,
      },
    });
    if (!auction) throw new NotFoundException('Không tìm thấy phiên đấu giá.');

    const isOwner = viewerId === auction.sellerId;
    if (!isOwner) {
      const viewerPlan = viewerId ? (await this.memberships.status(viewerId)).plan : 'FREE';
      if (viewerPlan !== 'PRO') {
        throw new ForbiddenException('Chỉ thành viên Pro mới có thể xem chi tiết tác phẩm đấu giá.');
      }
    }

    // Chỉ người thắng mới thấy thông tin thanh toán (bao gồm QR tài khoản
    // người bán) — không lộ cho viewer khác.
    let myPurchase: {
      id: string;
      status: string;
      paymentReference: string | null;
      amount: string;
      sellerPayout: { bankCode: string; accountNumber: string; accountName: string } | null;
    } | null = null;
    if (viewerId && viewerId === auction.winnerId && auction.purchase) {
      const sellerPayout = await this.memberships.getPayoutAccount(auction.sellerId);
      myPurchase = {
        id: auction.purchase.id,
        status: auction.purchase.status,
        paymentReference: auction.purchase.paymentReference,
        amount: auction.purchase.amount.toString(),
        sellerPayout,
      };
    }

    // Winning a live auction only settles the payment via the winnerId flow
    // above; the actual gate for "does this viewer get the real preview" is
    // still the same PAID ImagePurchase row every other pin-image path
    // checks (a plan-eligible PRO viewer who is simply browsing, not the
    // winner, must not see the unwatermarked image either).
    const pinImageUrl = await resolveSinglePinImageUrl(this.prisma, auction.pin, viewerId, true);

    return {
      myPurchase,
      id: auction.id,
      pinId: auction.pinId,
      pin: { ...auction.pin, imageUrl: pinImageUrl },
      sellerId: auction.sellerId,
      status: auction.status,
      currency: auction.currency,
      startingPrice: auction.startingPrice.toString(),
      currentPrice: auction.currentPrice.toString(),
      minimumIncrement: auction.minimumIncrement.toString(),
      startsAt: auction.startsAt.toISOString(),
      endsAt: auction.endsAt.toISOString(),
      bidCount: auction.bidCount,
      winnerId: auction.winnerId,
      // Đếm ngược ở frontend phải dựa vào mốc thời gian này, không dùng
      // đồng hồ máy client, để tránh lệch giờ.
      serverNow: new Date().toISOString(),
      bids: auction.bids.map((b) => ({
        id: b.id,
        amount: b.amount.toString(),
        createdAt: b.createdAt.toISOString(),
        bidder: b.bidder,
      })),
    };
  }

  async placeBid(auctionId: string, bidderId: string, body: Record<string, unknown>) {
    const requestKey = typeof body.requestKey === 'string' ? body.requestKey.trim() : '';
    if (!requestKey) throw new BadRequestException('Thiếu requestKey.');
    const amount = this.parseVndAmount(body.amount, 'Giá đặt');

    await this.ensureAuctionUpToDate(auctionId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Idempotency: cùng requestKey đã xử lý trước đó (double-click/retry
      // sau khi request đầu đã commit) — trả lại kết quả cũ, không tính lại.
      const existingBid = await tx.auctionBid.findUnique({ where: { requestKey } });
      if (existingBid) {
        if (existingBid.auctionId !== auctionId || existingBid.bidderId !== bidderId) {
          throw new BadRequestException('requestKey đã được dùng cho một lượt đặt giá khác.');
        }
        return { bid: existingBid, replay: true, previousTopBidderId: null as string | null };
      }

      const auction = await tx.auction.findUnique({ where: { id: auctionId } });
      if (!auction) throw new NotFoundException('Không tìm thấy phiên đấu giá.');
      if (auction.sellerId === bidderId) {
        throw new ForbiddenException('Bạn không thể tự đặt giá cho tác phẩm của mình.');
      }

      const now = new Date();
      if (auction.status !== 'ACTIVE' || now < auction.startsAt || now > auction.endsAt) {
        throw new BadRequestException('Phiên đấu giá hiện không nhận lượt đặt giá.');
      }

      const bidderStatus = await this.memberships.status(bidderId);
      if (bidderStatus.plan !== 'PRO') {
        throw new ForbiddenException('Chỉ thành viên Pro mới có thể đặt giá.');
      }

      const minAcceptable =
        auction.bidCount === 0 ? auction.startingPrice : auction.currentPrice.plus(auction.minimumIncrement);
      if (new Prisma.Decimal(amount).lt(minAcceptable)) {
        throw new BadRequestException(`Giá đặt phải tối thiểu ${minAcceptable.toString()}đ.`);
      }

      // Đọc bid gần nhất trước khi insert bid mới - đây là người sẽ bị "vượt
      // giá" nếu request này thắng race bên dưới.
      const previousTopBid = await tx.auctionBid.findFirst({
        where: { auctionId },
        orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
      });

      // Optimistic lock: chỉ update khi currentPrice vẫn đúng giá trị vừa
      // đọc - hai request đồng thời chỉ 1 request khớp điều kiện này, request
      // thua nhận ConflictException thay vì cùng "thắng" giá cũ.
      const updated = await tx.auction.updateMany({
        // currentPrice alone is not a sufficient optimistic-lock key for the
        // first bid: a valid first bid may equal startingPrice, leaving the
        // price unchanged and allowing a concurrent request to match too.
        // bidCount always changes, so matching both fields makes exactly one
        // request win even in that edge case.
        where: {
          id: auctionId,
          status: 'ACTIVE',
          currentPrice: auction.currentPrice,
          bidCount: auction.bidCount,
        },
        data: { currentPrice: amount, bidCount: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConflictException('Đã có người đặt giá khác, vui lòng thử lại.');
      }

      await this.novaTokens.reserveBid(
        tx,
        auctionId,
        bidderId,
        new Prisma.Decimal(amount),
        requestKey,
        previousTopBid?.bidderId ?? null,
      );

      const bid = await tx.auctionBid.create({ data: { auctionId, bidderId, amount, requestKey } });
      return { bid, replay: false, previousTopBidderId: previousTopBid?.bidderId ?? null };
    });

    if (!result.replay) {
      await this.notifyAfterBid(auctionId, bidderId, result.bid.amount, result.previousTopBidderId);
    }

    return this.getAuction(auctionId, bidderId);
  }

  async cancelAuction(auctionId: string, sellerId: string) {
    const auction = await this.prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) throw new NotFoundException('Không tìm thấy phiên đấu giá.');
    if (auction.sellerId !== sellerId) throw new ForbiddenException('Bạn không phải chủ phiên đấu giá này.');
    if (auction.bidCount > 0) {
      throw new BadRequestException('Không thể hủy phiên đã có người đặt giá.');
    }
    if (!NON_TERMINAL_STATUSES.includes(auction.status)) {
      throw new BadRequestException('Phiên đấu giá này không thể hủy.');
    }

    const updated = await this.prisma.auction.updateMany({
      where: { id: auctionId, status: auction.status, bidCount: 0 },
      data: { status: 'CANCELLED' },
    });
    if (updated.count === 0) {
      throw new ConflictException('Trạng thái phiên đã thay đổi, vui lòng tải lại.');
    }

    await writeAuditLog(this.prisma, sellerId, 'AUCTION_CANCELLED', { auctionId });
    return this.getAuction(auctionId, sellerId);
  }

  async listSelling(sellerId: string) {
    const auctions = await this.prisma.auction.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: {
        pin: { select: { id: true, title: true, imageUrl: true } },
        winner: { select: PUBLIC_USER_SELECT },
        purchase: { select: { id: true, status: true, verifiedAt: true } },
      },
    });
    return auctions.map((a) => ({
      id: a.id,
      pin: a.pin,
      status: a.status,
      currency: a.currency,
      startingPrice: a.startingPrice.toString(),
      currentPrice: a.currentPrice.toString(),
      minimumIncrement: a.minimumIncrement.toString(),
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      bidCount: a.bidCount,
      winner: a.winner,
      purchaseStatus: a.purchase?.status ?? null,
    }));
  }

  async listBidding(bidderId: string) {
    const bids = await this.prisma.auctionBid.findMany({
      where: { bidderId },
      orderBy: { createdAt: 'desc' },
      include: {
        auction: {
          include: {
            pin: { select: { id: true, title: true, imageUrl: true, protectedImageUrl: true, userId: true, isForSale: true } },
          },
        },
      },
    });
    const seen = new Set<string>();
    const result: Array<{
      auctionId: string;
      pin: { id: string; title: string; imageUrl: string; protectedImageUrl: string | null; userId: string; isForSale: boolean };
      status: AuctionStatus;
      currentPrice: string;
      myLastBid: string;
      endsAt: string;
      isWinning: boolean;
    }> = [];
    for (const bid of bids) {
      if (seen.has(bid.auctionId)) continue;
      seen.add(bid.auctionId);
      result.push({
        auctionId: bid.auction.id,
        pin: bid.auction.pin,
        status: bid.auction.status,
        currentPrice: bid.auction.currentPrice.toString(),
        myLastBid: bid.amount.toString(),
        endsAt: bid.auction.endsAt.toISOString(),
        isWinning: bid.auction.winnerId === bidderId,
      });
    }
    // Bidding on a pin is not the same as owning or paying for it — every
    // past bidder here, winner or not, must only see the real image once
    // they've actually got a PAID ImagePurchase (checked by pin, batched).
    await applyPinImageProtection(
      this.prisma,
      result.map((r) => r.pin),
      bidderId,
    );
    return result.map((r) => ({
      auctionId: r.auctionId,
      pin: { id: r.pin.id, title: r.pin.title, imageUrl: r.pin.imageUrl },
      status: r.status,
      currentPrice: r.currentPrice,
      myLastBid: r.myLastBid,
      endsAt: r.endsAt,
      isWinning: r.isWinning,
    }));
  }

  /** Chuyển SCHEDULED -> ACTIVE khi đến giờ, và finalize khi đã hết hạn -
   * gọi trước mọi lần đọc/ghi phiên để trạng thái luôn phản ánh đúng theo
   * server time, không phụ thuộc sweep nền. */
  private async ensureAuctionUpToDate(auctionId: string): Promise<void> {
    const auction = await this.prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return;
    const now = new Date();

    if (now >= auction.endsAt && (auction.status === 'ACTIVE' || auction.status === 'SCHEDULED')) {
      await this.finalizeAuction(auctionId);
      return;
    }
    if (auction.status === 'SCHEDULED' && now >= auction.startsAt) {
      await this.prisma.auction.updateMany({ where: { id: auctionId, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } });
    }
  }

  private async sweepDueAuctions(): Promise<void> {
    const now = new Date();

    const dueToActivate = await this.prisma.auction.findMany({
      where: { status: 'SCHEDULED', startsAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    for (const { id } of dueToActivate) {
      await this.prisma.auction.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } });
    }

    const dueToEnd = await this.prisma.auction.findMany({
      where: { status: { in: ['SCHEDULED', 'ACTIVE'] }, endsAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    for (const { id } of dueToEnd) {
      await this.finalizeAuction(id);
    }
  }

  /** Atomic qua updateMany({ where: { status: <trạng thái đã đọc> } }) — chỉ
   * tiến trình nào thắng cập nhật mới chạy phần settlement/notification bên
   * dưới, chặn double-finalize khi lazy-check và sweep interval trùng lúc. */
  private async finalizeAuction(auctionId: string): Promise<void> {
    // Commit the status transition, winner and pending purchase together.
    // Otherwise a crash after ENDED but before ImagePurchase.create() would
    // strand the winner with no payment/download path.
    const settlement = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.auction.findUnique({ where: { id: auctionId } });
      if (!auction || (auction.status !== 'ACTIVE' && auction.status !== 'SCHEDULED')) return null;

      const winningBid = await tx.auctionBid.findFirst({
        where: { auctionId },
        // Bid hợp lệ cao nhất thắng; bằng giá thì bid đến trước thắng.
        orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
      });

      const updateResult = await tx.auction.updateMany({
        where: { id: auctionId, status: auction.status },
        data: { status: 'ENDED', winnerId: winningBid?.bidderId ?? null },
      });
      if (updateResult.count === 0) return null;

      const pin = await tx.pin.findUnique({ where: { id: auction.pinId }, select: { title: true } });
      const tokenAmount = await this.novaTokens.settleAuction(
        tx,
        { id: auction.id, sellerId: auction.sellerId, pinId: auction.pinId },
        winningBid?.bidderId ?? null,
        pin?.title ?? '',
      );

      if (winningBid) {
        const existingPurchase = await tx.imagePurchase.findUnique({
          where: { pinId_buyerId: { pinId: auction.pinId, buyerId: winningBid.bidderId } },
        });
        if (existingPurchase) {
          await tx.imagePurchase.update({
            where: { id: existingPurchase.id },
            data: {
              amount: tokenAmount!,
              currency: 'NOVA_TOKEN',
              auctionId: auction.id,
              status: 'PAID',
              paymentReference: null,
              verifiedAt: new Date(),
            },
          });
        } else {
          await tx.imagePurchase.create({
            data: {
              pinId: auction.pinId,
              buyerId: winningBid.bidderId,
              sellerId: auction.sellerId,
              amount: tokenAmount!,
              currency: 'NOVA_TOKEN',
              status: 'PAID',
              verifiedAt: new Date(),
              auctionId: auction.id,
            },
          });
        }
      }

      return { auction, winningBid, pinTitle: pin?.title ?? '' };
    });
    if (!settlement) return;

    const { auction, winningBid, pinTitle } = settlement;

    if (!winningBid) {
      try {
        await this.notifications.createNotification(
          auction.sellerId,
          'AUCTION_ENDED_NO_BIDS',
          `Phiên đấu giá cho tác phẩm "${pinTitle}" đã kết thúc mà không có lượt đặt giá nào.`,
          undefined,
          auction.pinId,
        );
      } catch (err) {
        console.error('[AuctionsService] Không gửi được thông báo AUCTION_ENDED_NO_BIDS', err);
      }
      await writeAuditLog(this.prisma, auction.sellerId, 'AUCTION_ENDED_NO_BIDS', { auctionId });
      return;
    }

    try {
      await this.notifications.createNotification(
        winningBid.bidderId,
        'AUCTION_WON',
        `Chúc mừng! Bạn đã thắng đấu giá tác phẩm "${pinTitle}" với giá ${winningBid.amount.toString()}đ.`,
        auction.sellerId,
        auction.pinId,
      );
    } catch (err) {
      console.error('[AuctionsService] Không gửi được thông báo AUCTION_WON', err);
    }
    await writeAuditLog(this.prisma, auction.sellerId, 'AUCTION_ENDED_WITH_WINNER', {
      auctionId,
      winnerId: winningBid.bidderId,
      amount: winningBid.amount.toString(),
    });
  }

  private async notifyAfterBid(
    auctionId: string,
    bidderId: string,
    amount: Prisma.Decimal,
    previousTopBidderId: string | null,
  ): Promise<void> {
    try {
      const [auction, bidder] = await Promise.all([
        this.prisma.auction.findUnique({ where: { id: auctionId }, include: { pin: { select: { title: true } } } }),
        this.prisma.user.findUnique({ where: { id: bidderId }, select: { username: true } }),
      ]);
      if (!auction) return;
      const amountStr = amount.toString();

      await this.notifications.createNotification(
        auction.sellerId,
        'AUCTION_NEW_BID',
        `${bidder?.username ?? 'Một người dùng'} vừa đặt giá ${amountStr}đ cho tác phẩm "${auction.pin.title}".`,
        bidderId,
        auction.pinId,
      );

      if (previousTopBidderId && previousTopBidderId !== bidderId) {
        await this.notifications.createNotification(
          previousTopBidderId,
          'AUCTION_OUTBID',
          `Bạn đã bị vượt giá cho tác phẩm "${auction.pin.title}". Giá hiện tại: ${amountStr}đ.`,
          bidderId,
          auction.pinId,
        );
      }
    } catch (err) {
      console.error('[AuctionsService] Không gửi được thông báo sau khi đặt giá', err);
    }
  }
}
