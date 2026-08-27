import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AiGeneratorModule } from './ai-generator/ai-generator.module';
import { PinsModule } from './pins/pins.module';
import { MembershipsModule } from './memberships/memberships.module';
import { WatermarkModule } from './watermark/watermark.module';
import { BoardsModule } from './boards/boards.module';
import { UsersModule } from './users/users.module';
import { BlocksModule } from './blocks/blocks.module';
import { ReportsModule } from './reports/reports.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuctionsModule } from './auctions/auctions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Serve the compiled Angular SPA (copied to <cwd>/client in the Docker
    // image). API controllers are all under /api, which we exclude so the SPA
    // fallback never shadows a real endpoint. Override the location with
    // CLIENT_DIST_PATH when running outside the container.
    ServeStaticModule.forRoot({
      rootPath: process.env.CLIENT_DIST_PATH || join(process.cwd(), 'client'),
      exclude: ['/api/{*path}'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    SupabaseModule,
    AiGeneratorModule,
    PinsModule,
    MembershipsModule,
    WatermarkModule,
    BoardsModule,
    UsersModule,
    BlocksModule,
    ReportsModule,
    MessagingModule,
    NotificationsModule,
    AuctionsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
