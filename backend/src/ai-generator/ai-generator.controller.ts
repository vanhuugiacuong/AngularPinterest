import { Controller, Post, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiGeneratorService } from './ai-generator.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';

@Controller('api/ai-generator')
export class AiGeneratorController {
  constructor(private readonly aiGeneratorService: AiGeneratorService) {}

  @Post('upload-reference')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('image', {
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  }))
  async uploadReference(@UploadedFile() file: Express.Multer.File) {
    const url = await this.aiGeneratorService.uploadTempReferenceImage(file);
    return { success: true, url };
  }
}
