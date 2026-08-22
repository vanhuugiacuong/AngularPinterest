import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageSearchStore } from '../../../core/services/image-search-store';
import { Pin, PinService } from '../../../core/services/pin';
import { ImageRegionSearch } from './image-region-search';

function makePin(): Pin {
  return {
    id: 'match-1',
    title: 'Ảnh liên quan',
    imageUrl: 'https://example.com/match.jpg',
    userId: 'author-1',
    createdAt: '2026-08-21T00:00:00.000Z',
    isAiGenerated: false,
    user: { id: 'author-1', username: 'artist', plan: 'FREE' },
  };
}

describe('ImageRegionSearch', () => {
  let component: ImageRegionSearch;
  let imageSearchStore: {
    searchByImage: ReturnType<typeof vi.fn>;
    results: () => Pin[];
    error: () => string | null;
  };

  beforeEach(() => {
    imageSearchStore = {
      searchByImage: vi.fn().mockResolvedValue(true),
      results: () => [makePin()],
      error: () => null,
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ImageSearchStore, useValue: imageSearchStore },
        {
          provide: PinService,
          useValue: { getImageProxyUrl: vi.fn().mockReturnValue('/api/pins/source/image-proxy') },
        },
      ],
    });

    component = TestBed.runInInjectionContext(() => new ImageRegionSearch());
    component.imageUrl = 'https://example.com/source.jpg';
    component.pinId = 'source';
  });

  function searchWithFile(file: File): Promise<boolean> {
    return (
      component as unknown as { searchWithFile: (query: File) => Promise<boolean> }
    ).searchWithFile(file);
  }

  it('returns CLIP matches to Pin Detail instead of navigating away', async () => {
    const completed = vi.spyOn(component.searchCompleted, 'emit');
    const closed = vi.spyOn(component.closed, 'emit');

    const query = new File(['cropped'], 'vung-anh.jpg', { type: 'image/jpeg' });
    await searchWithFile(query);

    expect(imageSearchStore.searchByImage).toHaveBeenCalledWith(query);
    expect(completed).toHaveBeenCalledWith(imageSearchStore.results());
    expect(closed).toHaveBeenCalledOnce();
  });

  it('keeps the selector open and does not emit results when search fails', async () => {
    imageSearchStore.searchByImage.mockResolvedValue(false);
    imageSearchStore.error = () => 'Dịch vụ tìm kiếm chưa sẵn sàng.';
    const completed = vi.spyOn(component.searchCompleted, 'emit');
    const closed = vi.spyOn(component.closed, 'emit');

    await searchWithFile(new File(['cropped'], 'vung-anh.jpg', { type: 'image/jpeg' }));

    expect(component.submitError()).toBe('Dịch vụ tìm kiếm chưa sẵn sàng.');
    expect(completed).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
});
