import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { PinsService } from './pins.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { OptionalSupabaseAuthGuard } from '../supabase/optional-supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { MAX_PIN_IMAGE_UPLOAD_BYTES } from '../common/upload-limits';

@Controller('api/pins')
export class PinsController {
  constructor(private readonly pinsService: PinsService) {}

  @Get()
  @UseGuards(OptionalSupabaseAuthGuard)
  async getAllPins(
    @CurrentUser() user: UserPayload | undefined,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('seed') seed?: string,
    @Query('category') category?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    return this.pinsService.getAllPins(
      pageNum,
      limitNum,
      user?.id,
      seed,
      category,
    );
  }

  /** Danh mục có thật trong feed mà người xem được phép thấy, kèm số lượng.
   * Frontend dựng chip từ đây thay vì từ các pin đã tải — nếu dựng từ pin đã
   * tải thì chip bật ra giữa lúc cuộn, và danh mục nằm ở trang chưa tải sẽ
   * không bao giờ chọn tới được.
   *
   * Phải khai báo TRƯỚC `@Get(':id')` bên dưới, không thì 'categories' bị bắt
   * làm id. */
  @Get('categories')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getFeedCategories(@CurrentUser() user: UserPayload | undefined) {
    return this.pinsService.getFeedCategories(user?.id);
  }

  @Get('search')
  @UseGuards(OptionalSupabaseAuthGuard)
  async searchPins(
    @CurrentUser() user: UserPayload | undefined,
    @Query('q') query: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.searchPins(
      query || '',
      pageNum,
      limitNum,
      user?.id,
    );
  }

  @Post('search-by-image')
  @UseGuards(OptionalSupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit, matches pin upload
    }),
  )
  async searchPinsByImage(
    @CurrentUser() user: UserPayload | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.searchPinsByImage(
      file,
      pageNum,
      limitNum,
      user?.id,
    );
  }

  @Get(':id/similar')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getSimilarPins(
    @CurrentUser() user: UserPayload | undefined,
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.getSimilarPins(id, pageNum, limitNum, user?.id);
  }

  @Get(':id/related')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getRelatedPins(
    @CurrentUser() user: UserPayload | undefined,
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.getSimilarPins(id, pageNum, limitNum, user?.id);
  }

  /** Same-origin proxy for a pin's own stored image. Used by the pin-detail
   * region-select image search tool as a canvas-safe fallback when the CDN
   * itself doesn't send CORS headers permissive enough for the browser to
   * read a cross-origin fetch's response body (needed to draw the crop to
   * a canvas without tainting it). Only ever fetches the URL already on
   * file for this specific pin id — no arbitrary-URL fetch/SSRF surface. */
  @Get(':id/image-proxy')
  @UseGuards(OptionalSupabaseAuthGuard)
  async proxyPinImage(
    @CurrentUser() user: UserPayload | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } =
      await this.pinsService.getPinImageForProxy(id, user?.id);
    res.setHeader('Content-Type', contentType);
    // Both branches independently moved this off a shared `public` cache, for
    // the same reason: this response can hold the clear asset once the
    // entitlement check passes, so it must never be replayed to another viewer.
    // `no-store` over `private, max-age=3600` because entitlement can be lost
    // (a plan lapses, a purchase is refunded) and a browser-cached copy would
    // keep serving the clear bytes past that point.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  /** Public, deliberately lossy stand-in for a locked market pin. Safe to cache
   * shared: the bytes are already blurred for everyone, and the real CDN URL
   * never reaches the client. Two path segments, so it cannot collide with the
   * `@Get(':id')` route below. */
  @Get(':id/locked-preview')
  async lockedPinPreview(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.pinsService.getLockedPinPreview(id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }

  @Get(':id')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getPinById(
    @CurrentUser() user: UserPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pinsService.getPinById(id, user?.id);
  }

  @Post('check-image')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_PIN_IMAGE_UPLOAD_BYTES },
    }),
  )
  async checkImage(@UploadedFile() file: Express.Multer.File) {
    return this.pinsService.checkImageModeration(file);
  }

  @Post()
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_PIN_IMAGE_UPLOAD_BYTES },
    }),
  )
  async createUploadPin(
    @CurrentUser() user: UserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('description') description?: string,
    @Body('boardId') boardId?: string,
    @Body('price') price?: string,
  ) {
    return this.pinsService.createUploadPin(
      user.id,
      file,
      title,
      description,
      boardId,
      price,
    );
  }

  @Post('ai-save')
  @UseGuards(SupabaseAuthGuard)
  async saveAiPin(
    @CurrentUser() user: UserPayload,
    @Body('previewUrl') previewUrl: string,
    @Body('title') title: string,
    @Body('description') description?: string,
    @Body('boardId') boardId?: string,
    @Body('promptUsed') promptUsed?: string,
    @Body('negativePrompt') negativePrompt?: string,
    @Body('generationModel') generationModel?: string,
  ) {
    return this.pinsService.saveAiPin(
      user.id,
      previewUrl,
      title,
      description,
      boardId,
      promptUsed,
      negativePrompt,
      generationModel,
    );
  }

  @Delete(':id')
  @UseGuards(SupabaseAuthGuard)
  async deletePin(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.pinsService.deletePin(id, user.id);
  }

  @Post(':id/like')
  @UseGuards(SupabaseAuthGuard)
  async toggleLike(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.pinsService.toggleLike(id, user.id);
  }

  @Post(':id/comment')
  @UseGuards(SupabaseAuthGuard)
  async addComment(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    return this.pinsService.addComment(id, user.id, content);
  }
}
