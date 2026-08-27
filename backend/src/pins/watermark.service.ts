import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Tạo bản xem trước có watermark cho ảnh Premium.
 *
 * Vì sao cần: trình duyệt BẮT BUỘC phải tải file ảnh về máy người xem thì mới
 * hiển thị được — nên mọi cách chặn phía giao diện (chặn chuột phải, chặn F12)
 * đều chỉ là rào cản, mở tab Network là lấy được file đang hiển thị.
 *
 * Cách chặn thật duy nhất: thứ hiển thị công khai KHÔNG PHẢI là file gốc.
 * Bản public bị hạ chất lượng + đóng dấu chìm; bản gốc HD nằm trong bucket
 * riêng tư, chỉ cấp link ký tạm thời cho người đã mua.
 */
@Injectable()
export class WatermarkService {
  /** Cạnh dài tối đa của bản preview — đủ xem, không đủ dùng lại. */
  private readonly PREVIEW_MAX_EDGE = 900;

  /**
   * Trả về bản preview: thu nhỏ, nén, phủ chữ chìm lặp kín mặt ảnh.
   *
   * Watermark phủ **toàn bộ** ảnh chứ không chỉ một góc — dấu ở góc thì crop
   * một phát là mất, phủ kín thì cắt kiểu gì cũng dính.
   */
  async makePreview(original: Buffer, label = 'PinHub'): Promise<Buffer> {
    const img = sharp(original, { failOn: 'none' });
    const meta = await img.metadata();

    const w = meta.width ?? this.PREVIEW_MAX_EDGE;
    const h = meta.height ?? this.PREVIEW_MAX_EDGE;
    const scale = Math.min(1, this.PREVIEW_MAX_EDGE / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const overlay = Buffer.from(this.buildWatermarkSvg(outW, outH, label));

    return sharp(original, { failOn: 'none' })
      .resize(outW, outH, { fit: 'inside', withoutEnlargement: true })
      .composite([{ input: overlay, blend: 'over' }])
      // Chất lượng vừa đủ nhìn — người lấy trộm cũng không dùng in ấn được.
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  }

  /** Lưới chữ chìm nghiêng 30°, lặp kín khung ảnh. */
  private buildWatermarkSvg(width: number, height: number, label: string): string {
    const step = Math.max(150, Math.round(Math.min(width, height) / 3.2));
    const fontSize = Math.max(16, Math.round(step / 7));
    const safe = label.replace(/[<>&"']/g, '');

    const rows: string[] = [];
    for (let y = -height; y < height * 2; y += step) {
      for (let x = -width; x < width * 2; x += step) {
        rows.push(
          `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" ` +
            `font-weight="700" fill="#ffffff" fill-opacity="0.22">${safe}</text>`,
        );
      }
    }

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-30 ${width / 2} ${height / 2})">${rows.join('')}</g>
    </svg>`;
  }
}
