import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { UserPayload } from './current-user.decorator';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private supabaseClient?: ReturnType<typeof createClient>;

  onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      console.warn(
        'Supabase credentials are not fully set in environment variables.',
      );
      return;
    }

    this.supabaseClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  getClient(): ReturnType<typeof createClient> {
    if (!this.supabaseClient) {
      throw new Error('Supabase client is not configured');
    }
    return this.supabaseClient;
  }

  async verifyAccessToken(token: string): Promise<UserPayload> {
    if (!this.supabaseClient) {
      throw new UnauthorizedException(
        'Authentication service is not configured',
      );
    }

    const { data, error } = await this.supabaseClient.auth.getUser(token);
    const user = data.user;

    if (error || !user?.id || !user.email) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  async uploadImage(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const { error } = await this.getClient()
      .storage.from(bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload to Supabase Storage: ${error.message}`);
    }

    const { data: urlData } = this.getClient()
      .storage.from(bucket)
      .getPublicUrl(path);

    return urlData.publicUrl;
  }
}
