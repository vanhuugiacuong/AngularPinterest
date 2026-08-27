import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { WatermarkPosition, WatermarkType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PLAN_ENTITLEMENTS } from '../memberships/entitlements';
import { SupabaseService } from '../supabase/supabase.service';
import { validateLogoBuffer } from './logo-validation.util';
import { WatermarkRenderService } from './watermark-render.service';

const POSITIONS = Object.values(WatermarkPosition);

export interface WatermarkPresetInput {
  name?: string;
  type: WatermarkType;
  text?: string;
  position?: WatermarkPosition;
  opacity?: number;
  scale?: number;
  margin?: number;
  rotation?: number;
  tiled?: boolean;
  spacing?: number;
  isDefault?: boolean;
}

@Injectable()
export class WatermarkPresetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly render: WatermarkRenderService,
  ) {}

  // Xem trước watermark trên 1 pin thật của chính người dùng, trước khi lưu
  // preset. Không ghi DB, không cần preset đã tồn tại.
  async preview(userId: string, pinId: string, input: WatermarkPresetInput, logoBuffer?: Buffer) {
    await this.validateInput(userId, input, logoBuffer);
    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (!pin || pin.userId !== userId) throw new NotFoundException('Không tìm thấy ảnh của bạn để xem trước.');

    let originalBuffer: Buffer;
    if (pin.originalStoragePath) {
      try {
        originalBuffer = await this.supabase.downloadPrivate('pins-original', pin.originalStoragePath);
      } catch (err) {
        console.warn('[WatermarkPresetsService] Could not download original from private storage, falling back to public imageUrl:', err);
        originalBuffer = Buffer.from(await (await fetch(pin.imageUrl)).arrayBuffer());
      }
    } else {
      originalBuffer = Buffer.from(await (await fetch(pin.imageUrl)).arrayBuffer());
    }

    // Ảnh xem trước được giới hạn kích thước để nhẹ - vẫn đủ để đánh giá bố cục.
    const previewSource = await sharp(originalBuffer, { limitInputPixels: 60_000_000 })
      .resize({ width: 1000, withoutEnlargement: true })
      .toBuffer();

    return this.render.applyPersonalWatermark(
      previewSource,
      {
        type: input.type,
        text: input.text ?? null,
        position: input.position ?? 'BOTTOM_RIGHT',
        opacity: this.clamp(input.opacity ?? 0.6, 0.05, 1),
        scale: this.clamp(input.scale ?? 0.2, 0.02, 1),
        margin: this.clamp(input.margin ?? 0.03, 0, 0.2),
        rotation: this.clamp(input.rotation ?? 0, -180, 180),
        tiled: Boolean(input.tiled),
        spacing: this.clamp(input.spacing ?? 0.5, 0, 1),
      },
      logoBuffer,
    );
  }

  async list(userId: string) {
    return this.prisma.watermarkPreset.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async getOwned(userId: string, id: string) {
    const preset = await this.prisma.watermarkPreset.findUnique({ where: { id } });
    if (!preset || preset.userId !== userId) throw new NotFoundException('Không tìm thấy cấu hình watermark.');
    return preset;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private async validateInput(userId: string, input: WatermarkPresetInput, logoBuffer?: Buffer, isUpdate = false) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, isAdmin: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    // Admin luôn được coi như đang ở gói Pro - toàn quyền watermark nâng cao.
    const entitlements = PLAN_ENTITLEMENTS[user.isAdmin ? 'PRO' : user.plan];
    if (!entitlements.customWatermark) {
      throw new ForbiddenException('Gói hiện tại không hỗ trợ tạo watermark cá nhân.');
    }

    if (!input.name?.trim()) throw new BadRequestException('Thiếu tên cấu hình.');
    if (input.type !== 'TEXT' && input.type !== 'LOGO') throw new BadRequestException('Loại watermark không hợp lệ.');
    if (input.type === 'TEXT' && !input.text?.trim()) throw new BadRequestException('Thiếu nội dung chữ.');
    if (input.type === 'LOGO' && !logoBuffer && !isUpdate) throw new BadRequestException('Thiếu file logo.');
    if (input.position && !POSITIONS.includes(input.position)) throw new BadRequestException('Vị trí không hợp lệ.');

    const usesAdvanced = Boolean(input.tiled) || Boolean(input.rotation && input.rotation !== 0);
    if (usesAdvanced && !entitlements.advancedWatermark) {
      throw new ForbiddenException('Watermark lặp (tiled) và xoay góc chỉ dành cho gói Pro.');
    }

    if (logoBuffer) validateLogoBuffer(logoBuffer);

    return { entitlements, user };
  }

  async create(userId: string, input: WatermarkPresetInput, logoBuffer?: Buffer) {
    const { entitlements } = await this.validateInput(userId, input, logoBuffer);

    const existingCount = await this.prisma.watermarkPreset.count({ where: { userId } });
    if (existingCount >= entitlements.maxWatermarkPresets) {
      throw new ForbiddenException(
        entitlements.maxWatermarkPresets <= 1
          ? 'Gói Plus chỉ được lưu 1 cấu hình watermark. Nâng cấp Pro để lưu nhiều cấu hình.'
          : 'Bạn đã đạt số lượng cấu hình watermark tối đa cho gói hiện tại.',
      );
    }

    let logoStoragePath: string | undefined;
    if (logoBuffer) {
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      await this.supabase.uploadPrivate('watermark-logos', path, logoBuffer, 'image/png');
      logoStoragePath = path;
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.watermarkPreset.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.watermarkPreset.create({
        data: {
          userId,
          name: input.name!.trim(),
          type: input.type,
          text: input.type === 'TEXT' ? input.text!.trim() : null,
          logoStoragePath,
          position: input.position ?? 'BOTTOM_RIGHT',
          opacity: this.clamp(input.opacity ?? 0.6, 0.05, 1),
          scale: this.clamp(input.scale ?? 0.2, 0.02, 1),
          margin: this.clamp(input.margin ?? 0.03, 0, 0.2),
          rotation: this.clamp(input.rotation ?? 0, -180, 180),
          tiled: Boolean(input.tiled),
          spacing: this.clamp(input.spacing ?? 0.5, 0, 1),
          isDefault: Boolean(input.isDefault),
        },
      });
    });
  }

  async update(userId: string, id: string, input: WatermarkPresetInput, logoBuffer?: Buffer) {
    const existing = await this.getOwned(userId, id);
    await this.validateInput(userId, { ...input, type: input.type ?? existing.type }, logoBuffer, true);

    let logoStoragePath = existing.logoStoragePath;
    if (logoBuffer) {
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      await this.supabase.uploadPrivate('watermark-logos', path, logoBuffer, 'image/png');
      logoStoragePath = path;
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.watermarkPreset.updateMany({ where: { userId, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.watermarkPreset.update({
        where: { id },
        data: {
          name: input.name?.trim() ?? existing.name,
          type: input.type ?? existing.type,
          text: (input.type ?? existing.type) === 'TEXT' ? (input.text?.trim() ?? existing.text) : null,
          logoStoragePath,
          position: input.position ?? existing.position,
          opacity: input.opacity !== undefined ? this.clamp(input.opacity, 0.05, 1) : existing.opacity,
          scale: input.scale !== undefined ? this.clamp(input.scale, 0.02, 1) : existing.scale,
          margin: input.margin !== undefined ? this.clamp(input.margin, 0, 0.2) : existing.margin,
          rotation: input.rotation !== undefined ? this.clamp(input.rotation, -180, 180) : existing.rotation,
          tiled: input.tiled !== undefined ? Boolean(input.tiled) : existing.tiled,
          spacing: input.spacing !== undefined ? this.clamp(input.spacing, 0, 1) : existing.spacing,
          isDefault: input.isDefault !== undefined ? Boolean(input.isDefault) : existing.isDefault,
        },
      });
    });
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.watermarkPreset.delete({ where: { id } });
    return { ok: true };
  }

  async getLogoBuffer(preset: { logoStoragePath: string | null }): Promise<Buffer | undefined> {
    if (!preset.logoStoragePath) return undefined;
    return this.supabase.downloadPrivate('watermark-logos', preset.logoStoragePath);
  }
}
