import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConversationsService } from './conversations.service';
import { GifService } from './gif.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/conversations')
@UseGuards(SupabaseAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly gifService: GifService,
  ) {}

  @Get()
  async list(@CurrentUser() user: UserPayload) {
    return this.conversationsService.listConversations(user.id);
  }

  // Literal routes registered before ':id/...' below so Nest can't match
  // e.g. "gif"/"users" as a conversation id.
  @Get('gif/search')
  async searchGifs(@Query('q') q?: string) {
    return this.gifService.search(q || '');
  }

  @Get('gif/trending')
  async trendingGifs() {
    return this.gifService.trending();
  }

  @Get('users/search')
  async searchUsers(@CurrentUser() user: UserPayload, @Query('q') q?: string) {
    return this.conversationsService.searchUsers(q || '', user.id);
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadImage(@CurrentUser() user: UserPayload, @UploadedFile() file: Express.Multer.File) {
    return this.conversationsService.uploadChatImage(user.id, file);
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
    @Body('content') content?: string,
    @Body('type') type?: string,
    @Body('imageUrl') imageUrl?: string,
    @Body('gifUrl') gifUrl?: string,
    @Body('pinId') pinId?: string,
    @Body('replyToId') replyToId?: string,
  ) {
    return this.conversationsService.sendMessage(id, user.id, { content, type, imageUrl, gifUrl, pinId, replyToId });
  }

  @Post(':id/messages/:messageId/react')
  async toggleReaction(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body('emoji') emoji: string,
  ) {
    return this.conversationsService.toggleReaction(id, messageId, user.id, emoji);
  }

  @Post(':id/messages/:messageId/unsend')
  async unsendMessage(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.conversationsService.unsendMessage(id, messageId, user.id);
  }

  @Post(':id/messages/:messageId/pin')
  async togglePin(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.conversationsService.togglePin(id, messageId, user.id);
  }

  @Get(':id/pinned-message')
  async getPinnedMessage(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.conversationsService.getPinnedMessage(id, user.id);
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.conversationsService.markRead(id, user.id);
  }
}
