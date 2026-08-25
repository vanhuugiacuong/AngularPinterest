import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { WatermarkRenderService } from './watermark-render.service';
import { WatermarkPresetsService } from './watermark-presets.service';
import { WatermarkPresetsController } from './watermark-presets.controller';
import { PinDownloadService } from './pin-download.service';
import { PinDownloadController } from './pin-download.controller';

@Module({
  imports: [DatabaseModule, SupabaseModule, MembershipsModule],
  controllers: [WatermarkPresetsController, PinDownloadController],
  providers: [WatermarkRenderService, WatermarkPresetsService, PinDownloadService],
  exports: [WatermarkRenderService, WatermarkPresetsService],
})
export class WatermarkModule {}
