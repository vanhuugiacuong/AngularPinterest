import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ModerationService } from './moderation.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';

// Lets the frontend check an image the instant it's selected/dropped, instead of
// waiting until the whole create-pin form is submitted — same checkImageIsSafe()
// used at actual save time, just callable standalone with no side effects.
@Controller('api/moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('check-image')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('image'))
  async checkImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh.');
    }
    await this.moderationService.checkImageIsSafe(file.buffer, file.originalname, file.mimetype);
    return { safe: true };
  }
}
