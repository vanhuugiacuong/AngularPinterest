import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AiGeneratorService } from '../ai-generator/ai-generator.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationService } from '../moderation/moderation.service';
import { PREMIUM_PRICE_MAX, PREMIUM_PRICE_MIN } from '../billing/billing.config';
import {
  VISUAL_CATEGORY_PROMPTS,
  classifyEmbedding,
  MIN_CATEGORY_POOL,
  FLAT_REGION_STD,
  type Classification,
  type VisualCategory,
} from './visual-search';

@Injectable()
export class PinsService {
  private readonly clipServiceUrl = (process.env.CLIP_SERVICE_URL || 'http://127.0.0.1:8001').replace('localhost', '127.0.0.1');

  /** Giá Premium hợp lệ (credit), null nếu không bán. */
  private normalizePremium(isPremium?: boolean, priceCredits?: number): { isPremium: boolean; priceCredits: number | null } {
    if (!isPremium) return { isPremium: false, priceCredits: null };
    const n = Math.round(Number(priceCredits) || 0);
    const price = Math.max(PREMIUM_PRICE_MIN, Math.min(PREMIUM_PRICE_MAX, n));
    return { isPremium: true, priceCredits: price };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly aiGeneratorService: AiGeneratorService,
    private readonly notificationsService: NotificationsService,
    private readonly moderationService: ModerationService,
  ) {}

  /**
   * CLIP embedding + mean RGB colour of an image. When `box` ({x,y,width,height}
   * as 0..1 fractions) is given, clip-service crops the image to that region
   * first and returns data for only the crop — used by crop / "Pinterest Lens"
   * style search. `avgColor` is an explicit colour signal for flat-region crops
   * (CLIP alone barely distinguishes solid colours).
   */
  private async getImageEmbedding(
    buffer: Buffer,
    filename: string,
    mimetype: string,
    box?: { x: number; y: number; width: number; height: number },
  ): Promise<{ embedding: number[]; avgColor: [number, number, number]; colorStd: number } | null> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
      formData.append('file', blob, filename);
      if (box) {
        formData.append('box', `${box.x},${box.y},${box.width},${box.height}`);
      }

      const response = await fetch(`${this.clipServiceUrl}/embed/image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`CLIP image embedding failed: ${response.statusText} - ${errorText}`);
        return null;
      }

      const result = await response.json();
      if (!result?.embedding) return null;
      const c = Array.isArray(result.avg_color) ? result.avg_color : [128, 128, 128];
      return {
        embedding: result.embedding,
        avgColor: [c[0], c[1], c[2]],
        colorStd: typeof result.color_std === 'number' ? result.color_std : 999,
      };
    } catch (error) {
      console.error('CLIP image embedding network error:', error);
      return null;
    }
  }

  private async getTextEmbedding(query: string): Promise<number[] | null> {
    try {
      const response = await fetch(
        `${this.clipServiceUrl}/embed/text?query=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`CLIP text embedding failed: ${response.statusText} - ${errorText}`);
        return null;
      }

      const result = await response.json();
      return result.embedding;
    } catch (error) {
      console.error('CLIP text embedding network error:', error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // "Search by image" — CLIP text prompt vectors for the visual-category
  // classifier (step 1 of the pipeline). Fetched from clip-service once and
  // cached for the process lifetime. See src/pins/visual-search.ts.
  // ---------------------------------------------------------------------------
  private categoryPromptVectorsCache:
    | { category: VisualCategory; vector: number[] }[]
    | null = null;

  private async getCategoryPromptVectors(): Promise<
    { category: VisualCategory; vector: number[] }[] | null
  > {
    if (this.categoryPromptVectorsCache) return this.categoryPromptVectorsCache;
    const vectors: { category: VisualCategory; vector: number[] }[] = [];
    for (const p of VISUAL_CATEGORY_PROMPTS) {
      const vector = await this.getTextEmbedding(p.prompt);
      if (!vector) return null; // clip-service unavailable — caller degrades gracefully
      vectors.push({ category: p.category, vector });
    }
    this.categoryPromptVectorsCache = vectors;
    return vectors;
  }

  /**
   * Best-effort image signals for a freshly-created pin, stored in the
   * (Prisma-external) "visualCategory" and "avgColor" columns so "search by
   * image" can filter/rank on them later.
   */
  private async storePinImageSignals(
    pinId: string,
    embedding: number[],
    avgColor: [number, number, number],
  ) {
    try {
      await this.prisma.$executeRawUnsafe(
        'UPDATE "Pin" SET "avgColor" = $1::vector WHERE id = $2',
        JSON.stringify(avgColor),
        pinId,
      );
      const promptVectors = await this.getCategoryPromptVectors();
      if (!promptVectors) return;
      const { category } = classifyEmbedding(embedding, promptVectors);
      await this.prisma.$executeRawUnsafe(
        'UPDATE "Pin" SET "visualCategory" = $1 WHERE id = $2',
        category,
        pinId,
      );
    } catch (e) {
      console.error(`Failed to store image signals for Pin ${pinId}:`, e);
    }
  }

  async getAllPins(page: number = 1, limit: number = 20, userId?: string, seed?: string) {
    const skip = (page - 1) * limit;

    // 1 & 2. Fetch hidden pins and preferred categories concurrently with Promise.all
    let hiddenPinIds: string[] = [];
    let preferredCategories: string[] = [];

    if (userId) {
      try {
        const [hidden, likes, boardPins, interestSignals] = await Promise.all([
          this.prisma.hiddenPin.findMany({
            where: { userId },
            select: { pinId: true },
          }),
          this.prisma.like.findMany({
            where: { userId },
            select: { pin: { select: { category: true } } },
          }),
          this.prisma.boardPin.findMany({
            where: { board: { userId } },
            select: { pin: { select: { category: true } } },
          }),
          this.prisma.interestSignal.findMany({
            where: { userId },
            select: { category: true },
          }),
        ]);

        hiddenPinIds = hidden.map(h => h.pinId);

        const categories = [
          ...likes.map(l => l.pin?.category),
          ...boardPins.map(b => b.pin?.category),
          ...interestSignals.flatMap(s => [s.category, s.category, s.category]),
        ].filter(Boolean);

        const counts = categories.reduce((acc, cat) => {
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        preferredCategories = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(e => e[0]);
      } catch (err) {
        console.error('Error fetching user feed signals:', err);
      }
    }

    const pins = await this.prisma.pin.findMany({
      where: hiddenPinIds.length > 0 ? { id: { notIn: hiddenPinIds } } : undefined,
      select: { id: true, category: true, createdAt: true },
    });

    // 3. Sort pins using a score combining preferences, recency, and seeded random noise
    const noiseSeed = seed || 'default-seed';
    const pinsWithScores = pins.map(pin => {
      let score = 0;

      // Category preference score
      if (preferredCategories.length > 0) {
        const index = preferredCategories.indexOf(pin.category);
        if (index !== -1) {
          // Top preferred categories get the highest bonus
          score += (preferredCategories.length - index) * 100;
        }
      }

      // Recency score (newer pins get a boost, up to 96 points for pins under 48 hours old)
      const ageInHours = (Date.now() - new Date(pin.createdAt).getTime()) / (1000 * 60 * 60);
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
    const pageIds = pinsWithScores.slice(skip, skip + limit).map(item => item.pin.id);
    if (pageIds.length === 0) return [];

    // 4. Now fetch full details (user, like count) for just this page's pins
    const fullPins = await this.prisma.pin.findMany({
      where: { id: { in: pageIds } },
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true },
        },
        _count: {
          select: { likes: true }
        }
      },
    });

    // findMany({ where: { id: { in } } }) doesn't preserve the `in` array's
    // order, so re-sort the fetched pins back into the ranked order above.
    const pinsById = new Map(fullPins.map(p => [p.id, p]));
    return pageIds.map(id => pinsById.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  }



  async getRelatedPins(id: string, page: number = 1, limit: number = 20) {
    const pin = await this.prisma.pin.findUnique({ where: { id } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    const skip = (page - 1) * limit;
    return this.prisma.pin.findMany({
      where: {
        category: pin.category,
        id: { not: id }
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        _count: { select: { likes: true } }
      }
    });
  }

  async getPinById(id: string) {
    const pin = await this.prisma.pin.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true, bio: true },
        },
        likes: true,
        comments: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
    });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    return pin;
  }

  async createUploadPin(
    userId: string,
    file: Express.Multer.File,
    title: string,
    description?: string,
    boardId?: string,
    isPremium?: boolean,
    priceCredits?: number,
  ) {
    this.moderationService.checkTextIsSafe(title, description);
    await this.moderationService.checkImageIsSafe(file.buffer, file.originalname, file.mimetype);

    const extension = file.originalname.split('.').pop() || 'png';
    const filename = `${userId}/pin_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const imageUrl = await this.supabaseService.uploadImage('pins', filename, file.buffer, file.mimetype);

    const category = this.classifyCategory(title, description);

    // 1. Fetch CLIP embedding + avg colour (gracefully handled)
    let imgData: { embedding: number[]; avgColor: [number, number, number] } | null = null;
    try {
      imgData = await this.getImageEmbedding(file.buffer, file.originalname, file.mimetype);
    } catch (e) {
      console.error('Error fetching CLIP embedding for uploaded pin:', e);
    }

    const premium = this.normalizePremium(isPremium, priceCredits);
    const pin = await this.prisma.pin.create({
      data: {
        title,
        description,
        imageUrl,
        userId,
        category,
        isPremium: premium.isPremium,
        priceCredits: premium.priceCredits,
      },
    });

    // 2. If embedding exists, store it (+ visual category + avg colour) using Raw SQL
    if (imgData) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE "id" = $2',
          JSON.stringify(imgData.embedding),
          pin.id
        );
        console.log(`Successfully stored vector embedding for Pin: ${pin.id}`);
      } catch (err) {
        console.error(`Failed to store vector embedding for Pin: ${pin.id}`, err);
      }
      await this.storePinImageSignals(pin.id, imgData.embedding, imgData.avgColor);
    }

    if (boardId) {
      await this.prisma.boardPin.create({
        data: {
          boardId,
          pinId: pin.id,
        },
      });
    }

    try {
      await this.notificationsService.notifyFollowersOfNewPin(userId, pin.id);
    } catch (err) {
      console.error(`Failed to notify followers of new pin ${pin.id}:`, err);
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
    isPremium?: boolean,
    priceCredits?: number,
  ) {
    // 1. Moderate the AI-generated image before it's persisted anywhere permanent
    this.moderationService.checkTextIsSafe(title, description, promptUsed);
    const previewResponse = await fetch(previewUrl);
    if (previewResponse.ok) {
      const previewBuffer = Buffer.from(await previewResponse.arrayBuffer());
      const contentType = previewResponse.headers.get('Content-Type') || 'image/png';
      await this.moderationService.checkImageIsSafe(previewBuffer, 'ai_pin.png', contentType);
    }

    // 2. Download image from temporary url and upload to permanent pins bucket
    const imageUrl = await this.aiGeneratorService.saveAiImageToStorage(previewUrl, userId);

    const category = this.classifyCategory(title, description);

    // 3. Fetch embedding + avg colour for AI generated image (gracefully handled)
    let imgData: { embedding: number[]; avgColor: [number, number, number] } | null = null;
    try {
      const response = await fetch(imageUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('Content-Type') || 'image/png';
        imgData = await this.getImageEmbedding(buffer, 'ai_pin.png', contentType);
      }
    } catch (e) {
      console.error('Error fetching CLIP embedding for AI pin:', e);
    }

    // 4. Save to database
    const premium = this.normalizePremium(isPremium, priceCredits);
    const pin = await this.prisma.pin.create({
      data: {
        title,
        description,
        imageUrl,
        userId,
        isAiGenerated: true,
        promptUsed,
        negativePrompt,
        generationModel,
        category,
        isPremium: premium.isPremium,
        priceCredits: premium.priceCredits,
      },
    });

    // 5. If embedding exists, store it (+ visual category + avg colour) using Raw SQL
    if (imgData) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE "id" = $2',
          JSON.stringify(imgData.embedding),
          pin.id
        );
        console.log(`Successfully stored vector embedding for AI Pin: ${pin.id}`);
      } catch (err) {
        console.error(`Failed to store vector embedding for AI Pin: ${pin.id}`, err);
      }
      await this.storePinImageSignals(pin.id, imgData.embedding, imgData.avgColor);
    }

    // 6. Connect to board if provided
    if (boardId) {
      await this.prisma.boardPin.create({
        data: {
          boardId,
          pinId: pin.id,
        },
      });
    }

    // 7. Notify followers of the new pin
    try {
      await this.notificationsService.notifyFollowersOfNewPin(userId, pin.id);
    } catch (err) {
      console.error(`Failed to notify followers of new AI pin ${pin.id}:`, err);
    }

    return pin;
  }

  async deletePin(id: string, userId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    if (pin.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this pin');
    }

    await this.prisma.pin.delete({ where: { id } });
    return { success: true };
  }

  async toggleLike(pinId: string, userId: string) {
    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_pinId: { userId, pinId },
      },
      select: { userId: true },
    });

    if (existingLike) {
      await this.prisma.like.delete({
        where: {
          userId_pinId: { userId, pinId },
        },
      });
      return { liked: false };
    } else {
      await this.prisma.like.create({
        data: {
          userId,
          pinId,
        },
      });

      // Fire notification in background asynchronously so API response returns instantly
      this.prisma.pin.findUnique({ where: { id: pinId }, select: { userId: true } }).then(pin => {
        if (pin && pin.userId !== userId) {
          this.notificationsService.create(pin.userId, userId, 'like', pinId).catch(() => {});
        }
      }).catch(() => {});

      return { liked: true };
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
        user: { select: { id: true, username: true, avatarUrl: true } }
      }
    });

    await this.notificationsService.create(
      pin.userId,
      userId,
      'comment',
      pinId,
      content.trim().slice(0, 140),
    );

    return comment;
  }

  /** "Ẩn bớt" — removes this pin from the user's own feed going forward. */
  async hidePin(pinId: string, userId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    await this.prisma.hiddenPin.upsert({
      where: { userId_pinId: { userId, pinId } },
      update: {},
      create: { userId, pinId },
    });
    return { success: true };
  }

  /** "Báo cáo Ghim" — persisted for later review, no auto-moderation action. */
  async reportPin(pinId: string, userId: string, reason?: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    await this.prisma.pinReport.create({
      data: { pinId, userId, reason: reason?.trim().slice(0, 500) || null },
    });
    return { success: true };
  }

  /** "Xem thêm" — explicit "show more like this" signal, boosts this pin's
   * category in future feed ranking for the user (see getAllPins). */
  async markInterest(pinId: string, userId: string) {
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    await this.prisma.interestSignal.upsert({
      where: { userId_pinId: { userId, pinId } },
      update: { category: pin.category },
      create: { userId, pinId, category: pin.category },
    });
    return { success: true };
  }

  private classifyCategory(title: string, description?: string): string {
    const text = `${title} ${description || ''}`.toLowerCase();

    // 1. Meme / Animals / Pet Memes
    const memeKeywords = ['meme', 'chế', 'hài hước', 'funny', 'chó', 'cún', 'dog', 'puppy', 'mèo', 'cat', 'kitten', 'boss mèo', 'pet', 'thú cưng', 'ngáo', 'corgi', 'husky', 'pug', 'sóc', 'heo con', 'hamster', 'alpaca', 'lạc đà'];
    if (memeKeywords.some(kw => text.includes(kw))) return 'meme';

    // 2. K-Pop / Idol / Stage
    const kpopKeywords = ['kpop', 'k-pop', 'idol', 'stage', 'sân khấu', 'biểu diễn', 'vũ đạo', 'concert', 'lightstick', 'album', 'blackpink', 'bts', 'twice', 'nữ thần', 'nam thần', 'visual', 'seoul', 'k-fashion'];
    if (kpopKeywords.some(kw => text.includes(kw))) return 'kpop';

    // 3. Drawing / Art / Sketch
    const drawingKeywords = ['vẽ', 'drawing', 'art', 'sketch', 'ký họa', 'phác thảo', 'tranh', 'sơn dầu', 'acrylic', 'vải canvas', 'canvas', 'chì', 'than chì', 'charcoal', 'màu nước', 'cọ vẽ', 'bảng vẽ', 'hội họa', 'tác phẩm', 'studio', 'nét vẽ'];
    if (drawingKeywords.some(kw => text.includes(kw))) return 'drawing';

    // 4. Anime / Manga / Cyberpunk
    const animeKeywords = ['anime', 'manga', 'tokyo', 'cyberpunk', 'synthwave', 'hacker', 'led rgb', 'game', 'gaming', 'wacom', 'hộp băng', 'tay cầm', 'hạ độ', 'phim hoạt hình', 'nhân vật hoạt hình'];
    if (animeKeywords.some(kw => text.includes(kw))) return 'anime';

    // 5. Nature / Landscape
    const natureKeywords = ['thiên nhiên', 'nature', 'phong cảnh', 'landscape', 'bầu trời', 'hoàng hôn', 'sunset', 'biển', 'beach', 'rừng', 'forest', 'cây', 'tree', 'lá phong', 'hoa', 'flower'];
    if (natureKeywords.some(kw => text.includes(kw))) return 'nature';

    // 6. Food / Cooking
    const foodKeywords = ['ramen', 'món ăn', 'nấu ăn', 'food', 'cooking', 'ẩm thực', 'ăn uống', 'quán ăn', 'bánh', 'cà phê', 'coffee'];
    if (foodKeywords.some(kw => text.includes(kw))) return 'food';

    // 7. Fashion
    const fashionKeywords = ['thời trang', 'fashion', 'outfit', 'streetwear', 'trang phục', 'makeup', 'lookbook', 'phong cách', 'áo'];
    if (fashionKeywords.some(kw => text.includes(kw))) return 'fashion';

    return 'other';
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

  async searchPins(query: string, page: number = 1, limit: number = 30) {
    const needle = query ? query.trim() : '';
    if (!needle) {
      return [];
    }

    const skip = (page - 1) * limit;

    // 1. Get text embedding from CLIP service
    const embedding = await this.getTextEmbedding(needle);
    if (!embedding) {
      // Fallback: simple text keyword contains query
      return this.prisma.pin.findMany({
        where: {
          OR: [
            { title: { contains: needle, mode: 'insensitive' } },
            { description: { contains: needle, mode: 'insensitive' } },
            { category: { contains: needle, mode: 'insensitive' } },
            { user: { username: { contains: needle, mode: 'insensitive' } } },
          ],
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
          _count: { select: { likes: true } }
        }
      });
    }

    // 2. Query pgvector using Raw SQL for cosine similarity
    const vectorString = JSON.stringify(embedding);
    const queryLimit = limit * 2;
    const pins: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        p.id, p.title, p.description, p."imageUrl", p."sourceUrl", p."userId", p."createdAt", p."isAiGenerated", p."category",
        u.username AS "authorUsername", u."avatarUrl" AS "authorAvatarUrl",
        COUNT(l."pinId")::int AS "likesCount",
        1 - (p.embedding <=> $1::vector) AS similarity
      FROM "Pin" p
      LEFT JOIN "User" u ON p."userId" = u.id
      LEFT JOIN "Like" l ON p.id = l."pinId"
      WHERE p.embedding IS NOT NULL
      GROUP BY p.id, u.username, u."avatarUrl"
      ORDER BY p.embedding <=> $1::vector
      LIMIT $2 OFFSET $3
    `, vectorString, queryLimit, skip);

    const seenUrls = new Set<string>();
    const uniquePins: any[] = [];
    for (const p of pins) {
      if (!seenUrls.has(p.imageUrl)) {
        seenUrls.add(p.imageUrl);
        uniquePins.push(p);
      }
    }

    return uniquePins.slice(0, limit).map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl,
      sourceUrl: p.sourceUrl,
      userId: p.userId,
      createdAt: p.createdAt,
      isAiGenerated: p.isAiGenerated,
      category: p.category,
      user: {
        id: p.userId,
        username: p.authorUsername || 'Pinterest AI',
        avatarUrl: p.authorAvatarUrl,
      },
      _count: {
        likes: p.likesCount || 0
      },
      similarity: p.similarity
    }));
  }

  /**
   * Reverse image search, mirroring Pinterest's visual search but scaled down to
   * the seed dataset. Pipeline:
   *   1. classify the query image into a visual category (CLIP zero-shot)
   *   2. embed the query image (CLIP image embedding)
   *   3. filter pins to that category, score by cosine similarity
   *   4. blend a small popularity signal into the ranking
   *   5. if the category pool is tiny, log it — never pad with other categories
   */
  async searchByImage(file: Express.Multer.File, page: number = 1, limit: number = 30) {
    if (!file) {
      throw new BadRequestException('Thiếu ảnh để tìm kiếm.');
    }

    // Step 2: embed the whole uploaded image
    const query = await this.getImageEmbedding(file.buffer, file.originalname, file.mimetype);
    if (!query) {
      throw new BadRequestException('Không thể xử lý ảnh, vui lòng thử lại.');
    }

    // Whole-image search always filters by category (even low-confidence) so the
    // result set never mixes object types.
    return this.matchByEmbedding(query, {
      page,
      limit,
      categoryFilter: 'always',
      logTag: 'searchByImage',
    });
  }

  /**
   * Crop / "Pinterest Lens" style search: embed only the selected region of an
   * existing pin's image and match against it.
   *
   * `box` is {x,y,width,height} as 0..1 fractions of the pin image. A vague crop
   * (small patch of colour/texture) is classified with low confidence, so we
   * skip category filtering and let colour/texture similarity drive the ranking.
   */
  async searchByImageRegion(
    pinId: string,
    box: { x: number; y: number; width: number; height: number },
    page: number = 1,
    limit: number = 30,
  ) {
    const norm = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : NaN;
    };
    const b = { x: norm(box?.x), y: norm(box?.y), width: norm(box?.width), height: norm(box?.height) };
    if ([b.x, b.y, b.width, b.height].some((n) => Number.isNaN(n)) || b.width <= 0 || b.height <= 0) {
      throw new BadRequestException('Vùng chọn không hợp lệ.');
    }

    const pin = await this.prisma.pin.findUnique({ where: { id: pinId }, select: { id: true, imageUrl: true } });
    if (!pin) {
      throw new NotFoundException('Không tìm thấy ảnh.');
    }

    let imageBytes: Buffer;
    try {
      const res = await fetch(pin.imageUrl);
      if (!res.ok) throw new Error(`download ${res.status}`);
      imageBytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.error(`[searchByImageRegion] could not fetch source image for pin ${pinId}:`, e);
      throw new BadRequestException('Không thể tải ảnh gốc để cắt vùng.');
    }

    // Step 2: embed ONLY the cropped region (clip-service does the crop) + its avg colour
    const query = await this.getImageEmbedding(imageBytes, 'region.jpg', 'image/jpeg', b);
    if (!query) {
      throw new BadRequestException('Không thể xử lý vùng ảnh đã chọn, vui lòng thử lại.');
    }

    return this.matchByEmbedding(query, {
      page,
      limit,
      categoryFilter: 'confident-only',
      excludeImageUrl: pin.imageUrl,
      logTag: `searchByImageRegion(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.width.toFixed(2)},${b.height.toFixed(2)})`,
    });
  }

  /**
   * Shared matching pipeline for both whole-image and crop search.
   *  - Step 1: classify the query embedding into a visual category.
   *  - Step 3: filter pins to that category (see `categoryFilter`), score by cosine.
   *  - Step 4: rank = similarity + a capped popularity bonus. For a crop that has
   *    no recognisable object (flat colour / texture), rank is instead driven by
   *    average-colour proximity — CLIP alone barely distinguishes solid colours.
   *  - Step 5: if the category pool is tiny, log it and return the short set.
   */
  private async matchByEmbedding(
    query: { embedding: number[]; avgColor: [number, number, number]; colorStd?: number },
    opts: {
      page: number;
      limit: number;
      /** 'always' = filter even when low-confidence; 'confident-only' = only filter a clearly-recognised query. */
      categoryFilter: 'always' | 'confident-only';
      /** drop the query's own image (and its duplicates) from the results */
      excludeImageUrl?: string;
      logTag: string;
    },
  ) {
    const { embedding, avgColor } = query;
    const { page, limit, categoryFilter, excludeImageUrl, logTag } = opts;
    const skip = (page - 1) * limit;

    // A near-solid patch: CLIP is blind to hue here, so however the (weak) CLIP
    // signal classifies it, ignore that and rank by colour.
    const isFlatRegion =
      categoryFilter === 'confident-only' &&
      typeof query.colorStd === 'number' &&
      query.colorStd < FLAT_REGION_STD;

    // --- Step 1: classify --------------------------------------------------
    let queryCategory: VisualCategory | null = null;
    let recognisedObject = true;
    const promptVectors = await this.getCategoryPromptVectors();
    if (promptVectors) {
      const c: Classification = classifyEmbedding(embedding, promptVectors);
      const top2 = c.perCategory.slice(0, 2).map(p => `${p.category} ${p.score.toFixed(3)}`).join(', ');
      const shouldFilter = categoryFilter === 'always' ? true : (c.confident && !isFlatRegion);
      queryCategory = shouldFilter ? c.category : null;
      recognisedObject = c.confident && !isFlatRegion;
      console.log(
        `[${logTag}] category=${c.category} margin=${c.margin.toFixed(3)} score=${c.score.toFixed(3)} ` +
        `confident=${c.confident} std=${query.colorStd ?? 'n/a'} -> ${queryCategory ? `filter "${queryCategory}"` : 'NO filter (colour/texture match)'} (${top2})`,
      );
    } else {
      console.warn(`[${logTag}] clip-service unavailable for classification — ranking by similarity only`);
    }

    // A crop with no recognisable object → rank by colour proximity, not CLIP
    // (which treats every flat colour as roughly the same).
    const colourMode = categoryFilter === 'confident-only' && !recognisedObject;
    if (colourMode) {
      console.log(
        `[${logTag}] ${isFlatRegion ? 'flat colour patch' : 'texture crop'} — ranking by average colour (query rgb ${avgColor.join(',')})`,
      );
    }

    // --- Step 5 (pre-check): category pool size ---------------------------
    if (queryCategory) {
      const poolRows: { n: number }[] = await this.prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "Pin" WHERE embedding IS NOT NULL AND "visualCategory" = $1`,
        queryCategory,
      );
      const pool = poolRows[0]?.n ?? 0;
      if (pool < MIN_CATEGORY_POOL) {
        console.warn(
          `[${logTag}] category "${queryCategory}" only has ${pool} embedded pin(s) (< ${MIN_CATEGORY_POOL}). ` +
          `Returning a short result set — NOT padding with other categories.`,
        );
      }
    }

    // --- Steps 3 + 4: filter + rank --------------------------------------
    const params: any[] = [JSON.stringify(embedding)];
    const conds = ['p.embedding IS NOT NULL'];
    if (queryCategory) {
      conds.push(`p."visualCategory" = $${params.push(queryCategory)}`);
    }
    if (excludeImageUrl) {
      conds.push(`p."imageUrl" <> $${params.push(excludeImageUrl)}`);
    }

    // clipSim in [0,1]; popularity bonus up to +0.03; colourSim in [0,1]
    const clipSim = `(1 - (p.embedding <=> $1::vector))`;
    const popBonus = `LEAST(COUNT(l."pinId"), 20) * 0.0015`;
    let orderBy: string;
    if (colourMode) {
      // 441.673 = max euclidean distance in 0-255 RGB space (sqrt(3 * 255^2))
      const colourParam = params.push(JSON.stringify(avgColor));
      conds.push(`p."avgColor" IS NOT NULL`);
      const colourSim = `(1 - LEAST((p."avgColor" <-> $${colourParam}::vector) / 441.673, 1))`;
      // flat patch: CLIP is useless, lean hard on colour. texture crop: CLIP
      // still carries pattern info, so give it a bit more weight.
      const [wColour, wClip] = isFlatRegion ? [0.85, 0.15] : [0.6, 0.4];
      orderBy = `${colourSim} * ${wColour} + ${clipSim} * ${wClip} + ${popBonus}`;
    } else {
      orderBy = `${clipSim} + ${popBonus}`;
    }

    const limitParam = params.push(limit * 2);
    const skipParam = params.push(skip);

    const pins: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        p.id, p.title, p.description, p."imageUrl", p."sourceUrl", p."userId", p."createdAt", p."isAiGenerated", p."category", p."visualCategory",
        (p."avgColor"::text) AS "avgColorText",
        u.username AS "authorUsername", u."avatarUrl" AS "authorAvatarUrl",
        COUNT(l."pinId")::int AS "likesCount",
        1 - (p.embedding <=> $1::vector) AS similarity
      FROM "Pin" p
      LEFT JOIN "User" u ON p."userId" = u.id
      LEFT JOIN "Like" l ON p.id = l."pinId"
      WHERE ${conds.join(' AND ')}
      GROUP BY p.id, u.username, u."avatarUrl"
      ORDER BY ${orderBy} DESC
      LIMIT $${limitParam} OFFSET $${skipParam}
    `, ...params);

    const seenUrls = new Set<string>();
    const uniquePins: any[] = [];
    for (const p of pins) {
      if (!seenUrls.has(p.imageUrl)) {
        seenUrls.add(p.imageUrl);
        uniquePins.push(p);
      }
    }

    if (queryCategory && uniquePins.length < MIN_CATEGORY_POOL) {
      console.warn(`[${logTag}] only ${uniquePins.length} result(s) for category "${queryCategory}".`);
    }

    return uniquePins.slice(0, limit).map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl,
      sourceUrl: p.sourceUrl,
      userId: p.userId,
      createdAt: p.createdAt,
      isAiGenerated: p.isAiGenerated,
      category: p.category,
      visualCategory: p.visualCategory,
      user: {
        id: p.userId,
        username: p.authorUsername || 'Pinterest AI',
        avatarUrl: p.authorAvatarUrl,
      },
      _count: {
        likes: p.likesCount || 0
      },
      similarity: p.similarity,
      avgColor: p.avgColorText
        ? (p.avgColorText.replace(/[[\]]/g, '').split(',').map(Number))
        : null,
    }));
  }

  async getSimilarPins(pinId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }

    // Check if this pin has an embedding
    const rawPinArr: any[] = await this.prisma.$queryRawUnsafe(
      'SELECT embedding FROM "Pin" WHERE id = $1',
      pinId
    );
    const hasEmbedding = rawPinArr.length > 0 && rawPinArr[0].embedding !== null;

    if (!hasEmbedding) {
      // Fallback: category-based similar pins
      return this.getRelatedPins(pinId, page, limit);
    }

    const embeddingString = rawPinArr[0].embedding;
    const queryLimit = limit * 2;

    // Query pgvector using Raw SQL for cosine similarity relative to this pin's embedding
    const pins: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        p.id, p.title, p.description, p."imageUrl", p."sourceUrl", p."userId", p."createdAt", p."isAiGenerated", p."category",
        u.username AS "authorUsername", u."avatarUrl" AS "authorAvatarUrl",
        COUNT(l."pinId")::int AS "likesCount",
        1 - (p.embedding <=> $1::vector) AS similarity
      FROM "Pin" p
      LEFT JOIN "User" u ON p."userId" = u.id
      LEFT JOIN "Like" l ON p.id = l."pinId"
      WHERE p.id != $2 AND p.embedding IS NOT NULL
      GROUP BY p.id, u.username, u."avatarUrl"
      ORDER BY p.embedding <=> $1::vector
      LIMIT $3 OFFSET $4
    `, embeddingString, pinId, queryLimit, skip);

    const seenUrls = new Set<string>();
    // Exclude the current pin's image from similar results
    seenUrls.add(pin.imageUrl);

    const uniquePins: any[] = [];
    for (const p of pins) {
      if (!seenUrls.has(p.imageUrl)) {
        seenUrls.add(p.imageUrl);
        uniquePins.push(p);
      }
    }

    return uniquePins.slice(0, limit).map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl,
      sourceUrl: p.sourceUrl,
      userId: p.userId,
      createdAt: p.createdAt,
      isAiGenerated: p.isAiGenerated,
      category: p.category,
      user: {
        id: p.userId,
        username: p.authorUsername || 'Pinterest AI',
        avatarUrl: p.authorAvatarUrl,
      },
      _count: {
        likes: p.likesCount || 0
      },
      similarity: p.similarity
    }));
  }
}
