import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { OptionalSupabaseAuthGuard } from '../supabase/optional-supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @UseGuards(SupabaseAuthGuard)
  create(@CurrentUser() user: UserPayload, @Body() body: Record<string, unknown>) {
    return this.auctionsService.createAuction(user.id, body);
  }

  @Get('me/selling')
  @UseGuards(SupabaseAuthGuard)
  selling(@CurrentUser() user: UserPayload) {
    return this.auctionsService.listSelling(user.id);
  }

  @Get('me/bidding')
  @UseGuards(SupabaseAuthGuard)
  bidding(@CurrentUser() user: UserPayload) {
    return this.auctionsService.listBidding(user.id);
  }

  @Get(':id')
  @UseGuards(OptionalSupabaseAuthGuard)
  get(@CurrentUser() user: UserPayload | undefined, @Param('id') id: string) {
    return this.auctionsService.getAuction(id, user?.id);
  }

  @Post(':id/bids')
  @UseGuards(SupabaseAuthGuard)
  bid(@CurrentUser() user: UserPayload, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.auctionsService.placeBid(id, user.id, body);
  }

  @Post(':id/cancel')
  @UseGuards(SupabaseAuthGuard)
  cancel(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.auctionsService.cancelAuction(id, user.id);
  }
}
