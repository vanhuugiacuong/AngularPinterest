import sharp from 'sharp';
import { escapeXml, WatermarkRenderService } from './watermark-render.service';

describe('escapeXml', () => {
  it('escapes all 5 XML-significant characters so watermark text cannot break out of the SVG <text> element', () => {
    expect(escapeXml(`</text><script>alert(1)</script>`)).toBe(
      '&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeXml(`"><image href="evil.svg"/>`)).toBe(
      '&quot;&gt;&lt;image href=&quot;evil.svg&quot;/&gt;',
    );
    expect(escapeXml(`O'Brien & Co`)).toBe('O&apos;Brien &amp; Co');
  });
});

describe('WatermarkRenderService', () => {
  const service = new WatermarkRenderService();

  async function samplePng(width = 200, height = 200): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 100, g: 120, b: 140 } } })
      .png()
      .toBuffer();
  }

  it('applies a mandatory NovaFrame watermark with an SVG-injection payload as the author label without throwing, and produces a valid image', async () => {
    const source = await samplePng();
    const malicious = `</text><image href="https://evil.example/x.svg"/><text>`;
    const output = await service.applyMandatoryWatermark(source, malicious);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });

  it('applies a TEXT personal watermark at a given position', async () => {
    const source = await samplePng();
    const output = await service.applyPersonalWatermark(source, {
      type: 'TEXT',
      text: 'NovaFrame Studio',
      position: 'BOTTOM_RIGHT' as never,
      opacity: 0.7,
      scale: 0.3,
      margin: 0.05,
      rotation: 0,
      tiled: false,
      spacing: 0.5,
    });
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(200);
  });

  it('applies a tiled rotated TEXT watermark (Pro feature) without throwing', async () => {
    const source = await samplePng(400, 400);
    const output = await service.applyPersonalWatermark(source, {
      type: 'TEXT',
      text: 'PRO',
      position: 'MIDDLE_CENTER' as never,
      opacity: 0.4,
      scale: 0.1,
      margin: 0.02,
      rotation: 30,
      tiled: true,
      spacing: 0.5,
    });
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(400);
  });

  it('throws for a LOGO preset with no logo buffer provided', async () => {
    const source = await samplePng();
    await expect(
      service.applyPersonalWatermark(source, {
        type: 'LOGO',
        text: null,
        position: 'BOTTOM_RIGHT' as never,
        opacity: 0.5,
        scale: 0.2,
        margin: 0.03,
        rotation: 0,
        tiled: false,
        spacing: 0.5,
      }),
    ).rejects.toThrow('thiếu file logo');
  });
});
