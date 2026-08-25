import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CollageService } from './collage.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';

@Controller('api/collage')
export class CollageController {
  constructor(private readonly collageService: CollageService) {}

  @Post('cutout')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async cutout(@UploadedFile() file: Express.Multer.File, @Res() res: Response) {
    const png = await this.collageService.cutoutObject(file.buffer, file.originalname, file.mimetype);
    res.set('Content-Type', 'image/png');
    res.send(png);
  }
}
