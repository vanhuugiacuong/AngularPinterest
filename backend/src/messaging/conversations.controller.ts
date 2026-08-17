import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/conversations')
@UseGuards(SupabaseAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async list(@CurrentUser() user: UserPayload) {
    return this.conversationsService.listConversations(user.id);
  }

  @Post('direct/:userId')
  async openDirect(@CurrentUser() user: UserPayload, @Param('userId') userId: string) {
    return this.conversationsService.openDirectConversation(user.id, userId);
  }

  @Get(':id/messages')
  async getMessages(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.getMessages(id, user.id, page, limit);
  }

  @Post(':id/messages')
  async sendMessage(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    return this.conversationsService.sendMessage(id, user.id, content);
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.conversationsService.markRead(id, user.id);
  }
}
