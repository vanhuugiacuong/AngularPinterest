import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { WatermarkPosition, WatermarkPreset } from '@prisma/client';
import { MAX_LOGO_DIMENSION, validateLogoBuffer } from './logo-validation.util';

// Escape nội dung trước khi nhúng vào SVG - bắt buộc để chặn SVG/XML injection
// (watermark text đến từ input người dùng). Exported riêng để test trực tiếp.
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function anchorFor(position: WatermarkPosition): { x: 'start' | 'middle' | 'end'; y: 'top' | 'middle' | 'bottom' } {
  const [v, h] = position.split('_') as [string, string];
  const y = v === 'TOP' ? 'top' : v === 'BOTTOM' ? 'bottom' : 'middle';
  const x = h === 'LEFT' ? 'start' : h === 'RIGHT' ? 'end' : 'middle';
  return { x, y };
}

export interface RenderOptions {
  position: WatermarkPosition;
  opacity: number; // 0-1
  scale: number; // 0-1, tỉ lệ so với chiều rộng ảnh
  margin: number; // 0-1, tỉ lệ so với chiều rộng ảnh
  rotation: number; // độ
  tiled: boolean;
  spacing: number; // 0-1, tỉ lệ khoảng cách khi tiled
}

@Injectable()
export class WatermarkRenderService {
  // Watermark chữ NovaFrame bắt buộc cho gói Free - không thể tắt, không phải
  // cấu hình cá nhân. Luôn 1 dòng góc dưới-phải, không tiled.
  async applyMandatoryWatermark(imageBuffer: Buffer, authorLabel: string): Promise<Buffer> {
    return this.compositeText(imageBuffer, `NovaFrame · ${authorLabel}`, {
      position: 'BOTTOM_RIGHT' as WatermarkPosition,
      opacity: 0.75,
      scale: 1,
      margin: 0.03,
      rotation: 0,
      tiled: false,
      spacing: 0.5,
    });
  }

  async applyPersonalWatermark(
    imageBuffer: Buffer,
    preset: Pick<WatermarkPreset, 'type' | 'text' | 'position' | 'opacity' | 'scale' | 'margin' | 'rotation' | 'tiled' | 'spacing'>,
    logoBuffer?: Buffer,
  ): Promise<Buffer> {
    const options: RenderOptions = {
      position: preset.position,
      opacity: preset.opacity,
      scale: preset.scale,
      margin: preset.margin,
      rotation: preset.rotation,
      tiled: preset.tiled,
      spacing: preset.spacing,
    };
    if (preset.type === 'LOGO') {
      if (!logoBuffer) throw new BadRequestException('Preset dạng logo nhưng thiếu file logo.');
      return this.compositeLogo(imageBuffer, logoBuffer, options);
    }
    if (!preset.text?.trim()) throw new BadRequestException('Preset dạng chữ nhưng thiếu nội dung.');
    return this.compositeText(imageBuffer, preset.text.trim(), options);
  }

  private async baseMeta(imageBuffer: Buffer) {
    const image = sharp(imageBuffer, { limitInputPixels: 60_000_000 });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new BadRequestException('Không đọc được kích thước ảnh.');
    return { image, meta, width: meta.width, height: meta.height };
  }

  private async compositeText(imageBuffer: Buffer, text: string, options: RenderOptions): Promise<Buffer> {
    const { image, meta, width, height } = await this.baseMeta(imageBuffer);
    const fontSize = Math.max(12, Math.round(width * 0.035 * Math.max(0.3, options.scale)));
    const margin = Math.round(width * options.margin);
    const escaped = escapeXml(text);

    let svg: string;
    if (options.tiled) {
      svg = this.buildTiledTextSvg(escaped, width, height, fontSize, options);
    } else {
      const { x, y } = anchorFor(options.position);
      const textX = x === 'start' ? margin : x === 'end' ? width - margin : width / 2;
      const textY = y === 'top' ? margin + fontSize : y === 'bottom' ? height - margin : height / 2;
      svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="${textX}" y="${textY}" font-family="sans-serif" font-size="${fontSize}" font-weight="600"
          fill="#ffffff" fill-opacity="${options.opacity}" stroke="#000000" stroke-opacity="${options.opacity * 0.5}" stroke-width="${Math.max(1, fontSize * 0.03)}"
          text-anchor="${x}" transform="rotate(${options.rotation} ${textX} ${textY})">${escaped}</text>
      </svg>`;
    }

    const overlay = Buffer.from(svg);
    const output = await image.composite([{ input: overlay, top: 0, left: 0 }]).toFormat(meta.format ?? 'jpeg').toBuffer();
    return output;
  }

  private buildTiledTextSvg(escapedText: string, width: number, height: number, fontSize: number, options: RenderOptions): string {
    const stepX = fontSize * (6 + options.spacing * 10);
    const stepY = fontSize * (3 + options.spacing * 6);
    const rows: string[] = [];
    for (let y = fontSize; y < height + stepY; y += stepY) {
      for (let x = 0; x < width + stepX; x += stepX) {
        rows.push(
          `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#ffffff" fill-opacity="${options.opacity}" transform="rotate(${options.rotation} ${x} ${y})">${escapedText}</text>`,
        );
      }
    }
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rows.join('')}</svg>`;
  }

  private async compositeLogo(imageBuffer: Buffer, logoBuffer: Buffer, options: RenderOptions): Promise<Buffer> {
    validateLogoBuffer(logoBuffer);
    const { image, meta, width, height } = await this.baseMeta(imageBuffer);
    const logoMeta = await sharp(logoBuffer).metadata();
    if ((logoMeta.width ?? 0) > MAX_LOGO_DIMENSION || (logoMeta.height ?? 0) > MAX_LOGO_DIMENSION) {
      throw new BadRequestException(`Logo vượt quá độ phân giải tối đa ${MAX_LOGO_DIMENSION}px.`);
    }

    const targetWidth = Math.max(16, Math.round(width * Math.max(0.05, Math.min(1, options.scale))));
    const resizedLogo = sharp(logoBuffer).resize({ width: targetWidth, fit: 'inside' }).ensureAlpha();
    const resizedMeta = await resizedLogo.metadata();
    const logoWidth = resizedMeta.width ?? targetWidth;
    const logoHeight = resizedMeta.height ?? targetWidth;

    // Nhân kênh alpha với opacity mong muốn (giữ nguyên alpha gốc của logo,
    // không ghi đè cứng thành 1 giá trị) rồi rotate nếu cần.
    let logoBufferWithOpacity = await resizedLogo
      .composite([{ input: { create: { width: logoWidth, height: logoHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 - options.opacity } } }, blend: 'dest-out' }])
      .png()
      .toBuffer();
    if (options.rotation) {
      logoBufferWithOpacity = await sharp(logoBufferWithOpacity).rotate(options.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    }
    const rotatedMeta = await sharp(logoBufferWithOpacity).metadata();
    const finalWidth = rotatedMeta.width ?? logoWidth;
    const finalHeight = rotatedMeta.height ?? logoHeight;

    const margin = Math.round(width * options.margin);
    const composites: sharp.OverlayOptions[] = [];
    if (options.tiled) {
      const stepX = finalWidth * (1.5 + options.spacing * 3);
      const stepY = finalHeight * (1.5 + options.spacing * 3);
      for (let y = 0; y < height; y += stepY) {
        for (let x = 0; x < width; x += stepX) {
          composites.push({ input: logoBufferWithOpacity, top: Math.round(y), left: Math.round(x) });
        }
      }
    } else {
      const { x, y } = anchorFor(options.position);
      const left = x === 'start' ? margin : x === 'end' ? width - finalWidth - margin : Math.round((width - finalWidth) / 2);
      const top = y === 'top' ? margin : y === 'bottom' ? height - finalHeight - margin : Math.round((height - finalHeight) / 2);
      composites.push({ input: logoBufferWithOpacity, top: Math.max(0, top), left: Math.max(0, left) });
    }

    return image.composite(composites).toFormat(meta.format ?? 'jpeg').toBuffer();
  }
}
