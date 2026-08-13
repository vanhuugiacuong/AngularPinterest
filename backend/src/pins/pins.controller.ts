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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PinsService } from './pins.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { OptionalSupabaseAuthGuard } from '../supabase/optional-supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

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
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    return this.pinsService.getAllPins(pageNum, limitNum, user?.id, seed);
  }

  @Get(':id/related')
  async getRelatedPins(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.pinsService.getRelatedPins(id, pageNum, limitNum);
  }

  @Get(':id')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getPinById(
    @CurrentUser() user: UserPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pinsService.getPinById(id, user?.id);
  }

  @Post()
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    }),
  )
  async createUploadPin(
    @CurrentUser() user: UserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('description') description?: string,
    @Body('boardId') boardId?: string,
  ) {
    return this.pinsService.createUploadPin(
      user.id,
      file,
      title,
      description,
      boardId,
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
