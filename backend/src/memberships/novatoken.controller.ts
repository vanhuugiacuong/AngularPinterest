import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { AdminGuard } from './admin.guard';
import { NovaTokenService } from './novatoken.service';

@Controller('api/novatoken')
@UseGuards(SupabaseAuthGuard)
export class NovaTokenController {
  constructor(private readonly tokens: NovaTokenService) {}

  @Get() wallet(@CurrentUser() user: UserPayload) {
    return this.tokens.getWallet(user.id);
  }
  @Post('topups') topUp(
    @CurrentUser() user: UserPayload,
    @Body('tokens') tokens: unknown,
  ) {
    return this.tokens.createTopUp(user.id, tokens);
  }
  @Get('topups/:id') getTopUp(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.tokens.getTopUp(user.id, id);
  }
  @Post('purchase/:pinId') purchase(
    @CurrentUser() user: UserPayload,
    @Param('pinId') pinId: string,
  ) {
    return this.tokens.purchaseFixedPin(user.id, pinId);
  }
  @Post('withdrawals/demo') demoWithdrawal(
    @CurrentUser() user: UserPayload,
    @Body('amount') amount: unknown,
  ) {
    return this.tokens.createDemoWithdrawal(user.id, amount);
  }

  @UseGuards(AdminGuard)
  @Post('topups/:id/confirm')
  confirm(@CurrentUser() admin: UserPayload, @Param('id') id: string) {
    return this.tokens.confirmTopUp(id, { verifiedBy: admin.id });
  }
}
