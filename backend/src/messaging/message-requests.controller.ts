import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MessageRequestsService } from './message-requests.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/message-requests')
@UseGuards(SupabaseAuthGuard)
export class MessageRequestsController {
  constructor(private readonly messageRequestsService: MessageRequestsService) {}

  @Post(':receiverId')
  async send(@CurrentUser() user: UserPayload, @Param('receiverId') receiverId: string) {
    return this.messageRequestsService.sendRequest(user.id, receiverId);
  }

  @Get('incoming')
  async incoming(@CurrentUser() user: UserPayload) {
    return this.messageRequestsService.listIncoming(user.id);
  }

  @Get('outgoing')
  async outgoing(@CurrentUser() user: UserPayload) {
    return this.messageRequestsService.listOutgoing(user.id);
  }

  @Patch(':id/accept')
  async accept(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.messageRequestsService.accept(id, user.id);
  }

  @Patch(':id/reject')
  async reject(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.messageRequestsService.reject(id, user.id);
  }

  @Patch(':id/report')
  async report(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('details') details?: string,
  ) {
    return this.messageRequestsService.report(id, user.id, reason, details);
  }
}
