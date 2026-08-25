import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { UserPayload } from './current-user.decorator';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private supabaseClient?: ReturnType<typeof createClient>;
  /** One persistent, subscribed websocket channel per broadcast topic —
   * the same connect-then-send flow the frontend already uses successfully
   * for per-conversation chat, proven to work against this project's actual
   * Realtime configuration (unlike the newer, connectionless REST broadcast
   * endpoint, which some projects don't have fully enabled). Kept open for
   * the process lifetime since topics are per-user and reused constantly. */
  private readonly broadcastChannels = new Map<string, RealtimeChannel>();

  async onModuleInit() {
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

    try {
      await this.ensurePrivateBucketsExist();
    } catch (error) {
      console.error(
        '[SupabaseService] Không thể đảm bảo bucket private tồn tại:',
        error,
      );
    }

    try {
      await this.ensurePublicBucketsExist();
    } catch (error) {
      console.error(
        '[SupabaseService] Không thể đảm bảo bucket public tồn tại:',
        error,
      );
    }
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

  /** Best-effort delete for rollback (e.g. a DB insert fails after the file
   * already made it to storage) — accepts either an allowlisted public or
   * private bucket. Never throws: callers use this to clean up after a
   * failure they're already handling, and a cleanup failure must never mask
   * or replace the original error. */
  async deleteObject(bucket: string, path: string): Promise<void> {
    try {
      if (
        !SupabaseService.PUBLIC_BUCKETS.has(bucket) &&
        !SupabaseService.PRIVATE_BUCKETS.has(bucket)
      ) {
        return;
      }
      this.assertSafePath(path);
      const { error } = await this.getClient()
        .storage.from(bucket)
        .remove([path]);
      if (error) {
        console.error(
          `[SupabaseService] Không thể xoá "${bucket}/${path}" (dọn file mồ côi):`,
          error,
        );
      }
    } catch (error) {
      console.error(
        `[SupabaseService] Lỗi khi dọn file mồ côi "${bucket}/${path}":`,
        error,
      );
    }
  }

  async uploadImage(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    this.assertPublicBucket(bucket);
    this.assertSafePath(path);

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

  // Chỉ các bucket đã khai báo ở đây mới được đọc/ghi - chặn path traversal/SSRF
  // qua tên bucket tùy ý từ input người dùng.
  private static readonly PRIVATE_BUCKETS = new Set([
    'pins-original',
    'watermark-logos',
  ]);
  private static readonly PUBLIC_BUCKETS = new Set([
    'pins',
    'message-attachments',
    'avatars',
  ]);

  private assertPrivateBucket(bucket: string) {
    if (!SupabaseService.PRIVATE_BUCKETS.has(bucket)) {
      throw new Error(
        `Bucket "${bucket}" không nằm trong danh sách bucket private đã cấu hình.`,
      );
    }
  }

  private assertPublicBucket(bucket: string) {
    if (!SupabaseService.PUBLIC_BUCKETS.has(bucket)) {
      throw new Error(
        `Bucket "${bucket}" không nằm trong danh sách bucket public đã cấu hình.`,
      );
    }
  }

  private assertSafePath(path: string) {
    if (path.includes('..') || path.startsWith('/') || path.includes('\\')) {
      throw new Error('Storage path không hợp lệ.');
    }
  }

  async ensurePrivateBucketsExist(): Promise<void> {
    const client = this.getClient();
    const { data: existing } = await client.storage.listBuckets();
    const existingNames = new Set((existing ?? []).map((b) => b.name));
    for (const bucket of SupabaseService.PRIVATE_BUCKETS) {
      if (!existingNames.has(bucket)) {
        await client.storage.createBucket(bucket, { public: false });
      }
    }
  }

  /** Self-healing counterpart to ensurePrivateBucketsExist() — without this,
   * a bucket referenced by uploadImage() (e.g. "avatars") that was never
   * created in this Supabase project (fresh project, new environment) fails
   * the upload with an opaque Supabase error that has nothing to do with the
   * caller's actual request, surfacing as an unexplained 500 to the client. */
  async ensurePublicBucketsExist(): Promise<void> {
    const client = this.getClient();
    const { data: existing } = await client.storage.listBuckets();
    const existingNames = new Set((existing ?? []).map((b) => b.name));
    for (const bucket of SupabaseService.PUBLIC_BUCKETS) {
      if (!existingNames.has(bucket)) {
        await client.storage.createBucket(bucket, { public: true });
      }
    }
  }

  async uploadPrivate(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    this.assertPrivateBucket(bucket);
    this.assertSafePath(path);
    const { error } = await this.getClient()
      .storage.from(bucket)
      .upload(path, buffer, { contentType, upsert: true });
    if (error)
      throw new Error(`Failed to upload to private bucket: ${error.message}`);
    return path;
  }

  async downloadPrivate(bucket: string, path: string): Promise<Buffer> {
    this.assertPrivateBucket(bucket);
    this.assertSafePath(path);
    const { data, error } = await this.getClient()
      .storage.from(bucket)
      .download(path);
    if (error || !data)
      throw new Error(
        `Failed to download from private bucket: ${error?.message ?? 'not found'}`,
      );
    return Buffer.from(await data.arrayBuffer());
  }

  async createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string> {
    this.assertPrivateBucket(bucket);
    this.assertSafePath(path);
    const { data, error } = await this.getClient()
      .storage.from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data)
      throw new Error(
        `Failed to create signed URL: ${error?.message ?? 'unknown error'}`,
      );
    return data.signedUrl;
  }

  /** Server-side push — best-effort: a missed realtime push must never fail
   * the write it's reporting on, since clients still reconcile via polling. */
  async broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const channel = await this.getOrSubscribeBroadcastChannel(topic);
      if (!channel) return;
      const result = await channel.send({ type: 'broadcast', event, payload });
      if (result !== 'ok') {
        console.error(`[SupabaseService] Broadcast không gửi được (topic=${topic}, event=${event}): ${result}`);
      }
    } catch (error) {
      console.error(`[SupabaseService] Broadcast thất bại (topic=${topic}, event=${event}):`, error);
    }
  }

  private async getOrSubscribeBroadcastChannel(topic: string): Promise<RealtimeChannel | null> {
    const existing = this.broadcastChannels.get(topic);
    if (existing) return existing;
    if (!this.supabaseClient) return null;

    // ack: true makes send() actually wait for the server's confirmation
    // instead of resolving 'ok' optimistically — so a rejected broadcast
    // shows up as a real, logged failure instead of looking successful.
    const channel = this.supabaseClient.channel(topic, { config: { broadcast: { ack: true } } });
    const subscribed = await new Promise<boolean>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve(true);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve(false);
      });
    });

    if (!subscribed) {
      console.error(`[SupabaseService] Không thể subscribe kênh broadcast (topic=${topic})`);
      return null;
    }
    this.broadcastChannels.set(topic, channel);
    return channel;
  }
}
