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
import { MembershipService } from '../../core/services/membership';
import { DialogService } from '../../core/services/dialog';
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

describe('Home — tác phẩm có giá trị (badge & gating trên feed)', () => {
  let component: Home;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let dialogService: { confirm: ReturnType<typeof vi.fn> };
  let membershipStatus: { plan: string } | null;

  const normalPin = { id: 'p1', listingType: 'NONE', ownerId: 'owner-1' };
  const fixedPin = { id: 'p2', listingType: 'FIXED_PRICE', price: '2500000', ownerId: 'owner-1' };
  const auctionPin = {
    id: 'p3',
    listingType: 'AUCTION',
    ownerId: 'owner-1',
    auction: { status: 'ACTIVE', currentPrice: '2500000' },
  };

  beforeEach(() => {
    router = { navigate: vi.fn() };
    dialogService = { confirm: vi.fn().mockResolvedValue(false) };
    membershipStatus = null;

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of() } },
        { provide: Router, useValue: router },
        { provide: PinService, useValue: {} },
        { provide: BoardService, useValue: {} },
        { provide: UserService, useValue: {} },
        {
          provide: SupabaseService,
          useValue: { dbUser: () => null, user: () => ({ id: 'viewer-1' }), getSessionToken: vi.fn() },
        },
        {
          provide: ImageSearchStore,
          useValue: { previewUrl: () => null, isLoading: () => false, error: () => null, results: () => [] },
        },
        { provide: MembershipService, useValue: { status: () => membershipStatus } },
        { provide: DialogService, useValue: dialogService },
      ],
    });

    component = TestBed.runInInjectionContext(() => new Home());
  });

  it('shows no badge text for a normal (non-monetized) pin', () => {
    expect(component.valueBadgeText(normalPin)).toBe('');
  });

  it('shows the real formatted VND fixed price on the badge — never hard-coded', () => {
    expect(component.valueBadgeText(fixedPin)).toContain('2.500.000');
  });

  it('shows "Giá hiện tại · ..." with the real current price for an active auction', () => {
    const text = component.valueBadgeText(auctionPin);
    expect(text).toContain('Giá hiện tại');
    expect(text).toContain('2.500.000');
  });

  it('opens a normal pin directly regardless of plan — no gating for non-monetized pins', () => {
    membershipStatus = null;
    component.navigateToPin(normalPin);
    expect(router.navigate).toHaveBeenCalledWith(['/pin', 'p1']);
    expect(dialogService.confirm).not.toHaveBeenCalled();
  });

  it('opens a fixed-price pin for a FREE viewer', () => {
    membershipStatus = { plan: 'FREE' };
    component.navigateToPin(fixedPin);
    expect(router.navigate).toHaveBeenCalledWith(['/pin', 'p2']);
    expect(dialogService.confirm).not.toHaveBeenCalled();
  });

  it('navigates to /pricing once a PLUS viewer confirms the auction upgrade dialog', async () => {
    membershipStatus = { plan: 'PLUS' };
    dialogService.confirm.mockResolvedValue(true);
    component.navigateToPin(auctionPin);
    await Promise.resolve();
    await Promise.resolve();
    expect(router.navigate).toHaveBeenCalledWith(['/pricing']);
  });

  it('blocks an auction for a PLUS viewer', () => {
    membershipStatus = { plan: 'PLUS' };
    component.navigateToPin(auctionPin);
    expect(dialogService.confirm).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('opens an auction directly for a PRO viewer', () => {
    membershipStatus = { plan: 'PRO' };
    component.navigateToPin(auctionPin);
    expect(router.navigate).toHaveBeenCalledWith(['/pin', 'p3']);
    expect(dialogService.confirm).not.toHaveBeenCalled();
  });

  it('opens the pin directly for its owner even on a FREE plan', () => {
    membershipStatus = { plan: 'FREE' };
    component.navigateToPin({ ...fixedPin, ownerId: 'viewer-1' });
    expect(router.navigate).toHaveBeenCalledWith(['/pin', 'p2']);
    expect(dialogService.confirm).not.toHaveBeenCalled();
  });
});
