import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/users')
@UseGuards(SupabaseAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post(':id/report')
  async report(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('details') details?: string,
  ) {
    return this.reportsService.reportUser(user.id, id, reason, details);
  }
}
