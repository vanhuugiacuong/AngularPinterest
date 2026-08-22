import { Injectable, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private supabaseClient: SupabaseClient;

  onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      console.warn('Supabase credentials are not fully set in environment variables.');
      return;
    }

    this.supabaseClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  getClient(): SupabaseClient {
    return this.supabaseClient;
  }

  async uploadImage(bucket: string, path: string, buffer: Buffer, contentType: string): Promise<string> {
    const { data, error } = await this.supabaseClient.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload to Supabase Storage: ${error.message}`);
    }

    const { data: urlData } = this.supabaseClient.storage
      .from(bucket)
      .getPublicUrl(path);

    return urlData.publicUrl;
  }
}
