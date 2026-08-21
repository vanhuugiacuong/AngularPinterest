import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
@Module({ imports: [DatabaseModule, SupabaseModule], controllers: [MembershipsController], providers: [MembershipsService], exports: [MembershipsService] })
export class MembershipsModule {}
