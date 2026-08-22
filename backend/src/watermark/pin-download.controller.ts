import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { PinDownloadService } from './pin-download.service';

@Controller('api/memberships/pins')
@UseGuards(SupabaseAuthGuard)
export class PinDownloadController {
  constructor(private readonly service: PinDownloadService) {}

  @Get(':id/download')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async download(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Query('watermarkPresetId') watermarkPresetId: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.service.download(user.id, id, watermarkPresetId);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  }
}
