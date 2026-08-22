import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { GifService } from './gif.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, GifService],
})
export class MessagingModule {}
