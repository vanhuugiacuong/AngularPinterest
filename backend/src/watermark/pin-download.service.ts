import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { MembershipsService } from '../memberships/memberships.service';
import { WatermarkRenderService } from './watermark-render.service';
import { WatermarkPresetsService } from './watermark-presets.service';
import { writeAuditLog } from '../memberships/audit.util';

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

@Injectable()
export class PinDownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly memberships: MembershipsService,
    private readonly render: WatermarkRenderService,
    private readonly presets: WatermarkPresetsService,
  ) {}

  async download(userId: string, pinId: string, watermarkPresetId?: string) {
    const pin = await this.prisma.pin.findUnique({
      where: { id: pinId },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!pin) throw new NotFoundException('Không tìm thấy ảnh.');

    if (pin.userId !== userId && pin.isForSale) {
      const purchase = await this.prisma.imagePurchase.findUnique({
        where: { pinId_buyerId: { pinId, buyerId: userId } },
      });
      if (!purchase || purchase.status !== 'PAID') {
        throw new ForbiddenException('Bạn cần mua ảnh này trước khi tải bản đầy đủ.');
      }
    }

    const status = await this.memberships.status(userId);
    const originalBuffer = await this.loadOriginalBytes(pin);

    let outputBuffer: Buffer;
    let variant: string;

    if (!status.cleanDownload) {
      outputBuffer = await this.render.applyMandatoryWatermark(originalBuffer, pin.user.username);
      variant = 'novaframe';
    } else if (watermarkPresetId) {
      const preset = await this.presets.getOwned(userId, watermarkPresetId);
      const logoBuffer = await this.presets.getLogoBuffer(preset);
      outputBuffer = await this.render.applyPersonalWatermark(originalBuffer, preset, logoBuffer);
      variant = 'watermark';
    } else {
      // Vẫn đi qua sharp 1 lần để loại bỏ EXIF/GPS khỏi bản tải, dù không watermark.
      outputBuffer = await sharp(originalBuffer, { limitInputPixels: 60_000_000 }).toBuffer();
      variant = 'goc';
    }

    const meta = await sharp(outputBuffer).metadata();
    const format = meta.format ?? 'jpeg';
    const contentType = CONTENT_TYPE_BY_FORMAT[format] ?? 'application/octet-stream';

    await writeAuditLog(this.prisma, userId, 'PIN_DOWNLOADED', { pinId, variant, cleanDownload: status.cleanDownload });

    return { buffer: outputBuffer, contentType, filename: `${pin.id}-${variant}.${format === 'jpeg' ? 'jpg' : format}` };
  }

  private async loadOriginalBytes(pin: { imageUrl: string; originalStoragePath: string | null }): Promise<Buffer> {
    if (pin.originalStoragePath) {
      return this.supabase.downloadPrivate('pins-original', pin.originalStoragePath);
    }
    // Pin chưa được backfill sang bucket private - tạm thời vẫn phục vụ qua
    // backend (không đổi hành vi bảo mật hiện có, vì imageUrl vốn đã public).
    const response = await fetch(pin.imageUrl);
    if (!response.ok) throw new NotFoundException('Không tải được ảnh gốc.');
    return Buffer.from(await response.arrayBuffer());
  }
}
