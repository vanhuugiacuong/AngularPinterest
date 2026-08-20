import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipPlan } from '@prisma/client';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { MembershipsService } from './memberships.service';

@Controller('api/memberships')
@UseGuards(SupabaseAuthGuard)
export class MembershipsController {
  constructor(private readonly service: MembershipsService) {}
  @Get('me') status(@CurrentUser() user: UserPayload) { return this.service.status(user.id); }
  @Post('subscribe') subscribe(@CurrentUser() user: UserPayload, @Body('plan') plan: MembershipPlan) { return this.service.changePlan(user.id, plan); }
  @Post('ai/consume') consume(@CurrentUser() user: UserPayload) { return this.service.consumeAi(user.id); }
  @Post('pins/:id/purchase') purchase(@CurrentUser() user: UserPayload, @Param('id') id: string) { return this.service.purchase(user.id, id); }
}
