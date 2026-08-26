import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SepayPollerService } from './sepay-poller.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, SepayPollerService],
  exports: [BillingService],
})
export class BillingModule {}
