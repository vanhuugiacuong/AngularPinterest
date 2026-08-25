import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { MembershipPlan } from '@prisma/client';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { MembershipsService } from './memberships.service';
import { NovaTokenService } from './novatoken.service';

@Controller('api/memberships')
@UseGuards(SupabaseAuthGuard)
export class MembershipsController {
  constructor(private readonly service: MembershipsService, private readonly novaTokens: NovaTokenService) {}
  @Get('me') status(@CurrentUser() user: UserPayload) { return this.service.status(user.id); }
  @Post('subscribe') subscribe(@CurrentUser() user: UserPayload, @Body('plan') plan: MembershipPlan) { return this.service.changePlan(user.id, plan); }
  @Post('ai/consume') consume(@CurrentUser() user: UserPayload) { return this.service.consumeAi(user.id); }
  @Post('pins/:id/purchase') purchase(@CurrentUser() user: UserPayload, @Param('id') id: string) { return this.novaTokens.purchaseFixedPin(user.id, id); }
  @Get('marketplace/sales') sales(@CurrentUser() user: UserPayload) { return this.service.listSales(user.id); }
  @Get('marketplace/purchases') purchases(@CurrentUser() user: UserPayload) { return this.service.listPurchases(user.id); }
  @Get('marketplace/pending-sales') pendingSales(@CurrentUser() user: UserPayload) { return this.service.listPendingSales(user.id); }
  @Get('me/payout-account') getPayoutAccount(@CurrentUser() user: UserPayload) { return this.service.getPayoutAccount(user.id); }
  @Put('me/payout-account') updatePayoutAccount(@CurrentUser() user: UserPayload, @Body() body: Record<string, unknown>) { return this.service.updatePayoutAccount(user.id, body); }
}
