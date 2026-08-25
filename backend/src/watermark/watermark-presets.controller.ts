import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import sharp from 'sharp';
import { WatermarkPosition, WatermarkType } from '@prisma/client';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { WatermarkPresetsService } from './watermark-presets.service';

interface PresetBody {
  name?: string;
  type: WatermarkType;
  text?: string;
  position?: WatermarkPosition;
  opacity?: string;
  scale?: string;
  margin?: string;
  rotation?: string;
  tiled?: string;
  spacing?: string;
  isDefault?: string;
}

function parseInput(body: PresetBody) {
  return {
    name: body.name,
    type: body.type,
    text: body.text,
    position: body.position,
    opacity: body.opacity !== undefined ? Number(body.opacity) : undefined,
    scale: body.scale !== undefined ? Number(body.scale) : undefined,
    margin: body.margin !== undefined ? Number(body.margin) : undefined,
    rotation: body.rotation !== undefined ? Number(body.rotation) : undefined,
    tiled: body.tiled !== undefined ? body.tiled === 'true' : undefined,
    spacing: body.spacing !== undefined ? Number(body.spacing) : undefined,
    isDefault: body.isDefault !== undefined ? body.isDefault === 'true' : undefined,
  };
}

@Controller('api/memberships/watermark-presets')
@UseGuards(SupabaseAuthGuard)
export class WatermarkPresetsController {
  constructor(private readonly service: WatermarkPresetsService) {}

  @Get()
  list(@CurrentUser() user: UserPayload) {
    return this.service.list(user.id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 3 * 1024 * 1024 } }))
  create(@CurrentUser() user: UserPayload, @Body() body: PresetBody, @UploadedFile() file?: Express.Multer.File) {
    return this.service.create(user.id, parseInput(body), file?.buffer);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 3 * 1024 * 1024 } }))
  update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() body: PresetBody,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.update(user.id, id, parseInput(body), file?.buffer);
  }

  @Delete(':id')
  remove(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  @Post('preview/:pinId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 3 * 1024 * 1024 } }))
  async preview(
    @CurrentUser() user: UserPayload,
    @Param('pinId') pinId: string,
    @Body() body: PresetBody,
    @Res() res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const input = { ...parseInput(body), name: body.name ?? 'preview' };
    const buffer = await this.service.preview(user.id, pinId, input, file?.buffer);
    const meta = await sharp(buffer).metadata();
    const contentType = meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
