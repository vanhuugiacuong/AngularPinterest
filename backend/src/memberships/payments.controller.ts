import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipPlan } from '@prisma/client';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { AdminGuard } from './admin.guard';
import { PaymentsService } from './payments.service';

@Controller('api/memberships/payments')
@UseGuards(SupabaseAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  create(@CurrentUser() user: UserPayload, @Body('plan') plan: MembershipPlan) {
    return this.payments.createPayment(user.id, plan);
  }

  @Get()
  list(@CurrentUser() user: UserPayload) {
    return this.payments.listPayments(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.payments.getPayment(user.id, id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/confirm')
  confirm(@CurrentUser() admin: UserPayload, @Param('id') id: string) {
    return this.payments.adminConfirm(id, admin.id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/reject')
  reject(@CurrentUser() admin: UserPayload, @Param('id') id: string, @Body('reason') reason?: string) {
    return this.payments.adminReject(id, admin.id, reason);
  }
}

@Controller('api/memberships/purchases')
@UseGuards(SupabaseAuthGuard)
export class PurchasesController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(AdminGuard)
  @Post(':id/confirm')
  confirm(@CurrentUser() admin: UserPayload, @Param('id') id: string) {
    return this.payments.adminConfirmPurchase(id, admin.id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/reject')
  reject(@CurrentUser() admin: UserPayload, @Param('id') id: string, @Body('reason') reason?: string) {
    return this.payments.adminRejectPurchase(id, admin.id, reason);
  }
}
