import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { MembershipPlan } from '@prisma/client';
import { appendFileSync } from 'fs';
import { join } from 'path';
// process.cwd() (not __dirname) so this resolves the same whether nest runs
// via ts-node, webpack HMR, or the compiled dist bundle.
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { MembershipsService } from './memberships.service';
import { NovaTokenService } from './novatoken.service';

// TEMP DEBUG: capturing the real stack trace behind the intermittent
// marketplace 500 the user is seeing — remove once root-caused.
function debugLog(label: string, error: unknown) {
  const line = `[${new Date().toISOString()}] ${label}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
  appendFileSync(join(process.cwd(), 'scratch', 'marketplace-error.log'), line);
}

@Controller('api/memberships')
@UseGuards(SupabaseAuthGuard)
export class MembershipsController {
  constructor(private readonly service: MembershipsService, private readonly novaTokens: NovaTokenService) {}
  @Get('me') status(@CurrentUser() user: UserPayload) { return this.service.status(user.id); }
  @Post('subscribe') subscribe(@CurrentUser() user: UserPayload, @Body('plan') plan: MembershipPlan) { return this.service.changePlan(user.id, plan); }
  @Post('ai/consume') consume(@CurrentUser() user: UserPayload) { return this.service.consumeAi(user.id); }
  @Post('pins/:id/purchase') purchase(@CurrentUser() user: UserPayload, @Param('id') id: string) { return this.novaTokens.purchaseFixedPin(user.id, id); }
  @Get('marketplace/sales') async sales(@CurrentUser() user: UserPayload) {
    try { return await this.service.listSales(user.id); }
    catch (error) { debugLog('sales', error); throw error; }
  }
  @Get('marketplace/purchases') async purchases(@CurrentUser() user: UserPayload) {
    try { return await this.service.listPurchases(user.id); }
    catch (error) { debugLog('purchases', error); throw error; }
  }
  @Get('marketplace/pending-sales') async pendingSales(@CurrentUser() user: UserPayload) {
    try { return await this.service.listPendingSales(user.id); }
    catch (error) { debugLog('pendingSales', error); throw error; }
  }
  @Get('me/payout-account') getPayoutAccount(@CurrentUser() user: UserPayload) { return this.service.getPayoutAccount(user.id); }
  @Put('me/payout-account') updatePayoutAccount(@CurrentUser() user: UserPayload, @Body() body: Record<string, unknown>) { return this.service.updatePayoutAccount(user.id, body); }
}
