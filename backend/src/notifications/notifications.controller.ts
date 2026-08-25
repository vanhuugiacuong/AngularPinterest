import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
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
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.notificationsService.getNotifications(user.id, pageNum, limitNum);
  }

  @Get('unread/count')
  async getUnreadCount(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { unreadCount: count };
  }

  // Must be registered before ':id/read' — otherwise Nest matches this
  // static path as the dynamic route with id='all' (PATCH /:id/read),
  // which then 500s trying to update a notification that doesn't exist.
  @Patch('all/read')
  async markAllAsRead(@CurrentUser() user: UserPayload) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: UserPayload,
    @Param('id') notificationId: string,
  ) {
    return this.notificationsService.markAsRead(notificationId);
  }
}
