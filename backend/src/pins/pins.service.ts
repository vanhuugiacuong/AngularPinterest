import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AiGeneratorService } from '../ai-generator/ai-generator.service';

@Injectable()
export class PinsService {
  private readonly clipServiceUrl = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly aiGeneratorService: AiGeneratorService,
  ) {}

  private async getImageEmbedding(buffer: Buffer, filename: string, mimetype: string): Promise<number[] | null> {
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
        console.error(`CLIP image embedding failed: ${response.statusText} - ${errorText}`);
        return null;
      }

      const result = await response.json();
      return result.embedding;
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
    const moderation = await this.moderateImage(file.buffer, file.originalname, file.mimetype);
    if (moderation.nsfw) {
      return {
        safe: false,
        message:
          'Ảnh có thể chứa nội dung không phù hợp hoặc nội dung 18+. Vui lòng chọn ảnh khác.',
      };
    }
    return { safe: true };
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

  async getAllPins(
    page: number = 1,
    limit: number = 20,
    userId?: string,
    seed?: string,
  ) {
    const skip = (page - 1) * limit;

    // 1. Fetch all pins with user and like counts
    const pins = await this.prisma.pin.findMany({
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true },
        },
        _count: {
          select: { likes: true },
        },
      },
    });

    // 2. Fetch user's preferred categories based on likes & board saves
    let preferredCategories: string[] = [];
    if (userId) {
      try {
        const likes = await this.prisma.like.findMany({
          where: { userId },
          include: { pin: { select: { category: true } } },
        });
        const boardPins = await this.prisma.boardPin.findMany({
          where: { board: { userId } },
          include: { pin: { select: { category: true } } },
        });
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

        preferredCategories = Object.entries(counts)
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
    return sortedPins.slice(skip, skip + limit);
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
        id: { not: id },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        _count: { select: { likes: true } },
      },
    });
  }

  async getPinById(id: string, viewerId?: string) {
    const pin = await this.prisma.pin.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true, bio: true },
        },
        likes: {
          where: { userId: viewerId || '__anonymous__' },
          select: { userId: true },
          take: 1,
        },
        _count: { select: { likes: true, comments: true } },
        comments: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }
    const { likes, _count, ...safePin } = pin;
    return {
      ...safePin,
      _count,
      likeCount: _count.likes,
      isLiked: likes.length > 0,
    };
  }

  async createUploadPin(
    userId: string,
    file: Express.Multer.File,
    title: string,
    description?: string,
    boardId?: string,
  ) {
    if (boardId) {
      await this.assertOwnedBoard(boardId, userId);
    }

    // Server-side moderation gate — never trust a client-side "safe" check.
    // Runs before the image is uploaded to storage or the Pin is saved.
    const moderation = await this.checkImageModeration(file);
    if (!moderation.safe) {
      throw new BadRequestException(moderation.message);
    }

    const extension = file.originalname.split('.').pop() || 'png';
    const filename = `${userId}/pin_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const imageUrl = await this.supabaseService.uploadImage(
      'pins',
      filename,
      file.buffer,
      file.mimetype,
    );

    const category = this.classifyCategory(title, description);

    // 1. Fetch CLIP embedding (gracefully handled)
    let embedding: number[] | null = null;
    try {
      embedding = await this.getImageEmbedding(file.buffer, file.originalname, file.mimetype);
    } catch (e) {
      console.error('Error fetching CLIP embedding for uploaded pin:', e);
    }

    const pin = await this.prisma.pin.create({
      data: {
        title,
        description,
        imageUrl,
        userId,
        category,
        boardPins: boardId
          ? {
              create: { boardId },
            }
          : undefined,
      },
    });

    // 2. If embedding exists, store it using Raw SQL
    if (embedding) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE "id" = $2',
          JSON.stringify(embedding),
          pin.id
        );
        console.log(`Successfully stored vector embedding for Pin: ${pin.id}`);
      } catch (err) {
        console.error(`Failed to store vector embedding for Pin: ${pin.id}`, err);
      }
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

    // 1. Download image from temporary url and upload to permanent pins bucket
    const imageUrl = await this.aiGeneratorService.saveAiImageToStorage(
      previewUrl,
      userId,
    );

    const category = this.classifyCategory(title, description);

    // 2. Fetch embedding for AI generated image (gracefully handled)
    let embedding: number[] | null = null;
    try {
      const response = await fetch(imageUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('Content-Type') || 'image/png';
        embedding = await this.getImageEmbedding(buffer, 'ai_pin.png', contentType);
      }
    } catch (e) {
      console.error('Error fetching CLIP embedding for AI pin:', e);
    }

    // 3. Save to database
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
        boardPins: boardId
          ? {
              create: { boardId },
            }
          : undefined,
      },
    });

    // 4. If embedding exists, store it using Raw SQL
    if (embedding) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE "id" = $2',
          JSON.stringify(embedding),
          pin.id
        );
        console.log(`Successfully stored vector embedding for AI Pin: ${pin.id}`);
      } catch (err) {
        console.error(`Failed to store vector embedding for AI Pin: ${pin.id}`, err);
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
    const pin = await this.prisma.pin.findUnique({
      where: { id: pinId },
      select: { id: true },
    });
    if (!pin) {
      throw new NotFoundException('Pin not found');
    }

    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_pinId: { userId, pinId },
      },
    });

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
    return this.prisma.comment.create({
      data: {
        content,
        pinId,
        userId,
      },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });
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

  async searchPins(query: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    // 1. Get text embedding from CLIP service
    const embedding = await this.getTextEmbedding(query);
    if (!embedding) {
      // Fallback: simple text keyword contains query
      return this.prisma.pin.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
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

    // 2. Query pgvector for cosine similarity against the search text's embedding
    return this.queryPinsByEmbedding(JSON.stringify(embedding), null, null, limit, skip);
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

    return this.queryPinsByEmbedding(rawPinArr[0].embedding, pinId, pin.imageUrl, limit, skip);
  }

  /** Reverse image search: embeds an uploaded image (not yet a saved Pin)
   * via the same CLIP service used for pin uploads, then finds existing
   * Pins with the closest embedding. Returns real database matches only —
   * if the CLIP service is unreachable this throws rather than pretending
   * to have found similar images. */
  async searchPinsByImage(file: Express.Multer.File | undefined, page: number = 1, limit: number = 20) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn một hình ảnh để tìm kiếm');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Định dạng ảnh không được hỗ trợ. Vui lòng dùng JPG, JPEG, PNG hoặc WebP',
      );
    }

    const skip = (page - 1) * limit;
    const embedding = await this.getImageEmbedding(file.buffer, file.originalname, file.mimetype);
    if (!embedding) {
      throw new ServiceUnavailableException(
        'Dịch vụ tìm kiếm bằng hình ảnh hiện không khả dụng. Vui lòng thử lại sau.',
      );
    }

    return this.queryPinsByEmbedding(JSON.stringify(embedding), null, null, limit, skip);
  }

  /** Shared pgvector cosine-similarity query used by text search, pin-to-pin
   * similarity, and reverse image search. `excludePinId`/`excludeImageUrl`
   * (both from an already-fetched pin) exclude that pin's own image from
   * results — used by getSimilarPins. */
  private async queryPinsByEmbedding(
    vectorString: string,
    excludePinId: string | null,
    excludeImageUrl: string | null,
    limit: number,
    skip: number,
  ) {
    const queryLimit = limit * 2;
    const pins: any[] = excludePinId
      ? await this.prisma.$queryRawUnsafe(`
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
      `, vectorString, excludePinId, queryLimit, skip)
      : await this.prisma.$queryRawUnsafe(`
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
    if (excludeImageUrl) {
      seenUrls.add(excludeImageUrl);
    }

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
