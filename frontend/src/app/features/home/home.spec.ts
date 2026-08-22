import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../core/services/board';
import { ImageSearchStore } from '../../core/services/image-search-store';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { UserService } from '../../core/services/user';
import { Home } from './home';

interface HomePrivate {
  performSaveToBoard(pinId: string): Promise<void>;
}

describe('Home — save to board toast feedback', () => {
  let component: Home;
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
        { provide: ActivatedRoute, useValue: { queryParamMap: of() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: PinService, useValue: {} },
        { provide: BoardService, useValue: boardService },
        { provide: UserService, useValue: {} },
        {
          provide: SupabaseService,
          useValue: {
            dbUser: () => null,
            user: () => ({ id: 'user-1' }),
            getSessionToken: vi.fn().mockResolvedValue('token'),
          },
        },
        {
          provide: ImageSearchStore,
          useValue: { previewUrl: () => null, isLoading: () => false, error: () => null, results: () => [] },
        },
      ],
    });

    component = TestBed.runInInjectionContext(() => new Home());
    toastService = TestBed.inject(ToastService);
    component.boards.set([{ id: 'board-1', name: 'Hồ sơ' } as any]);
  });

  it('shows a success toast reading "Đã lưu vào bộ sưu tập" after a successful save', async () => {
    boardService.addPinToBoard.mockResolvedValue(undefined);

    await (component as unknown as HomePrivate).performSaveToBoard('pin-1');

    expect(boardService.addPinToBoard).toHaveBeenCalledWith('board-1', 'pin-1', 'token');
    expect(toastService.toasts()).toHaveLength(1);
    expect(toastService.toasts()[0]).toMatchObject({ kind: 'success', message: 'Đã lưu vào bộ sưu tập' });
  });

  it('never opens a dialog for the successful save — only the toast fires', async () => {
    boardService.addPinToBoard.mockResolvedValue(undefined);

    await (component as unknown as HomePrivate).performSaveToBoard('pin-1');

    expect(toastService.toasts()[0].kind).toBe('success');
  });

  it('shows an error toast with a retry action when the save fails, and the action retries', async () => {
    boardService.addPinToBoard.mockRejectedValueOnce(new Error('network down'));

    await (component as unknown as HomePrivate).performSaveToBoard('pin-1');

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
