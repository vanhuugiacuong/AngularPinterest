import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { WatermarkRenderService } from './watermark-render.service';

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Generates and stores Pin.protectedImageUrl — a mandatory-watermark
 * variant of a pin's public preview — the moment a pin becomes commerce-
 * restricted (listed for a fixed price, or put up for auction). This is
 * the image non-owner/non-buyer viewers see instead of the real preview
 * (see common/pin-access.util.ts for where it's substituted in). Idempotent:
 * a pin that already has one is left untouched. Failures are logged and
 * swallowed rather than thrown, since this always runs as a side effect of
 * another request (upload, list-for-sale, create-auction) that must still
 * succeed even if watermark generation has a transient hiccup — the
 * request-time gate in pin-access.util.ts falls back to the real preview
 * in that case, so nothing is silently left unprotected forever; the next
 * write to this pin's commerce state retries generation. */
@Injectable()
export class PinPreviewProtectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly watermarkRender: WatermarkRenderService,
  ) {}

  async ensureProtectedPreview(pinId: string): Promise<void> {
    try {
      const pin = await this.prisma.pin.findUnique({
        where: { id: pinId },
        select: {
          id: true,
          userId: true,
          imageUrl: true,
          protectedImageUrl: true,
          user: { select: { username: true } },
        },
      });
      if (!pin || pin.protectedImageUrl) return;

      const response = await fetch(pin.imageUrl);
      if (!response.ok) {
        console.error(`[PinPreviewProtectionService] Không tải được preview gốc cho pin ${pinId}: HTTP ${response.status}`);
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const watermarked = await this.watermarkRender.applyMandatoryWatermark(buffer, pin.user.username);

      const meta = await sharp(watermarked).metadata();
      const format = meta.format ?? 'jpeg';
      const contentType = CONTENT_TYPE_BY_FORMAT[format] ?? 'image/jpeg';
      const ext = format === 'jpeg' ? 'jpg' : format;
      const path = `${pin.userId}/${pin.id}_protected.${ext}`;

      const url = await this.supabase.uploadImage('pins', path, watermarked, contentType);
      await this.prisma.pin.update({ where: { id: pinId }, data: { protectedImageUrl: url } });
    } catch (error) {
      console.error(`[PinPreviewProtectionService] Không thể tạo protected preview cho pin ${pinId}:`, error);
    }
  }
}
