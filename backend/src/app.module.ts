import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AiGeneratorModule } from './ai-generator/ai-generator.module';
import { PinsModule } from './pins/pins.module';
import { MembershipsModule } from './memberships/memberships.module';
import { BoardsModule } from './boards/boards.module';
import { UsersModule } from './users/users.module';
import { BlocksModule } from './blocks/blocks.module';
import { ReportsModule } from './reports/reports.module';
import { MessagingModule } from './messaging/messaging.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SupabaseModule,
    AiGeneratorModule,
    PinsModule,
    MembershipsModule,
    BoardsModule,
    UsersModule,
    BlocksModule,
    ReportsModule,
    MessagingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
