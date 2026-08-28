import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MembershipPlan,
  AuctionStatus,
  Currency,
  Prisma,
} from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AiGeneratorService } from '../ai-generator/ai-generator.service';
import { MembershipsService } from '../memberships/memberships.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PinPreviewProtectionService } from '../watermark/pin-preview-protection.service';
import {
  applyPinImageProtection,
  resolveSinglePinImageUrl,
  resolveViewablePinImageUrl,
} from '../common/pin-access.util';
import {
  isPinImageSizeAllowed,
  PIN_IMAGE_TOO_LARGE_MESSAGE,
} from '../common/upload-limits';

interface EmbeddingResponse {
  embedding: number[];
}

interface SimilarPinRow {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  protectedImageUrl: string | null;
  sourceUrl: string | null;
  userId: string;
  createdAt: Date;
  isAiGenerated: boolean;
  category: string;
  price: string | null;
  isForSale: boolean;
  currency: Currency;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
  authorPlan: MembershipPlan | null;
  authorIsAdmin: boolean | null;
  likesCount: number;
  similarity: number;
}

/** 'NONE' | 'FIXED_PRICE' | 'AUCTION' — suy ra từ Pin.isForSale + phiên đấu
 * giá (chưa CANCELLED) mới nhất của pin, không bao giờ đọc trực tiếp từ
 * client. Một pin không bao giờ vừa FIXED_PRICE vừa AUCTION cùng lúc. */
export type PinListingType = 'NONE' | 'FIXED_PRICE' | 'AUCTION';

export interface PinAuctionSummary {
  id: string;
  status: AuctionStatus;
  startingPrice: string;
  currentPrice: string;
  minimumIncrement: string;
  currency: Currency;
  startsAt: string;
  endsAt: string;
  bidCount: number;
}

interface AuctionLike {
  id: string;
  pinId: string;
  status: AuctionStatus;
  startingPrice: Prisma.Decimal;
  currentPrice: Prisma.Decimal;
  minimumIncrement: Prisma.Decimal;
  currency: Currency;
  startsAt: Date;
  endsAt: Date;
  bidCount: number;
}

interface PinEmbeddingRow {
  embedding: string | null;
}

@Injectable()
export class PinsService {
  private readonly clipServiceUrl = (
    process.env.CLIP_SERVICE_URL || 'http://127.0.0.1:8001'
  ).replace('localhost', '127.0.0.1');

  /** Minimum absolute cosine similarity (0-1) a reverse-image-search result
   * must clear to be considered a real match at all. Configurable via env
   * since the right cutoff depends on the CLIP model and the catalog's
   * actual embedding distribution — tune with real data, don't guess. */
  private readonly imageSearchMinSimilarity = PinsService.parseThreshold(
    process.env.IMAGE_SEARCH_MIN_SIMILARITY,
    0.45,
  );
  /** Maximum allowed drop in similarity relative to the best result in the
   * batch — keeps a long tail of "technically above the floor but clearly
   * worse than the top hits" pins out of the results.
   *
   * 0.40, measured rather than guessed (the note above asks for exactly that).
   * Querying a selfie already in the catalogue gives:
   *
   *   0.909  the same person      <- genuine match
   *   0.871  the same person      <- genuine match
   *   0.682  unrelated meme       <- cliff
   *
   * so at the old 0.25 the cut landed at 0.659 and returned 4 pins. That is
   * the correct answer to "which images are the SAME thing", but the screen
   * this feeds is "Ảnh tương tự", a browsing surface — three cards on an empty
   * page reads as broken rather than as precise. Measured result counts for
   * that query: gap 0.25 -> 4, 0.30 -> 20, 0.35 -> 49, 0.40 -> 167.
   *
   * 0.40 fills the 40-slot page the frontend requests, while the absolute
   * floor below still blocks anything genuinely unrelated, and results stay
   * ordered by similarity so the true matches remain first. */
  private readonly imageSearchMaxSimilarityGap = PinsService.parseThreshold(
    process.env.IMAGE_SEARCH_MAX_SIMILARITY_GAP,
    0.4,
  );

  private static parseThreshold(
    raw: string | undefined,
    fallback: number,
  ): number {
    const parsed = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : fallback;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly aiGeneratorService: AiGeneratorService,
    private readonly membershipsService: MembershipsService,
    private readonly notificationsService: NotificationsService,
    private readonly pinPreviewProtection: PinPreviewProtectionService,
  ) {}

  // Lưu bản gốc vào bucket private "pins-original" (chỉ backend đọc được) và
  // sinh 1 bản preview đã tối ưu kích thước cho bucket public "pins". Pin.imageUrl
  // luôn trỏ tới preview, không bao giờ là bản gốc từ giờ trở đi.
  private async storeOriginalAndPreview(
    buffer: Buffer,
    contentType: string,
    userId: string,
    prefix: 'pin' | 'ai',
  ): Promise<{
    imageUrl: string;
    originalStoragePath: string;
    previewStoragePath: string;
  }> {
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg';
    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const originalStoragePath = `${userId}/${prefix}_${stamp}_original.${ext}`;
    await this.supabaseService.uploadPrivate(
      'pins-original',
      originalStoragePath,
      buffer,
      contentType,
    );

    const previewStoragePath = `${userId}/${prefix}_${stamp}_preview.${ext}`;
    const previewBuffer = await sharp(buffer, { limitInputPixels: 60_000_000 })
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer();
    const imageUrl = await this.supabaseService.uploadImage(
      'pins',
      previewStoragePath,
      previewBuffer,
      contentType,
    );

    return { imageUrl, originalStoragePath, previewStoragePath };
  }

  /** Best-effort cleanup of the just-uploaded preview + original when a Pin
   * insert fails right after — otherwise a transient DB error (or a unique-
   * constraint race, or a connection blip) leaves the files sitting in
   * storage forever with nothing in the database pointing at them. */
  private async rollbackUploadedImage(
    originalStoragePath: string,
    previewStoragePath: string,
  ): Promise<void> {
    await Promise.all([
      this.supabaseService.deleteObject('pins-original', originalStoragePath),
      this.supabaseService.deleteObject('pins', previewStoragePath),
    ]);
  }

  private async getImageEmbedding(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<number[] | null> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
      formData.append('file', blob, filename);

      const response = await fetch(`${this.clipServiceUrl}/embed/image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `CLIP image embedding failed: ${response.statusText} - ${errorText}`,
        );
        return null;
      }

      const result: unknown = await response.json();
      return this.readEmbedding(result);
    } catch (error) {
      console.error('CLIP image embedding network error:', error);
      return null;
    }
  }

  /** Zero-shot NSFW check against the clip-service. Fails closed: if the
   * moderation service is unreachable or errors, the caller should treat
   * the image as not-yet-cleared rather than silently letting it through. */
  private async moderateImage(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<{ nsfw: boolean; nsfwScore: number; topLabel: string }> {
    // TEMP DEBUG LOGGING — remove once moderation behavior is confirmed stable.
    console.log(
      `[moderation] started file=${filename} mimetype=${mimetype} size=${buffer.length} bytes url=${this.clipServiceUrl}/moderate/image`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
      formData.append('file', blob, filename);

      const response = await fetch(`${this.clipServiceUrl}/moderate/image`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[moderation] error: HTTP ${response.status} ${response.statusText} - ${errorText}`,
        );
        throw new ServiceUnavailableException(
          'Không thể kiểm duyệt ảnh lúc này. Vui lòng thử lại sau.',
        );
      }

      const result = await response.json();
      console.log(
        `[moderation] raw result=${JSON.stringify(result)} score=${result?.nsfwScore} nsfw=${result?.nsfw}`,
      );
      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'timeout after 15s'
          : error instanceof Error
            ? error.message
            : String(error);
      console.error(`[moderation] error: ${reason}`, error);
      throw new ServiceUnavailableException(
        'Không thể kiểm duyệt ảnh lúc này. Vui lòng thử lại sau.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Used by both the FE's pre-submit check and createUploadPin's own
   * server-side gate, so a request straight to POST /api/pins can never
   * skip moderation regardless of what the client claims. */
  async checkImageModeration(
    file: Express.Multer.File | undefined,
  ): Promise<{ safe: boolean; message?: string }> {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn ảnh để kiểm tra.');
    }
    if (!isPinImageSizeAllowed(Math.max(file.size, file.buffer.byteLength))) {
      throw new PayloadTooLargeException(PIN_IMAGE_TOO_LARGE_MESSAGE);
    }
    const moderation = await this.moderateImage(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    if (moderation.nsfw) {
      return {
        safe: false,
        message: 'Ảnh có nội dung không phù hợp. Vui lòng chọn ảnh khác.',
      };
    }
    return { safe: true };
  }

  private async getTextEmbedding(query: string): Promise<number[] | null> {
    try {
      const response = await fetch(
        `${this.clipServiceUrl}/embed/text?query=${encodeURIComponent(query)}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `CLIP text embedding failed: ${response.statusText} - ${errorText}`,
        );
        return null;
      }

      const result: unknown = await response.json();
      return this.readEmbedding(result);
    } catch (error) {
      console.error('CLIP text embedding network error:', error);
      return null;
    }
  }

  /** Phiên đấu giá chưa CANCELLED mới nhất cho mỗi pinId (không bao giờ hơn 1
   * phiên chưa kết thúc/pin nhờ partial unique index ở DB, nhưng vẫn có thể
   * có nhiều phiên ENDED lịch sử — lấy bản mới nhất theo createdAt). */
  private async fetchLatestAuctionsByPinIds(
    pinIds: string[],
  ): Promise<Map<string, AuctionLike>> {
    const uniqueIds = [...new Set(pinIds)];
    if (uniqueIds.length === 0) return new Map();
    const rows = await this.prisma.auction.findMany({
      where: { pinId: { in: uniqueIds }, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
    const map = new Map<string, AuctionLike>();
    for (const row of rows) {
      if (!map.has(row.pinId)) map.set(row.pinId, row);
    }
    return map;
  }

  private toAuctionSummary(a: AuctionLike): PinAuctionSummary {
    return {
      id: a.id,
      status: a.status,
      startingPrice: a.startingPrice.toString(),
      currentPrice: a.currentPrice.toString(),
      minimumIncrement: a.minimumIncrement.toString(),
      currency: a.currency,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      bidCount: a.bidCount,
    };
  }

  private marketFieldsFor(
    isForSale: boolean,
    auction?: AuctionLike,
  ): { listingType: PinListingType; auction: PinAuctionSummary | null } {
    if (auction)
      return {
        listingType: 'AUCTION',
        auction: this.toAuctionSummary(auction),
      };
    if (isForSale) return { listingType: 'FIXED_PRICE', auction: null };
    return { listingType: 'NONE', auction: null };
  }

  /** Id của những pin trong danh sách mà viewerId đã thích - dùng để gắn cờ
   * isLiked hàng loạt (1 query) thay vì N+1 theo từng pin. */
  private async fetchLikedPinIds(
    pinIds: string[],
    viewerId?: string,
  ): Promise<Set<string>> {
    if (!viewerId || pinIds.length === 0) return new Set();
    const rows = await this.prisma.like.findMany({
      where: { userId: viewerId, pinId: { in: pinIds } },
      select: { pinId: true },
    });
    return new Set(rows.map((r) => r.pinId));
  }

  /** Gắn listingType/auction + isLiked (nếu có viewerId) vào danh sách pin đã
   * fetch qua ORM (include), đồng thời bỏ originalStoragePath khỏi response -
   * bản gốc chỉ backend được đọc trực tiếp qua endpoint tải ảnh có kiểm tra
   * quyền riêng. */
  private async attachMarketInfoToList<
    T extends {
      id: string;
      userId: string;
      isForSale: boolean;
      imageUrl: string;
      protectedImageUrl?: string | null;
      originalStoragePath?: string | null;
    },
  >(pins: T[], viewerId?: string): Promise<Omit<T, 'originalStoragePath'>[]> {
    const [auctionMap, likedIds, purchasedIds] = await Promise.all([
      this.fetchLatestAuctionsByPinIds(pins.map((p) => p.id)),
      this.fetchLikedPinIds(
        pins.map((p) => p.id),
        viewerId,
      ),
      this.fetchPaidPurchasePinIds(
        pins.map((p) => p.id),
        viewerId,
      ),
    ]);
    return pins.map((p) => {
      const { originalStoragePath, ...rest } = p;
      const auction = auctionMap.get(p.id);
      return {
        ...rest,
        // Only the owner or a PAID buyer ever gets the real imageUrl here —
        // see resolveViewablePinImageUrl's doc comment. Everyone else gets
        // the fully-blurred stand-in, regardless of plan.
        imageUrl: resolveViewablePinImageUrl(p, {
          viewerId,
          hasAuction: Boolean(auction),
          hasPaidPurchase: purchasedIds.has(p.id),
        }),
        ...this.marketFieldsFor(p.isForSale, auction),
        hasPurchased: purchasedIds.has(p.id),
        isLiked: likedIds.has(p.id),
      };
    });
  }

  /** Id của những pin trong danh sách mà viewerId đã mua thành công (PAID) -
   * dùng để attachMarketInfoToList quyết định trả imageUrl thật hay bản đã
   * watermark, hàng loạt (1 query) thay vì N+1 theo từng pin. */
  private async fetchPaidPurchasePinIds(
    pinIds: string[],
    viewerId?: string,
  ): Promise<Set<string>> {
    if (!viewerId || pinIds.length === 0) return new Set();
    const rows = await this.prisma.imagePurchase.findMany({
      where: { buyerId: viewerId, pinId: { in: pinIds }, status: 'PAID' },
      select: { pinId: true },
    });
    return new Set(rows.map((r) => r.pinId));
  }

  async getAllPins(
    page: number = 1,
    limit: number = 20,
    userId?: string,
    seed?: string,
    category?: string,
    recentSearchTerms: string[] = [],
  ) {
    const skip = (page - 1) * limit;

    // 1 & 2. Fetch candidate pins and user preferences concurrently with Promise.all
    const candidateLimit = Number(process.env.FEED_CANDIDATE_LIMIT) || 1000;
    let preferredCategories: string[] = [];

    const [pins, likes, boardPins] = await Promise.all([
      this.prisma.pin.findMany({
        // Lọc danh mục ngay ở DB: trước đây frontend lọc trên mảng đã tải, nên
        // infinite scroll cứ nạp tiếp trang mới mà không giữ filter — lưới lọc
        // còn vài tấm khiến sentinel luôn nằm trong viewport và kéo cạn feed.
        // Prisma AND các field cùng cấp, nên `category` giao với OR của
        // visibilityFilter đúng như mong đợi.
        //
        // Loại hẳn pin đang bán giá cố định/đấu giá khỏi feed chính — hai loại
        // này giờ chỉ hiện ở trang riêng của chúng (/fixed-price, /auctions).
        // Điều kiện phải khớp CHÍNH XÁC nghịch đảo của marketFieldsFor() ở
        // dưới (FIXED_PRICE = isForSale; AUCTION = có phiên chưa CANCELLED),
        // không chỉ check isForSale, vì một pin có thể có phiên đấu giá dù
        // isForSale đã bị tắt khi phiên được tạo.
        where: {
          ...this.visibilityFilter(userId),
          isForSale: false,
          auctions: { none: { status: { not: 'CANCELLED' } } },
          ...(category ? { category } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: candidateLimit,
        include: {
          user: {
            select: { id: true, username: true, avatarUrl: true, plan: true, isAdmin: true },
          },
          _count: {
            select: { likes: true },
          },
        },
      }),
      userId
        ? this.prisma.like.findMany({
            where: { userId },
            select: { pin: { select: { category: true } } },
          })
        : Promise.resolve([]),
      userId
        ? this.prisma.boardPin.findMany({
            where: { board: { userId } },
            select: { pin: { select: { category: true } } },
          })
        : Promise.resolve([]),
    ]);

    if (userId) {
      try {
        const categories = [
          ...likes.map((l) => l.pin?.category),
          ...boardPins.map((b) => b.pin?.category),
        ].filter(Boolean);

        const counts = categories.reduce(
          (acc, cat) => {
            acc[cat] = (acc[cat] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        preferredCategories = (Object.entries(counts) as [string, number][])
          .sort((a, b) => b[1] - a[1])
          .map((e) => e[0]);
      } catch (err) {
        console.error('Error fetching preferred categories:', err);
      }
    }

    // 3. Sort pins using a score combining preferences, recency, and seeded random noise
    const noiseSeed = seed || 'default-seed';
    const pinsWithScores = pins.map((pin) => {
      let score = 0;

      // Ảnh của chính người xem đăng lên luôn được ưu tiên lên đầu feed —
      // mức cộng vượt xa tổng điểm tối đa các nhánh khác (100 + 96 + 80 =
      // 276) nên không bao giờ bị lấn bởi category/recency/noise, nhưng vẫn
      // giữ đúng thứ tự MỚI NHẤT trước giữa các pin của chính họ (điểm
      // recency/noise bên dưới vẫn cộng thêm phía sau).
      if (userId && pin.userId === userId) {
        score += 10_000;
      }

      // Ảnh liên quan tới từ khoá đã tìm gần đây (gửi lên từ localStorage
      // phía client - xem SearchHistoryService) xếp ngay sau ảnh của chính
      // mình, nhưng vẫn vượt xa category/recency/noise cộng lại (tối đa
      // ~576) nên không bị các nhánh đó lấn thứ tự.
      if (recentSearchTerms.length > 0 && this.matchesRecentSearch(pin, recentSearchTerms)) {
        score += 2_000;
      }

      // Category preference score
      if (preferredCategories.length > 0) {
        const index = preferredCategories.indexOf(pin.category);
        if (index !== -1) {
          // Top preferred categories get the highest bonus
          score += (preferredCategories.length - index) * 100;
        }
      }

      // Recency score (newer pins get a boost, up to 96 points for pins under 48 hours old)
      const ageInHours =
        (Date.now() - new Date(pin.createdAt).getTime()) / (1000 * 60 * 60);
      if (ageInHours < 48) {
        score += (48 - ageInHours) * 2;
      }

      // Seeded random noise (0 to 80 points) to mix/shuffle order on refresh (new seed)
      // while keeping it consistent during infinite scrolling (same seed)
      const noise = this.getPinNoise(pin.id, noiseSeed);
      score += noise * 80;

      return { pin, score };
    });

    pinsWithScores.sort((a, b) => b.score - a.score);
    const sortedPins = pinsWithScores.map((item) => item.pin);

    // 4. Return paginated slice
    return this.attachMarketInfoToList(
      sortedPins.slice(skip, skip + limit),
      userId,
    );
  }

  /** Danh sách công khai cho trang "Giá cố định" riêng — duyệt được không cần
   * đăng nhập, ảnh áp dụng cùng luật bảo vệ (blur/watermark theo gói) như feed
   * chính qua attachMarketInfoToList; chỉ xem CHI TIẾT (getPinById) mới bắt
   * buộc Plus/Pro. `isForSale: true` + không có phiên đấu giá chưa CANCELLED
   * khớp đúng nhánh FIXED_PRICE của marketFieldsFor(). */
  async listFixedPriceForSale(
    viewerId: string | undefined,
    skip: number,
    take: number,
  ) {
    const [pins, total] = await Promise.all([
      this.prisma.pin.findMany({
        where: {
          ...this.visibilityFilter(viewerId),
          isForSale: true,
          auctions: { none: { status: { not: 'CANCELLED' } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: {
            select: { id: true, username: true, avatarUrl: true, plan: true, isAdmin: true },
          },
          _count: { select: { likes: true } },
        },
      }),
      this.prisma.pin.count({
        where: {
          ...this.visibilityFilter(viewerId),
          isForSale: true,
          auctions: { none: { status: { not: 'CANCELLED' } } },
        },
      }),
    ]);
    return {
      items: await this.attachMarketInfoToList(pins, viewerId),
      total,
      skip,
      take,
    };
  }

  async getRelatedPins(
    id: string,
    page: number = 1,
    limit: number = 20,
    viewerId?: string,
  ) {
    const pin = await this.prisma.pin.findUnique({ where: { id } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    const skip = (page - 1) * limit;
    const related = await this.prisma.pin.findMany({
      where: {
        category: pin.category,
        id: { not: id },
        ...this.visibilityFilter(viewerId),
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true, plan: true, isAdmin: true },
        },
        _count: { select: { likes: true } },
      },
    });
    return this.attachMarketInfoToList(related, viewerId);
  }

  /** Prisma `where` fragment that hides pins whose author has a private
   * account from everyone except the author themself and people they've
   * accepted as a follower. Reused by every pin-listing query (feed, search,
   * related) so a private account's pins never surface outside its own
   * profile to non-followers - enforced server-side, not just hidden by CSS. */
  /** Danh mục có thật trong feed người xem được thấy, kèm số pin, nhiều nhất
   * trước. Nguồn duy nhất để frontend dựng chip lọc — nhờ vậy chip ổn định khi
   * cuộn và mọi danh mục đều chọn tới được, kể cả khi pin của nó nằm ở trang
   * chưa tải. */
  async getFeedCategories(
    viewerId?: string,
  ): Promise<{ code: string; count: number }[]> {
    const grouped = await this.prisma.pin.groupBy({
      by: ['category'],
      // Đếm khớp đúng tập pin getAllPins thực sự trả về — loại luôn pin đang
      // bán/đấu giá (giờ chỉ hiện ở trang riêng), không thì chip hiện số đếm
      // cao hơn số pin thật sự bấm vào thấy được.
      where: {
        ...this.visibilityFilter(viewerId),
        isForSale: false,
        auctions: { none: { status: { not: 'CANCELLED' } } },
      },
      _count: { _all: true },
    });

    return grouped
      .filter((row) => !!row.category)
      .map((row) => ({ code: row.category, count: row._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  private visibilityFilter(viewerId?: string) {
    return {
      OR: [
        { user: { isPrivate: false } },
        ...(viewerId
          ? [
              { userId: viewerId },
              { user: { followers: { some: { followerId: viewerId } } } },
            ]
          : []),
      ],
    };
  }

  async getPinById(id: string, viewerId?: string) {
    const pin = await this.prisma.pin.findFirst({
      where: { id, ...this.visibilityFilter(viewerId) },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            bio: true,
            plan: true,
            isAdmin: true,
          },
        },
        likes: {
          where: { userId: viewerId || '__anonymous__' },
          select: { userId: true },
          take: 1,
        },
        _count: { select: { likes: true, comments: true } },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                plan: true,
                isAdmin: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }

    const [auctionMap, viewerStatus, paidPurchase] = await Promise.all([
      this.fetchLatestAuctionsByPinIds([pin.id]),
      viewerId
        ? this.membershipsService.status(viewerId)
        : Promise.resolve({ plan: 'FREE' as const }),
      viewerId
        ? this.prisma.imagePurchase.findFirst({
            where: { pinId: pin.id, buyerId: viewerId, status: 'PAID' },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const auction = auctionMap.get(pin.id);
    const isOwner = viewerId === pin.userId;

    // Đấu giá chỉ dành cho Pro; ảnh giá cố định dành cho Plus/Pro. Dùng
    // status() (tự áp dụng lazy-expiry) thay vì đọc User.plan thô để gói đã hết hạn không
    // còn được ưu tiên. Đây là lớp chặn thật ở backend — frontend chỉ là UX.
    if ((auction || pin.isForSale) && !isOwner) {
      const viewerPlan = viewerStatus.plan;
      if (auction && viewerPlan !== 'PRO') {
        throw new ForbiddenException(
          'Chỉ thành viên Pro mới có thể xem chi tiết tác phẩm đấu giá.',
        );
      }
      if (!auction && viewerPlan !== 'PLUS' && viewerPlan !== 'PRO') {
        throw new ForbiddenException(
          'Chỉ thành viên Plus hoặc Pro mới có thể xem chi tiết tác phẩm bán giá cố định.',
        );
      }
    }

    const { likes, _count, originalStoragePath, ...safePin } = pin;
    // Plan check above only gates whether the *page* can be viewed at all;
    // it doesn't imply a purchase. An eligible-but-not-yet-buying Plus/Pro
    // viewer still only gets the blurred preview, never the real one.
    const imageUrl = await resolveSinglePinImageUrl(
      this.prisma,
      pin,
      viewerId,
      Boolean(auction),
    );
    return {
      ...safePin,
      imageUrl,
      _count,
      likeCount: _count.likes,
      isLiked: likes.length > 0,
      hasPurchased: Boolean(paidPurchase),
      ...this.marketFieldsFor(pin.isForSale, auction),
    };
  }

  async createUploadPin(
    userId: string,
    file: Express.Multer.File,
    title: string,
    description?: string,
    boardId?: string,
    price?: string,
  ) {
    if (boardId) {
      await this.assertOwnedBoard(boardId, userId);
    }
    let salePrice: number | undefined;
    if (price) {
      const ownerStatus = await this.membershipsService.status(userId);
      if (!ownerStatus.canSell) {
        throw new ForbiddenException(
          'Chỉ thành viên Plus hoặc Pro mới có thể bán ảnh giá cố định.',
        );
      }
      const owner = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          payoutBankCode: true,
          payoutAccountNumber: true,
          payoutAccountName: true,
        },
      });
      if (
        !owner?.payoutBankCode ||
        !owner.payoutAccountNumber ||
        !owner.payoutAccountName
      ) {
        throw new BadRequestException(
          'Vui lòng cấu hình thông tin nhận thanh toán trong Cài đặt trước khi bán ảnh.',
        );
      }
      salePrice = Number(price);
      if (
        !Number.isFinite(salePrice) ||
        !Number.isInteger(salePrice) ||
        salePrice < 1000
      ) {
        throw new BadRequestException(
          'Giá ảnh phải là số nguyên VND từ 1.000đ.',
        );
      }
    }

    // Server-side moderation gate — never trust a client-side "safe" check.
    // Runs before the image is uploaded to storage or the Pin is saved.
    const moderation = await this.checkImageModeration(file);
    if (!moderation.safe) {
      throw new BadRequestException(moderation.message);
    }

    const { imageUrl, originalStoragePath, previewStoragePath } =
      await this.storeOriginalAndPreview(
        file.buffer,
        file.mimetype,
        userId,
        'pin',
      );

    const category = this.classifyCategory(title, description);

    // 1. Fetch CLIP embedding (gracefully handled)
    let embedding: number[] | null = null;
    try {
      embedding = await this.getImageEmbedding(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    } catch (e) {
      console.error('Error fetching CLIP embedding for uploaded pin:', e);
    }

    const pin = await (async () => {
      try {
        return await this.prisma.pin.create({
          data: {
            title,
            description,
            imageUrl,
            originalStoragePath,
            userId,
            category,
            price: salePrice,
            isForSale: salePrice !== undefined,
            boardPins: boardId
              ? {
                  create: { boardId },
                }
              : undefined,
          },
        });
      } catch (error) {
        console.error(
          '[PinsService.createUploadPin] Lưu Pin thất bại sau khi đã upload ảnh, đang dọn file mồ côi:',
          error,
        );
        await this.rollbackUploadedImage(
          originalStoragePath,
          previewStoragePath,
        );
        throw new InternalServerErrorException(
          'Không thể lưu tác phẩm lúc này. Vui lòng thử lại.',
        );
      }
    })();

    // 2. If embedding exists, store it using Raw SQL
    if (embedding) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE "id" = $2',
          JSON.stringify(embedding),
          pin.id,
        );
        console.log(`Successfully stored vector embedding for Pin: ${pin.id}`);
      } catch (err) {
        console.error(
          `Failed to store vector embedding for Pin: ${pin.id}`,
          err,
        );
      }
    }

    // 3. Listed for sale right at upload — generate the watermarked
    // preview non-buyers will see immediately, not on the first read.
    if (pin.isForSale) {
      await this.pinPreviewProtection.ensureProtectedPreview(pin.id);
    }

    return pin;
  }

  async saveAiPin(
    userId: string,
    previewUrl: string,
    title: string,
    description?: string,
    boardId?: string,
    promptUsed?: string,
    negativePrompt?: string,
    generationModel?: string,
  ) {
    if (boardId) {
      await this.assertOwnedBoard(boardId, userId);
    }

    // Trừ quota AI nguyên tử ngay tại thời điểm lưu thật - đây là điểm gác cổng
    // duy nhất đáng tin cậy phía backend. Không thể bị bỏ qua bằng cách gọi
    // Pollinations trực tiếp từ trình duyệt rồi chỉ POST endpoint này.
    await this.membershipsService.consumeAi(userId);

    // 1. Download image from temporary url
    const { buffer, contentType } =
      await this.aiGeneratorService.downloadGeneratedImage(previewUrl);

    // Kiểm duyệt NSFW cho ảnh AI giống hệt luồng upload thủ công - trước đây
    // bị bỏ sót, cho phép ảnh AI 18+ lọt qua không qua kiểm duyệt.
    const moderation = await this.moderateImage(
      buffer,
      'ai_pin.png',
      contentType,
    );
    if (moderation.nsfw) {
      throw new BadRequestException(
        'Ảnh có nội dung không phù hợp. Vui lòng thử prompt khác.',
      );
    }

    // 2. Store original (private) + preview (public)
    const { imageUrl, originalStoragePath, previewStoragePath } =
      await this.storeOriginalAndPreview(buffer, contentType, userId, 'ai');

    const category = this.classifyCategory(title, description);

    // 3. Fetch embedding for AI generated image (gracefully handled) - reuse
    // the buffer already downloaded above instead of re-fetching the preview URL.
    let embedding: number[] | null = null;
    try {
      embedding = await this.getImageEmbedding(
        buffer,
        'ai_pin.png',
        contentType,
      );
    } catch (e) {
      console.error('Error fetching CLIP embedding for AI pin:', e);
    }

    // 4. Save to database
    const pin = await (async () => {
      try {
        return await this.prisma.pin.create({
          data: {
            title,
            description,
            imageUrl,
            originalStoragePath,
            userId,
            isAiGenerated: true,
            promptUsed,
            negativePrompt,
            generationModel,
            category,
            boardPins: boardId
              ? {
                  create: { boardId },
                }
              : undefined,
          },
        });
      } catch (error) {
        console.error(
          '[PinsService.saveAiPin] Lưu Pin thất bại sau khi đã upload ảnh, đang dọn file mồ côi:',
          error,
        );
        await this.rollbackUploadedImage(
          originalStoragePath,
          previewStoragePath,
        );
        throw new InternalServerErrorException(
          'Không thể lưu tác phẩm lúc này. Vui lòng thử lại.',
        );
      }
    })();

    // 4. If embedding exists, store it using Raw SQL
    if (embedding) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE "id" = $2',
          JSON.stringify(embedding),
          pin.id,
        );
        console.log(
          `Successfully stored vector embedding for AI Pin: ${pin.id}`,
        );
      } catch (err) {
        console.error(
          `Failed to store vector embedding for AI Pin: ${pin.id}`,
          err,
        );
      }
    }

    return pin;
  }

  async deletePin(id: string, userId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    if (pin.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to delete this pin',
      );
    }

    await this.prisma.pin.delete({ where: { id } });
    return { success: true };
  }

  async toggleLike(pinId: string, userId: string) {
    // Hai lookup độc lập (pin, like hiện có) chạy song song thay vì tuần tự -
    // mỗi round-trip tới Supabase pooler có thể mất hàng trăm ms, gộp lại là
    // nguyên nhân chính khiến nút tim bấm vào cảm giác chậm.
    const [pin, existingLike] = await Promise.all([
      this.prisma.pin.findUnique({
        where: { id: pinId },
        select: { id: true, userId: true },
      }),
      this.prisma.like.findUnique({
        where: { userId_pinId: { userId, pinId } },
      }),
    ]);
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }

    if (existingLike) {
      await this.prisma.like.delete({
        where: {
          userId_pinId: { userId, pinId },
        },
      });
      const likeCount = await this.prisma.like.count({ where: { pinId } });
      return { liked: false, likeCount };
    } else {
      await this.prisma.like.create({
        data: {
          userId,
          pinId,
        },
      });
      const likeCount = await this.prisma.like.count({ where: { pinId } });
      // Unliking never notifies (nothing new happened for the owner to see);
      // only a fresh like does, and never for liking your own pin. Gửi
      // notification không chặn response - client không cần đợi bước này.
      if (pin.userId !== userId) {
        void this.prisma.user
          .findUnique({ where: { id: userId }, select: { username: true } })
          .then((liker) =>
            this.notificationsService.createNotification(
              pin.userId,
              'LIKE',
              `${liker?.username ?? 'Một người dùng'} đã thích ảnh của bạn.`,
              userId,
              pinId,
            ),
          )
          .catch((err) =>
            console.error('Failed to send like notification:', err),
          );
      }
      return { liked: true, likeCount };
    }
  }

  async addComment(pinId: string, userId: string, content: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Comment content cannot be empty');
    }
    const comment = await this.prisma.comment.create({
      data: {
        content,
        pinId,
        userId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            plan: true,
            isAdmin: true,
          },
        },
      },
    });

    if (pin.userId !== userId) {
      await this.notificationsService.createNotification(
        pin.userId,
        'COMMENT',
        `${comment.user.username} đã bình luận về ảnh của bạn.`,
        userId,
        pinId,
      );
    }

    return comment;
  }

  private classifyCategory(title: string, description?: string): string {
    const text = `${title} ${description || ''}`.toLowerCase();

    // 1. Meme / Animals / Pet Memes
    const memeKeywords = [
      'meme',
      'chế',
      'hài hước',
      'funny',
      'chó',
      'cún',
      'dog',
      'puppy',
      'mèo',
      'cat',
      'kitten',
      'boss mèo',
      'pet',
      'thú cưng',
      'ngáo',
      'corgi',
      'husky',
      'pug',
      'sóc',
      'heo con',
      'hamster',
      'alpaca',
      'lạc đà',
    ];
    if (memeKeywords.some((kw) => text.includes(kw))) return 'meme';

    // 2. K-Pop / Idol / Stage
    const kpopKeywords = [
      'kpop',
      'k-pop',
      'idol',
      'stage',
      'sân khấu',
      'biểu diễn',
      'vũ đạo',
      'concert',
      'lightstick',
      'album',
      'blackpink',
      'bts',
      'twice',
      'nữ thần',
      'nam thần',
      'visual',
      'seoul',
      'k-fashion',
    ];
    if (kpopKeywords.some((kw) => text.includes(kw))) return 'kpop';

    // 3. Drawing / Art / Sketch
    const drawingKeywords = [
      'vẽ',
      'drawing',
      'art',
      'sketch',
      'ký họa',
      'phác thảo',
      'tranh',
      'sơn dầu',
      'acrylic',
      'vải canvas',
      'canvas',
      'chì',
      'than chì',
      'charcoal',
      'màu nước',
      'cọ vẽ',
      'bảng vẽ',
      'hội họa',
      'tác phẩm',
      'studio',
      'nét vẽ',
    ];
    if (drawingKeywords.some((kw) => text.includes(kw))) return 'drawing';

    // 4. Anime / Manga / Cyberpunk
    const animeKeywords = [
      'anime',
      'manga',
      'tokyo',
      'cyberpunk',
      'synthwave',
      'hacker',
      'led rgb',
      'game',
      'gaming',
      'wacom',
      'hộp băng',
      'tay cầm',
      'hạ độ',
      'phim hoạt hình',
      'nhân vật hoạt hình',
    ];
    if (animeKeywords.some((kw) => text.includes(kw))) return 'anime';

    // 5. Nature / Landscape
    const natureKeywords = [
      'thiên nhiên',
      'nature',
      'phong cảnh',
      'landscape',
      'bầu trời',
      'hoàng hôn',
      'sunset',
      'biển',
      'beach',
      'rừng',
      'forest',
      'cây',
      'tree',
      'lá phong',
      'hoa',
      'flower',
    ];
    if (natureKeywords.some((kw) => text.includes(kw))) return 'nature';

    // 6. Food / Cooking
    const foodKeywords = [
      'ramen',
      'món ăn',
      'nấu ăn',
      'food',
      'cooking',
      'ẩm thực',
      'ăn uống',
      'quán ăn',
      'bánh',
      'cà phê',
      'coffee',
    ];
    if (foodKeywords.some((kw) => text.includes(kw))) return 'food';

    // 7. Fashion
    const fashionKeywords = [
      'thời trang',
      'fashion',
      'outfit',
      'streetwear',
      'trang phục',
      'makeup',
      'lookbook',
      'phong cách',
      'áo',
    ];
    if (fashionKeywords.some((kw) => text.includes(kw))) return 'fashion';

    return 'other';
  }

  private async assertOwnedBoard(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { userId: true },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (board.userId !== userId) {
      throw new ForbiddenException('You do not own this board');
    }
  }

  private getPinNoise(pinId: string, seed: string): number {
    const combined = pinId + seed;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      hash = (hash << 5) - hash + combined.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash % 1000) / 1000;
  }

  /** Cùng chuẩn so khớp với nhánh fallback từ khoá của searchPins() (title/
   * description contains, không phân biệt hoa thường) — dùng để ưu tiên
   * trong feed những pin liên quan tới từ khoá người xem vừa tìm gần đây,
   * thay vì lặp lại một query CLIP embedding riêng chỉ để chấm điểm. */
  private matchesRecentSearch(
    pin: { title: string; description: string | null; category: string },
    terms: string[],
  ): boolean {
    const haystacks = [pin.title, pin.description ?? '', pin.category]
      .join(' ')
      .toLowerCase();
    return terms.some((term) => {
      const needle = term.trim().toLowerCase();
      return needle.length > 0 && haystacks.includes(needle);
    });
  }

  async searchPins(
    query: string,
    page: number = 1,
    limit: number = 20,
    viewerId?: string,
  ) {
    const skip = (page - 1) * limit;

    // 1. Get text embedding from CLIP service
    const embedding = await this.getTextEmbedding(query);
    if (!embedding) {
      // Fallback: simple text keyword contains query
      const keywordPins = await this.prisma.pin.findMany({
        where: {
          AND: [
            {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
              ],
            },
            this.visibilityFilter(viewerId),
          ],
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, username: true, avatarUrl: true, plan: true, isAdmin: true },
          },
          _count: { select: { likes: true } },
        },
      });
      return this.attachMarketInfoToList(keywordPins, viewerId);
    }

    // 2. Query pgvector for cosine similarity against the search text's embedding
    return this.queryPinsByEmbedding(
      JSON.stringify(embedding),
      null,
      null,
      limit,
      skip,
      false,
      viewerId,
    );
  }

  async getSimilarPins(
    pinId: string,
    page: number = 1,
    limit: number = 20,
    viewerId?: string,
  ) {
    const skip = (page - 1) * limit;

    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }

    // Check if this pin has an embedding
    const rawPinArr = await this.prisma.$queryRawUnsafe<PinEmbeddingRow[]>(
      'SELECT embedding FROM "Pin" WHERE id = $1',
      pinId,
    );
    const embeddingString = rawPinArr[0]?.embedding;

    if (!embeddingString) {
      // Fallback: category-based similar pins
      return this.getRelatedPins(pinId, page, limit, viewerId);
    }

    return this.queryPinsByEmbedding(
      embeddingString,
      pinId,
      pin.imageUrl,
      limit,
      skip,
      false,
      viewerId,
    );
  }

  /** Fetches a pin's own stored image server-side and returns its raw bytes
   * — backs the `:id/image-proxy` route used as a canvas-safe fallback when
   * the CDN doesn't send CORS headers the browser will accept for a
   * cross-origin fetch. Only ever reads a URL already on file for this pin
   * id, never an arbitrary caller-supplied URL — but WHICH URL (real vs
   * watermarked) still has to go through the same commerce gate every
   * other pin-reading path uses, or this route becomes a bypass of all of
   * them (it used to be exactly that: no guard at all, any pinId, real
   * bytes, unconditionally). */
  async getPinImageForProxy(
    pinId: string,
    viewerId?: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const pin = await this.prisma.pin.findUnique({
      where: { id: pinId },
      select: {
        id: true,
        userId: true,
        imageUrl: true,
        protectedImageUrl: true,
        isForSale: true,
      },
    });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    const hasAuction = (await this.fetchLatestAuctionsByPinIds([pin.id])).has(
      pin.id,
    );
    /* Entitlement is decided by WHICH url we resolve, not by rejecting the
       request. The kai branch added a plan check that threw Forbidden here; it
       is dropped for two reasons. It gated on membership plan alone, so a viewer
       who had PAID for the pin would have been refused — and this endpoint is
       the canvas-safe proxy behind the region-select image search, so a 403
       breaks that tool outright for restricted pins instead of letting it work
       on the preview the viewer is allowed to see. resolveSinglePinImageUrl
       already guarantees we never fetch bytes the viewer is not entitled to. */
    const imageUrl = await resolveSinglePinImageUrl(
      this.prisma,
      pin,
      viewerId,
      hasAuction,
    );

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new ServiceUnavailableException('Không thể tải ảnh gốc lúc này.');
      }
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), contentType };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      console.error('Image proxy fetch error:', error);
      throw new ServiceUnavailableException('Không thể tải ảnh gốc lúc này.');
    }
  }

  /** Public, deliberately lossy preview for locked market pins. It never
   * exposes the stored CDN URL and rasterises the blur into the bytes. */
  async getLockedPinPreview(pinId: string): Promise<Buffer> {
    const pin = await this.prisma.pin.findUnique({
      where: { id: pinId },
      select: { imageUrl: true, isForSale: true },
    });
    if (!pin) throw new NotFoundException('Pin not found');

    const auction = (await this.fetchLatestAuctionsByPinIds([pinId])).get(
      pinId,
    );
    if (!auction && !pin.isForSale)
      throw new NotFoundException('Locked preview not found');

    try {
      const response = await fetch(pin.imageUrl);
      if (!response.ok)
        throw new Error(`Image fetch failed (${response.status})`);
      const source = Buffer.from(await response.arrayBuffer());
      return await sharp(source, { limitInputPixels: 60_000_000 })
        .rotate()
        .resize({
          width: 480,
          height: 480,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .blur(24)
        .jpeg({ quality: 52, progressive: true })
        .toBuffer();
    } catch (error) {
      console.error('Locked preview render error:', error);
      throw new ServiceUnavailableException(
        'Không thể tạo ảnh xem trước lúc này.',
      );
    }
  }

  /** Reverse image search: embeds an uploaded image (not yet a saved Pin)
   * via the same CLIP service used for pin uploads, then finds existing
   * Pins with the closest embedding. Returns real database matches only —
   * if the CLIP service is unreachable this throws rather than pretending
   * to have found similar images. */
  /** Moderation gate for images that arrive from OUTSIDE the catalog — reverse
   * image search, and the pin-detail region-crop tool, which posts its crop to
   * the same endpoint. Uploads and AI saves are gated elsewhere; this closes
   * the remaining ingestion path.
   *
   * Deliberately FAILS OPEN, unlike the upload gate. A search stores nothing,
   * so an unscreened image only ever transits the request — whereas failing
   * closed would take the whole search-by-image feature down every time the
   * CLIP service is unreachable. The upload path keeps failing closed, because
   * there the image would be persisted and served to everyone. */
  private async assertSearchImageAllowed(
    file: Express.Multer.File,
  ): Promise<void> {
    let moderation: { nsfw: boolean; nsfwScore: number; topLabel: string };
    try {
      moderation = await this.moderateImage(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    } catch (error) {
      console.error(
        '[moderation] search-by-image check unavailable, allowing the search:',
        error,
      );
      return;
    }

    if (moderation.nsfw) {
      throw new BadRequestException(
        'Ảnh này có nội dung không phù hợp nên không thể dùng để tìm kiếm.',
      );
    }
  }

  async searchPinsByImage(
    file: Express.Multer.File | undefined,
    page: number = 1,
    limit: number = 20,
    viewerId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn một hình ảnh để tìm kiếm');
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Định dạng ảnh không được hỗ trợ. Vui lòng dùng JPG, JPEG, PNG hoặc WebP',
      );
    }

    await this.assertSearchImageAllowed(file);

    const skip = (page - 1) * limit;
    const embedding = await this.getImageEmbedding(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    if (!embedding) {
      throw new ServiceUnavailableException(
        'Dịch vụ tìm kiếm bằng hình ảnh hiện không khả dụng. Vui lòng thử lại sau.',
      );
    }

    return this.queryPinsByEmbedding(
      JSON.stringify(embedding),
      null,
      null,
      limit,
      skip,
      true,
      viewerId,
    );
  }

  /** Shared pgvector cosine-similarity query used by text search, pin-to-pin
   * similarity, and reverse image search. `excludePinId`/`excludeImageUrl`
   * (both from an already-fetched pin) exclude that pin's own image from
   * results — used by getSimilarPins. `applyThreshold` additionally drops
   * results that are too dissimilar to be a real match — used only by
   * reverse image search, where returning "closest but irrelevant" pins is
   * worse than returning fewer/zero results. */
  private async queryPinsByEmbedding(
    vectorString: string,
    excludePinId: string | null,
    excludeImageUrl: string | null,
    limit: number,
    skip: number,
    applyThreshold: boolean,
    viewerId?: string,
  ) {
    // Private-account enforcement in raw SQL, mirroring visibilityFilter():
    // a pin is visible if its author is public, is the viewer themself, or
    // has accepted the viewer as a follower. $N below is bound to viewerId
    // (or NULL for an anonymous caller, which simply never matches).
    const queryLimit = limit * 3;
    const pins: any[] = excludePinId
      ? await this.prisma.$queryRawUnsafe(
          `
        SELECT
          p.id, p.title, p.description, p."imageUrl", p."protectedImageUrl", p."sourceUrl", p."userId", p."createdAt", p."isAiGenerated", p."category",
          p.price, p."isForSale", p.currency,
          u.username AS "authorUsername", u."avatarUrl" AS "authorAvatarUrl", u.plan AS "authorPlan", u."isAdmin" AS "authorIsAdmin",
          COUNT(l."pinId")::int AS "likesCount",
          1 - (p.embedding <=> $1::vector) AS similarity
        FROM "Pin" p
        LEFT JOIN "User" u ON p."userId" = u.id
        LEFT JOIN "Like" l ON p.id = l."pinId"
        WHERE p.id != $2 AND p.embedding IS NOT NULL
          AND (u."isPrivate" = false OR u.id = $3 OR EXISTS (
            SELECT 1 FROM "Follow" f WHERE f."followerId" = $3 AND f."followingId" = u.id
          ))
        GROUP BY p.id, u.username, u."avatarUrl", u.plan, u."isAdmin", u."isPrivate"
        ORDER BY p.embedding <=> $1::vector, p.id
        LIMIT $4 OFFSET $5
      `,
          vectorString,
          excludePinId,
          viewerId ?? null,
          queryLimit,
          skip,
        )
      : await this.prisma.$queryRawUnsafe(
          `
        SELECT
          p.id, p.title, p.description, p."imageUrl", p."protectedImageUrl", p."sourceUrl", p."userId", p."createdAt", p."isAiGenerated", p."category",
          p.price, p."isForSale", p.currency,
          u.username AS "authorUsername", u."avatarUrl" AS "authorAvatarUrl", u.plan AS "authorPlan", u."isAdmin" AS "authorIsAdmin",
          COUNT(l."pinId")::int AS "likesCount",
          1 - (p.embedding <=> $1::vector) AS similarity
        FROM "Pin" p
        LEFT JOIN "User" u ON p."userId" = u.id
        LEFT JOIN "Like" l ON p.id = l."pinId"
        WHERE p.embedding IS NOT NULL
          AND (u."isPrivate" = false OR u.id = $2 OR EXISTS (
            SELECT 1 FROM "Follow" f WHERE f."followerId" = $2 AND f."followingId" = u.id
          ))
        GROUP BY p.id, u.username, u."avatarUrl", u.plan, u."isAdmin", u."isPrivate"
        ORDER BY p.embedding <=> $1::vector, p.id
        LIMIT $3 OFFSET $4
      `,
          vectorString,
          viewerId ?? null,
          queryLimit,
          skip,
        );

    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    if (excludePinId) seenIds.add(excludePinId);
    if (excludeImageUrl) seenUrls.add(excludeImageUrl);

    const uniquePins: SimilarPinRow[] = [];
    for (const p of pins) {
      if (seenIds.has(p.id) || seenUrls.has(p.imageUrl)) continue;
      seenIds.add(p.id);
      seenUrls.add(p.imageUrl);
      uniquePins.push(p);
    }

    // Results already arrive ordered by ascending distance (descending
    // similarity) from the SQL query, so uniquePins[0] is the best match.
    const filteredPins = applyThreshold
      ? this.filterBySimilarityThreshold(uniquePins)
      : uniquePins;

    const page = filteredPins.slice(0, limit);
    const [auctionMap, purchasedIds] = await Promise.all([
      this.fetchLatestAuctionsByPinIds(page.map((p) => p.id)),
      this.fetchPaidPurchasePinIds(
        page.map((p) => p.id),
        viewerId,
      ),
    ]);

    return page.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      imageUrl: resolveViewablePinImageUrl(p, {
        viewerId,
        hasAuction: Boolean(auctionMap.get(p.id)),
        hasPaidPurchase: purchasedIds.has(p.id),
      }),
      sourceUrl: p.sourceUrl,
      userId: p.userId,
      createdAt: p.createdAt,
      isAiGenerated: p.isAiGenerated,
      category: p.category,
      price: p.price,
      isForSale: p.isForSale,
      currency: p.currency,
      ...this.marketFieldsFor(p.isForSale, auctionMap.get(p.id)),
      user: {
        id: p.userId,
        username: p.authorUsername || 'Pinterest AI',
        avatarUrl: p.authorAvatarUrl,
        plan: p.authorPlan ?? 'FREE',
        isAdmin: p.authorIsAdmin ?? false,
      },
      _count: {
        likes: p.likesCount || 0,
      },
      similarity: p.similarity,
    }));
  }

  /** Drops candidates that fail either the absolute similarity floor or the
   * max-gap-from-best rule. Assumes `pins` is already sorted by descending
   * similarity (ascending cosine distance). Returns [] if even the best
   * candidate misses the floor — an empty result is correct there, not a
   * bug to paper over with weaker matches. */
  private filterBySimilarityThreshold(pins: SimilarPinRow[]): SimilarPinRow[] {
    if (pins.length === 0) return [];
    const best = pins[0].similarity;
    if (best < this.imageSearchMinSimilarity) return [];
    return pins.filter(
      (p) =>
        p.similarity >= this.imageSearchMinSimilarity &&
        best - p.similarity <= this.imageSearchMaxSimilarityGap,
    );
  }

  private readEmbedding(value: unknown): number[] | null {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('embedding' in value)
    ) {
      return null;
    }

    const embedding = (value as Partial<EmbeddingResponse>).embedding;
    if (!Array.isArray(embedding) || !embedding.every(Number.isFinite)) {
      return null;
    }

    return embedding;
  }
}
