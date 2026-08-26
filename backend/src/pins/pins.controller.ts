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

    let userId: string | undefined = undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token === 'mock-token') {
        userId = 'mock-user-id-12345';
      } else {
        try {
          const payloadBase64 = token.split('.')[1];
          if (payloadBase64) {
            const decodedPayload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
            if (decodedPayload && decodedPayload.sub) {
              userId = decodedPayload.sub;
            }
          }
        } catch (e) {
          // Silent catch for invalid/anonymous request tokens
        }
      }
    }

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
  ) {
    return this.pinsService.createUploadPin(user.id, file, title, description, boardId);
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
