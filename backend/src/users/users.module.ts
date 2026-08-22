import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { BlocksModule } from '../blocks/blocks.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BlocksModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
