import { ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { PinDownloadService } from './pin-download.service';
import { WatermarkRenderService } from './watermark-render.service';

async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
}

describe('PinDownloadService', () => {
  const prisma = {
    pin: { findUnique: jest.fn() },
    imagePurchase: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    auction: { count: jest.fn().mockResolvedValue(0) },
  };
  const supabase = { downloadPrivate: jest.fn() };
  const memberships = { status: jest.fn() };
  const render = new WatermarkRenderService();
  const presets = { getOwned: jest.fn(), getLogoBuffer: jest.fn() };
  const service = new PinDownloadService(prisma as never, supabase as never, memberships as never, render, presets as never);

  beforeEach(() => jest.clearAllMocks());

  it('forces the mandatory NovaFrame watermark for a FREE downloader, even for their own pin', async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1', userId: 'owner-1', isForSale: false, originalStoragePath: 'owner-1/x.png', imageUrl: 'https://x',
      user: { id: 'owner-1', username: 'artist' },
    });
    memberships.status.mockResolvedValue({ cleanDownload: false });
    supabase.downloadPrivate.mockResolvedValue(await samplePng());

    const result = await service.download('owner-1', 'pin-1');

    expect(result.filename).toContain('novaframe');
  });

  it('gives a PLUS/PRO downloader a clean image when no watermark preset is requested', async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1', userId: 'owner-1', isForSale: false, originalStoragePath: 'owner-1/x.png', imageUrl: 'https://x',
      user: { id: 'owner-1', username: 'artist' },
    });
    memberships.status.mockResolvedValue({ cleanDownload: true });
    supabase.downloadPrivate.mockResolvedValue(await samplePng());

    const result = await service.download('owner-1', 'pin-1');

    expect(result.filename).toContain('goc');
  });

  it('blocks downloading a for-sale pin the buyer has not paid for', async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1', userId: 'seller-1', isForSale: true, originalStoragePath: 'seller-1/x.png', imageUrl: 'https://x',
      user: { id: 'seller-1', username: 'artist' },
    });
    prisma.imagePurchase.findUnique.mockResolvedValue(null); // never purchased

    await expect(service.download('buyer-1', 'pin-1')).rejects.toThrow(ForbiddenException);
  });

  it('blocks downloading a for-sale pin whose purchase is still PENDING (not yet PAID)', async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1', userId: 'seller-1', isForSale: true, originalStoragePath: 'seller-1/x.png', imageUrl: 'https://x',
      user: { id: 'seller-1', username: 'artist' },
    });
    prisma.imagePurchase.findUnique.mockResolvedValue({ status: 'PENDING' });

    await expect(service.download('buyer-1', 'pin-1')).rejects.toThrow(ForbiddenException);
  });

  it('allows downloading a for-sale pin once the purchase is PAID', async () => {
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1', userId: 'seller-1', isForSale: true, originalStoragePath: 'seller-1/x.png', imageUrl: 'https://x',
      user: { id: 'seller-1', username: 'artist' },
    });
    prisma.imagePurchase.findUnique.mockResolvedValue({ status: 'PAID' });
    memberships.status.mockResolvedValue({ cleanDownload: false });
    supabase.downloadPrivate.mockResolvedValue(await samplePng());

    const result = await service.download('buyer-1', 'pin-1');
    expect(result.buffer).toBeInstanceOf(Buffer);
  });
});
