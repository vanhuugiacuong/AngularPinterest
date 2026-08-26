import { Module } from '@nestjs/common';
import { PinsService } from './pins.service';
import { PinsController } from './pins.controller';
import { AiGeneratorModule } from '../ai-generator/ai-generator.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WatermarkModule } from '../watermark/watermark.module';

@Module({
  imports: [AiGeneratorModule, MembershipsModule, NotificationsModule, WatermarkModule],
  controllers: [PinsController],
  providers: [PinsService],
})
export class PinsModule {}
