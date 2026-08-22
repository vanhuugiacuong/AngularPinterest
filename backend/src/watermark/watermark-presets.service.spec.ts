import { ForbiddenException } from '@nestjs/common';
import { WatermarkPresetsService } from './watermark-presets.service';

describe('WatermarkPresetsService entitlement enforcement', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    watermarkPreset: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  };
  const supabase = { uploadPrivate: jest.fn() };
  const render = {};
  const service = new WatermarkPresetsService(prisma as never, supabase as never, render as never);

  beforeEach(() => jest.clearAllMocks());

  it('blocks a FREE user from creating any watermark preset', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    await expect(
      service.create('user-1', { name: 'x', type: 'TEXT', text: 'hi' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks a PLUS user from creating a 2nd preset (max 1)', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' });
    prisma.watermarkPreset.count.mockResolvedValue(1); // already has 1
    await expect(
      service.create('user-1', { name: 'x', type: 'TEXT', text: 'hi' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks a PLUS user from using tiled/rotation (Pro-only advanced features)', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' });
    await expect(
      service.create('user-1', { name: 'x', type: 'TEXT', text: 'hi', tiled: true }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.create('user-1', { name: 'x', type: 'TEXT', text: 'hi', rotation: 45 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a PRO user to use tiled + rotation and create beyond 1 preset', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO' });
    prisma.watermarkPreset.count.mockResolvedValue(5);
    prisma.watermarkPreset.create.mockResolvedValue({ id: 'preset-1' });
    const result = await service.create('user-1', { name: 'x', type: 'TEXT', text: 'hi', tiled: true, rotation: 30 });
    expect(result).toEqual({ id: 'preset-1' });
  });

  it('rejects a LOGO-type preset with no file attached', async () => {
    prisma.user.findUnique.mockResolvedValue({ plan: 'PRO' });
    await expect(
      service.create('user-1', { name: 'x', type: 'LOGO' }),
    ).rejects.toThrow('Thiếu file logo.');
  });
});
