import { Module } from '@nestjs/common';
import { CollageController } from './collage.controller';
import { CollageService } from './collage.service';

@Module({
  controllers: [CollageController],
  providers: [CollageService],
})
export class CollageModule {}
