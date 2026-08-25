import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { PaymentsController, PurchasesController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PaymentsService } from './payments.service';
import { PlansGuard } from './plans.guard';
import { AdminGuard } from './admin.guard';
import { NovaTokenController } from './novatoken.controller';
import { NovaTokenService } from './novatoken.service';

@Module({
  imports: [DatabaseModule, SupabaseModule, NotificationsModule],
  controllers: [MembershipsController, PaymentsController, PurchasesController, PaymentsWebhookController, NovaTokenController],
  providers: [MembershipsService, PaymentsService, NovaTokenService, PlansGuard, AdminGuard],
  exports: [MembershipsService, PaymentsService, NovaTokenService],
})
export class MembershipsModule {}
