import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/notifications')
@UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @CurrentUser() user: UserPayload,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 30;
    return this.notificationsService.getForUser(user.id, pageNum, limitNum);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: UserPayload) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: UserPayload) {
    return this.notificationsService.markAllRead(user.id);
  }
}
