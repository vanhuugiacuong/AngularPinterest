import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { WatermarkRenderService } from './watermark-render.service';
import { WatermarkPresetsService } from './watermark-presets.service';
import { WatermarkPresetsController } from './watermark-presets.controller';
import { PinDownloadService } from './pin-download.service';
import { PinDownloadController } from './pin-download.controller';
import { PinPreviewProtectionService } from './pin-preview-protection.service';

@Module({
  imports: [DatabaseModule, SupabaseModule, MembershipsModule],
  controllers: [WatermarkPresetsController, PinDownloadController],
  providers: [WatermarkRenderService, WatermarkPresetsService, PinDownloadService, PinPreviewProtectionService],
  exports: [WatermarkRenderService, WatermarkPresetsService, PinPreviewProtectionService],
})
export class WatermarkModule {}
