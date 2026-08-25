import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AiGeneratorService } from '../ai-generator/ai-generator.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationService } from '../moderation/moderation.service';

@Injectable()
export class PinsService {
  private readonly clipServiceUrl = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly aiGeneratorService: AiGeneratorService,
    private readonly notificationsService: NotificationsService,
    private readonly moderationService: ModerationService,
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

  async getAllPins(page: number = 1, limit: number = 20, userId?: string, seed?: string) {
    const skip = (page - 1) * limit;

    // Pins this user hid via "Ẩn bớt" never enter their feed again
    let hiddenPinIds: string[] = [];
    if (userId) {
      const hidden = await this.prisma.hiddenPin.findMany({
        where: { userId },
        select: { pinId: true },
      });
      hiddenPinIds = hidden.map(h => h.pinId);
    }

    // 1. Fetch only the fields needed to rank pins (id/category/createdAt) —
    // ranking has to see every pin to sort them, but loading the full
    // user/likes relations for all of them (only ~`limit` are ever kept)
    // makes every scroll page slower as the table grows. That heavier
    // fetch happens below, scoped to just this page's pins.
    const pins = await this.prisma.pin.findMany({
      where: hiddenPinIds.length > 0 ? { id: { notIn: hiddenPinIds } } : undefined,
      select: { id: true, category: true, createdAt: true },
    });

    // 2. Fetch user's preferred categories based on likes, board saves, and
    // explicit "Xem thêm" interest signals
    let preferredCategories: string[] = [];
    if (userId) {
      try {
        const likes = await this.prisma.like.findMany({
          where: { userId },
          include: { pin: { select: { category: true } } }
        });
        const boardPins = await this.prisma.boardPin.findMany({
          where: { board: { userId } },
          include: { pin: { select: { category: true } } }
        });
        const interestSignals = await this.prisma.interestSignal.findMany({
          where: { userId },
          select: { category: true },
        });
        const categories = [
          ...likes.map(l => l.pin?.category),
          ...boardPins.map(b => b.pin?.category),
          // Weighted higher: an explicit "more like this" click is a
          // stronger signal than the side effect of liking/saving one pin
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
        console.error('Error fetching preferred categories:', err);
      }
    }

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
  ) {
    this.moderationService.checkTextIsSafe(title, description);
    await this.moderationService.checkImageIsSafe(file.buffer, file.originalname, file.mimetype);

    const extension = file.originalname.split('.').pop() || 'png';
    const filename = `${userId}/pin_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const imageUrl = await this.supabaseService.uploadImage('pins', filename, file.buffer, file.mimetype);

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

    // 3. Fetch embedding for AI generated image (gracefully handled)
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

    // 4. Save to database
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
      },
    });

    // 5. If embedding exists, store it using Raw SQL
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

      const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
      if (pin) {
        await this.notificationsService.create(pin.userId, userId, 'like', pinId);
      }

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
