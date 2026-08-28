import { 
  Controller, 
  Get, 
  Post, 
  Delete, 
  Param, 
  Query, 
  Body, 
  UseGuards, 
  UseInterceptors, 
  UploadedFile,
  ParseIntPipe,
  Headers
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PinsService } from './pins.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { verifiedUserIdFromHeader } from '../supabase/supabase-jwt';

@Controller('api/pins')
export class PinsController {
  constructor(private readonly pinsService: PinsService) {}

  @Get()
  async getAllPins(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('seed') seed?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    // Endpoint công khai, đăng nhập chỉ để cá nhân hoá thứ tự bảng tin. Nhưng
    // vẫn phải KIỂM CHỮ KÝ: trước đây chỗ này chỉ giải mã base64 rồi tin `sub`,
    // nên chỉ cần bịa token là xem được bảng tin cá nhân hoá của người khác
    // (suy ra được họ thích gì). Chữ ký sai thì coi như khách vãng lai.
    const userId = await verifiedUserIdFromHeader(authHeader);

    return this.pinsService.getAllPins(pageNum, limitNum, userId, seed);
  }

  @Get('search')
  async searchPins(
    @Query('q') q: string,
    @Query('query') query: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const searchQuery = q || query || '';
    return this.pinsService.searchPins(searchQuery, pageNum, limitNum);
  }

  /**
   * Gợi ý bộ lọc cho một câu tìm. Tách khỏi /search vì nó quét rộng hơn nhiều
   * so với một trang kết quả, và giao diện chỉ cần lấy một lần cho mỗi câu tìm
   * chứ không lấy lại mỗi lần cuộn thêm.
   */
  @Get('search-facets')
  async searchFacets(@Query('q') q: string, @Query('query') query: string) {
    return this.pinsService.searchFacets(q || query || '');
  }

  @Post('search-by-image')
  @UseInterceptors(FileInterceptor('image', {
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  }))
  async searchByImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 30;
    return this.pinsService.searchByImage(file, pageNum, limitNum);
  }

  // Crop / "Pinterest Lens" style search: match against a selected region of an
  // existing pin's image. `box` values are 0..1 fractions of the pin image.
  @Post(':id/search-by-region')
  async searchByRegion(
    @Param('id') id: string,
    @Body() body: { box: { x: number; y: number; width: number; height: number } },
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 30;
    return this.pinsService.searchByImageRegion(id, body?.box, pageNum, limitNum);
  }

  @Get(':id/similar')
  async getSimilarPins(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.getSimilarPins(id, pageNum, limitNum);
  }

  @Get(':id/related')
  async getRelatedPins(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.getSimilarPins(id, pageNum, limitNum);
  }

  @Get(':id')
  async getPinById(@Param('id') id: string) {
    return this.pinsService.getPinById(id);
  }

  @Post()
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('image', {
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  }))
  async createUploadPin(
    @CurrentUser() user: UserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('description') description?: string,
    @Body('boardId') boardId?: string,
    @Body('isPremium') isPremium?: string,
    @Body('priceCredits') priceCredits?: string,
    @Body('isCollage') isCollage?: string,
  ) {
    // multipart -> giá trị là chuỗi
    const premium = isPremium === 'true' || isPremium === '1';
    const price = priceCredits ? parseInt(priceCredits, 10) : undefined;
    const collage = isCollage === 'true' || isCollage === '1';
    return this.pinsService.createUploadPin(user.id, file, title, description, boardId, premium, price, collage);
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
    @Body('isPremium') isPremium?: boolean,
    @Body('priceCredits') priceCredits?: number,
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
      !!isPremium,
      priceCredits,
    );
  }

  @Delete(':id')
  @UseGuards(SupabaseAuthGuard)
  async deletePin(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.pinsService.deletePin(id, user.id);
  }

  @Post(':id/like')
  @UseGuards(SupabaseAuthGuard)
  async toggleLike(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
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

  @Post(':id/hide')
  @UseGuards(SupabaseAuthGuard)
  async hidePin(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.pinsService.hidePin(id, user.id);
  }

  @Post(':id/report')
  @UseGuards(SupabaseAuthGuard)
  async reportPin(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.pinsService.reportPin(id, user.id, reason);
  }

  @Post(':id/interest')
  @UseGuards(SupabaseAuthGuard)
  async markInterest(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.pinsService.markInterest(id, user.id);
  }
}
