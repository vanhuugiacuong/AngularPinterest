import { Module } from '@nestjs/common';
import { PinsService } from './pins.service';
import { WatermarkService } from './watermark.service';
import { PinsController } from './pins.controller';
import { AiGeneratorModule } from '../ai-generator/ai-generator.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [AiGeneratorModule, NotificationsModule, ModerationModule],
  controllers: [PinsController],
  providers: [PinsService, WatermarkService],
})
export class PinsModule {}
