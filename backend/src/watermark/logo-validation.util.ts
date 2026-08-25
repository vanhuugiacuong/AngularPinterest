import { BadRequestException } from '@nestjs/common';

export const MAX_LOGO_BYTES = 3 * 1024 * 1024; // 3MB
export const MAX_LOGO_DIMENSION = 4000; // px, chống decompression bomb

type AllowedFormat = 'png' | 'jpeg' | 'webp';

// Xác định định dạng thật từ magic bytes (chữ ký file) - không tin đuôi file
// hay Content-Type do client gửi lên.
export function detectImageFormat(buffer: Buffer): AllowedFormat | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'webp';
  return null;
}

export function validateLogoBuffer(buffer: Buffer): AllowedFormat {
  if (buffer.length === 0) throw new BadRequestException('File logo trống.');
  if (buffer.length > MAX_LOGO_BYTES) throw new BadRequestException('File logo vượt quá 3MB.');
  const format = detectImageFormat(buffer);
  if (!format) throw new BadRequestException('Logo phải là PNG, JPEG hoặc WebP hợp lệ.');
  return format;
}
