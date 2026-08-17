import { Module } from '@nestjs/common';
import { MessageRequestsController } from './message-requests.controller';
import { MessageRequestsService } from './message-requests.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { BlocksModule } from '../blocks/blocks.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [BlocksModule, ReportsModule],
  controllers: [MessageRequestsController, ConversationsController],
  providers: [MessageRequestsService, ConversationsService],
})
export class MessagingModule {}
