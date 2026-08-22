import { Module } from '@nestjs/common';
import { AiGeneratorService } from './ai-generator.service';
import { AiGeneratorController } from './ai-generator.controller';

@Module({
  controllers: [AiGeneratorController],
  providers: [AiGeneratorService],
  exports: [AiGeneratorService],
})
export class AiGeneratorModule {}
