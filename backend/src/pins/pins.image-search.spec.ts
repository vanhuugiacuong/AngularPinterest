import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PinsService } from './pins.service';

function makeRow(overrides: Partial<{
  id: string;
  imageUrl: string;
  similarity: number;
  authorPlan: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'pin-1',
    title: 'Frame',
    description: null,
    imageUrl: overrides.imageUrl ?? 'https://cdn.example.com/pin-1.jpg',
    sourceUrl: null,
    userId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    isAiGenerated: false,
    category: 'other',
    authorUsername: 'artist',
    authorAvatarUrl: null,
    authorPlan: overrides.authorPlan ?? 'FREE',
    likesCount: 0,
    similarity: overrides.similarity ?? 0.9,
  };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-image-bytes'),
    originalname: 'query.jpg',
    mimetype: 'image/jpeg',
    size: 16,
    fieldname: 'image',
    encoding: '7bit',
    ...overrides,
  } as Express.Multer.File;
}

describe('PinsService.searchPinsByImage', () => {
  let queryRawUnsafe: jest.Mock;
  let prisma: { $queryRawUnsafe: jest.Mock; auction: { findMany: jest.Mock } };
  let service: PinsService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    queryRawUnsafe = jest.fn();
    prisma = { $queryRawUnsafe: queryRawUnsafe, auction: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new PinsService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  afterEach(() => jest.restoreAllMocks());

  function mockClipEmbedSuccess(embedding: number[] = [0.1, 0.2, 0.3]) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding }),
    });
  }

  it('rejects when no file is provided', async () => {
    await expect(service.searchPinsByImage(undefined, 1, 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types before calling CLIP or the database', async () => {
    const file = makeFile({ mimetype: 'image/gif' });
    await expect(service.searchPinsByImage(file, 1, 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('reports the CLIP service as unavailable instead of returning fake results', async () => {
    fetchMock.mockResolvedValue({ ok: false, statusText: 'Service Unavailable', text: async () => '' });

    await expect(service.searchPinsByImage(makeFile(), 1, 20)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('also reports unavailable when the CLIP request throws (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.searchPinsByImage(makeFile(), 1, 20)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns matches sorted by descending similarity, drops rows below the threshold and duplicate image URLs', async () => {
    mockClipEmbedSuccess();
    // Rows arrive pre-sorted by the SQL ORDER BY (ascending distance = descending similarity),
    // matching what Postgres actually returns.
    queryRawUnsafe.mockResolvedValue([
      makeRow({ id: 'best', similarity: 0.92, imageUrl: 'https://cdn.example.com/a.jpg' }),
      makeRow({ id: 'good', similarity: 0.75, imageUrl: 'https://cdn.example.com/b.jpg' }),
      // Same image URL as "good" but a lower score — must be deduped out, not returned as a second hit.
      makeRow({ id: 'dup-url', similarity: 0.7, imageUrl: 'https://cdn.example.com/b.jpg' }),
      // Clears the absolute floor (0.45 default) but too far from the best match (gap > 0.25 default).
      makeRow({ id: 'too-far', similarity: 0.6, imageUrl: 'https://cdn.example.com/c.jpg' }),
      // Below the absolute floor entirely.
      makeRow({ id: 'irrelevant', similarity: 0.3, imageUrl: 'https://cdn.example.com/d.jpg' }),
    ]);

    const results = await service.searchPinsByImage(makeFile(), 1, 20);

    expect(results.map((r) => r.id)).toEqual(['best', 'good']);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results.every((r) => r.similarity >= 0.45)).toBe(true);
  });

  it('returns an empty array — not weaker fallback matches — when nothing clears the threshold', async () => {
    mockClipEmbedSuccess();
    queryRawUnsafe.mockResolvedValue([
      makeRow({ id: 'weak-1', similarity: 0.3 }),
      makeRow({ id: 'weak-2', similarity: 0.2 }),
    ]);

    const results = await service.searchPinsByImage(makeFile(), 1, 20);

    expect(results).toEqual([]);
  });

  it('returns an empty array when the catalog has no results at all', async () => {
    mockClipEmbedSuccess();
    queryRawUnsafe.mockResolvedValue([]);

    const results = await service.searchPinsByImage(makeFile(), 1, 20);

    expect(results).toEqual([]);
  });

  it('exposes the similarity score on each result for debugging/ranking verification', async () => {
    mockClipEmbedSuccess();
    queryRawUnsafe.mockResolvedValue([makeRow({ id: 'best', similarity: 0.9 })]);

    const [result] = await service.searchPinsByImage(makeFile(), 1, 20);

    expect(result.similarity).toBe(0.9);
  });

  it("maps the author's membership plan from the joined row onto result.user.plan", async () => {
    mockClipEmbedSuccess();
    queryRawUnsafe.mockResolvedValue([makeRow({ id: 'best', similarity: 0.9, authorPlan: 'PRO' })]);

    const [result] = await service.searchPinsByImage(makeFile(), 1, 20);

    expect(result.user.plan).toBe('PRO');
  });

  it('falls back to FREE when the joined row has no plan (e.g. deleted author)', async () => {
    mockClipEmbedSuccess();
    queryRawUnsafe.mockResolvedValue([makeRow({ id: 'best', similarity: 0.9, authorPlan: null })]);

    const [result] = await service.searchPinsByImage(makeFile(), 1, 20);

    expect(result.user.plan).toBe('FREE');
  });
});
