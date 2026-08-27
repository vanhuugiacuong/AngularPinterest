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

  /**
   * Upload vào bucket RIÊNG TƯ và chỉ trả về đường dẫn nội bộ — KHÔNG có URL
   * công khai. Dùng cho bản gốc HD của ảnh Premium: file không bao giờ truy
   * cập được nếu không có link ký tạm thời (xem createSignedUrl).
   */
  async uploadPrivate(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const { error } = await this.supabaseClient.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert: true });

    if (error) {
      throw new Error(`Failed to upload private file: ${error.message}`);
    }
    return path;
  }

  /**
   * Link tải tạm thời cho file trong bucket riêng tư. Hết hạn sau `expiresIn`
   * giây, nên có bị chia sẻ lại cũng nhanh chóng vô dụng.
   */
  async createSignedUrl(bucket: string, path: string, expiresIn = 300): Promise<string> {
    const { data, error } = await this.supabaseClient.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${error?.message ?? 'unknown'}`);
    }
    return data.signedUrl;
  }

  /** Xoá file trong bucket (dùng khi gỡ ảnh Premium). */
  async removeFile(bucket: string, path: string): Promise<void> {
    await this.supabaseClient.storage.from(bucket).remove([path]);
  }
}
