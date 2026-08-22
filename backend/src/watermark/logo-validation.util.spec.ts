import { BadRequestException } from '@nestjs/common';
import { detectImageFormat, validateLogoBuffer, MAX_LOGO_BYTES } from './logo-validation.util';

describe('detectImageFormat', () => {
  it('identifies PNG by magic bytes, not by claimed extension/content-type', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageFormat(png)).toBe('png');
  });
  it('identifies JPEG by magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageFormat(jpeg)).toBe('jpeg');
  });
  it('identifies WebP by RIFF....WEBP signature', () => {
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');
    expect(detectImageFormat(webp)).toBe('webp');
  });
  it('rejects a file whose bytes are not a real image (e.g. an SVG or script masquerading as a logo)', () => {
    const fakeSvg = Buffer.from('<svg onload="alert(1)"></svg>');
    expect(detectImageFormat(fakeSvg)).toBeNull();
  });
});

describe('validateLogoBuffer', () => {
  const validPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

  it('accepts a well-formed PNG under the size limit', () => {
    expect(() => validateLogoBuffer(validPng)).not.toThrow();
  });
  it('rejects an oversized file even if the magic bytes are valid', () => {
    const huge = Buffer.concat([validPng, Buffer.alloc(MAX_LOGO_BYTES)]);
    expect(() => validateLogoBuffer(huge)).toThrow(BadRequestException);
  });
  it('rejects a file with no recognizable image signature (SVG/XML injection vector)', () => {
    const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() => validateLogoBuffer(fake)).toThrow(BadRequestException);
  });
  it('rejects an empty file', () => {
    expect(() => validateLogoBuffer(Buffer.alloc(0))).toThrow(BadRequestException);
  });
});
