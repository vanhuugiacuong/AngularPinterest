import { Module, Global } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { SupabaseStrategy } from './supabase.strategy';

@Global()
@Module({
  providers: [SupabaseService, SupabaseStrategy],
  exports: [SupabaseService],
})
export class SupabaseModule {}
