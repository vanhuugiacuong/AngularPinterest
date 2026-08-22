import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../core/services/board';
import { MembershipService } from '../../core/services/membership';
import { Pin, PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { PinDetail } from './pin-detail';

function makePin(id: string): Pin {
  return {
    id,
    title: `Ảnh ${id}`,
    imageUrl: `https://example.com/${id}.jpg`,
    userId: 'author-1',
    createdAt: '2026-08-21T00:00:00.000Z',
    isAiGenerated: false,
    _count: { likes: 2 },
    user: { id: 'author-1', username: 'artist', plan: 'FREE' },
  };
}

describe('PinDetail visual search results', () => {
  let component: PinDetail;
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    router = { navigate: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of() } },
        { provide: Router, useValue: router },
        { provide: PinService, useValue: {} },
        { provide: BoardService, useValue: {} },
        {
          provide: SupabaseService,
          useValue: { dbUser: () => null, user: () => null },
        },
        {
          provide: MembershipService,
          useValue: { status: () => null },
        },
      ],
    });

    component = TestBed.runInInjectionContext(() => new PinDetail());
    (component as unknown as { currentPinId: string }).currentPinId = 'source';
  });

  afterEach(() => vi.useRealTimers());

  it('replaces the gallery in place, excludes the current pin and scrolls to it', () => {
    const scrollIntoView = vi.fn();
    component.relatedSection = {
      nativeElement: { scrollIntoView },
    } as unknown as typeof component.relatedSection;
    component.showImageSearch.set(true);

    component.onImageSearchCompleted([makePin('source'), makePin('match-1'), makePin('match-2')]);
    vi.runAllTimers();

    expect(component.relatedPins().map((pin) => pin.id)).toEqual(['match-1', 'match-2']);
    expect(component.isVisualSearchResults()).toBe(true);
    expect(component.showImageSearch()).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a valid visual-search empty state when the only match is the current pin', () => {
    component.onImageSearchCompleted([makePin('source')]);

    expect(component.relatedPins()).toEqual([]);
    expect(component.isVisualSearchResults()).toBe(true);
  });
});

describe('PinDetail — save to board toast feedback', () => {
  let component: PinDetail;
  let boardService: { getBoards: ReturnType<typeof vi.fn>; createBoard: ReturnType<typeof vi.fn>; addPinToBoard: ReturnType<typeof vi.fn> };
  let toastService: ToastService;

  beforeEach(() => {
    boardService = {
      getBoards: vi.fn().mockResolvedValue([]),
      createBoard: vi.fn(),
      addPinToBoard: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: PinService, useValue: {} },
        { provide: BoardService, useValue: boardService },
        {
          provide: SupabaseService,
          useValue: { dbUser: () => null, user: () => ({ id: 'user-1' }), getSessionToken: vi.fn().mockResolvedValue('token') },
        },
        { provide: MembershipService, useValue: { status: () => null } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new PinDetail());
    toastService = TestBed.inject(ToastService);
    component.pin.set(makePin('pin-1'));
    component.boards.set([{ id: 'board-1', name: 'Hồ sơ' } as any]);
  });

  it('shows a success toast reading "Đã lưu vào bộ sưu tập" after a successful save', async () => {
    boardService.addPinToBoard.mockResolvedValue(undefined);

    await component.savePinToBoard();

    expect(boardService.addPinToBoard).toHaveBeenCalledWith('board-1', 'pin-1', 'token');
    expect(toastService.toasts()).toHaveLength(1);
    expect(toastService.toasts()[0]).toMatchObject({ kind: 'success', message: 'Đã lưu vào bộ sưu tập' });
  });

  it('shows an error toast with a retry action when the save fails', async () => {
    boardService.addPinToBoard.mockRejectedValueOnce(new Error('network down'));

    await component.savePinToBoard();

    expect(toastService.toasts()).toHaveLength(1);
    const errorToast = toastService.toasts()[0];
    expect(errorToast.kind).toBe('error');
    expect(errorToast.message).toBe('Không thể lưu ảnh vào bộ sưu tập.');
    expect(errorToast.action?.label).toBe('Thử lại');

    boardService.addPinToBoard.mockResolvedValueOnce(undefined);
    errorToast.action?.onClick();
    await Promise.resolve();
    await Promise.resolve();

    expect(boardService.addPinToBoard).toHaveBeenCalledTimes(2);
  });
});
