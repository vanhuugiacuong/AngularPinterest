import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AiGeneratorService } from '../ai-generator/ai-generator.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly aiGeneratorService: AiGeneratorService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getAllPins(page: number = 1, limit: number = 20, userId?: string, seed?: string) {
    const skip = (page - 1) * limit;

    // 1. Fetch all pins with user and like counts
    const pins = await this.prisma.pin.findMany({
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true },
        },
        _count: {
          select: { likes: true }
        }
      },
    });

    // 2. Fetch user's preferred categories based on likes & board saves
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
        const categories = [
          ...likes.map(l => l.pin?.category),
          ...boardPins.map(b => b.pin?.category)
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
    const sortedPins = pinsWithScores.map(item => item.pin);

    // 4. Return paginated slice
    return sortedPins.slice(skip, skip + limit);
  }

  async searchPins(query: string, page: number = 1, limit: number = 30) {
    const skip = (page - 1) * limit;
    const needle = query.trim();
    if (!needle) {
      return [];
    }

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
        _count: { select: { likes: true } },
      },
    });
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
    const extension = file.originalname.split('.').pop() || 'png';
    const filename = `${userId}/pin_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const imageUrl = await this.supabaseService.uploadImage('pins', filename, file.buffer, file.mimetype);

    const category = this.classifyCategory(title, description);

    const pin = await this.prisma.pin.create({
      data: {
        title,
        description,
        imageUrl,
        userId,
        category,
      },
    });

    if (boardId) {
      await this.prisma.boardPin.create({
        data: {
          boardId,
          pinId: pin.id,
        },
      });
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
    // 1. Download image from temporary url and upload to permanent pins bucket
    const imageUrl = await this.aiGeneratorService.saveAiImageToStorage(previewUrl, userId);

    const category = this.classifyCategory(title, description);

    // 2. Save to database
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

    // 3. Connect to board if provided
    if (boardId) {
      await this.prisma.boardPin.create({
        data: {
          boardId,
          pinId: pin.id,
        },
      });
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
}
