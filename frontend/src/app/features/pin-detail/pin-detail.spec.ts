import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../core/services/board';
import { MembershipService } from '../../core/services/membership';
import { Pin, PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { AuctionService } from '../../core/services/auction';
import { UserService } from '../../core/services/user';
import { DialogService } from '../../core/services/dialog';
// MessagingService (providedIn: 'root') runs a recurring timer(0, 30000)
// poll in its constructor — with vi.useFakeTimers() active in this file,
// letting the real singleton get constructed makes vi.runAllTimers() spin
// forever, so it must always be stubbed out in these tests.
import { MessagingService } from '../../core/services/messaging';
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
        { provide: AuctionService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: MessagingService, useValue: {} },
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
        { provide: AuctionService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: MessagingService, useValue: {} },
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

describe('PinDetail — nâng cấp gói khi mở tác phẩm có giá trị', () => {
  let component: PinDetail;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let dialogService: { confirm: ReturnType<typeof vi.fn> };
  let pinService: { getPinById: ReturnType<typeof vi.fn>; getRelatedPins: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    router = { navigate: vi.fn() };
    dialogService = { confirm: vi.fn().mockResolvedValue(false) };
    pinService = {
      getPinById: vi.fn(),
      getRelatedPins: vi.fn().mockResolvedValue([]),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of() } },
        { provide: Router, useValue: router },
        { provide: PinService, useValue: pinService },
        { provide: BoardService, useValue: {} },
        {
          provide: SupabaseService,
          useValue: { dbUser: () => null, user: () => null, getSessionToken: vi.fn().mockResolvedValue(null) },
        },
        { provide: MembershipService, useValue: { status: () => null } },
        { provide: AuctionService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: MessagingService, useValue: {} },
        { provide: DialogService, useValue: dialogService },
      ],
    });

    component = TestBed.runInInjectionContext(() => new PinDetail());
    (component as unknown as { currentPinId: string }).currentPinId = 'pin-1';
  });

  it('shows the upgrade dialog — not a generic error — when the backend blocks a FREE/anonymous viewer (defense-in-depth for direct URL access)', async () => {
    pinService.getPinById.mockRejectedValue(
      new Error('Chỉ thành viên Pro mới có thể xem chi tiết tác phẩm đấu giá.'),
    );

    await component.loadPinDetail('pin-1');

    expect(dialogService.confirm).toHaveBeenCalled();
    expect(component.loadError()).toBeNull();
  });

  it('navigates to /pricing once the viewer confirms the upgrade dialog', async () => {
    pinService.getPinById.mockRejectedValue(
      new Error('Chỉ thành viên Pro mới có thể xem chi tiết tác phẩm đấu giá.'),
    );
    dialogService.confirm.mockResolvedValue(true);

    await component.loadPinDetail('pin-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(router.navigate).toHaveBeenCalledWith(['/pricing']);
  });

  it('shows the normal generic load error (not the upgrade dialog) for unrelated failures like a network error', async () => {
    pinService.getPinById.mockRejectedValue(new Error('Network down'));

    await component.loadPinDetail('pin-1');

    expect(dialogService.confirm).not.toHaveBeenCalled();
    expect(component.loadError()).toContain('Không thể tải tác phẩm này');
  });

  it('loads normally with no dialog once the backend allows the viewer (Plus/Pro or owner)', async () => {
    pinService.getPinById.mockResolvedValue({
      id: 'pin-1',
      title: 'Tranh sơn dầu',
      imageUrl: 'https://example.com/x.jpg',
      userId: 'owner-1',
      listingType: 'FIXED_PRICE',
      price: '2500000',
      user: { id: 'owner-1', username: 'artist' },
    });

    await component.loadPinDetail('pin-1');

    expect(dialogService.confirm).not.toHaveBeenCalled();
    expect(component.pin()?.id).toBe('pin-1');
    expect(component.loadError()).toBeNull();
  });
});

describe('PinDetail — form đặt giá đấu giá (validation, không optimistic update)', () => {
  let component: PinDetail;
  let auctionService: { placeBid: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auctionService = { placeBid: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: PinService, useValue: {} },
        { provide: BoardService, useValue: {} },
        { provide: SupabaseService, useValue: { dbUser: () => null, user: () => ({ id: 'bidder-1' }) } },
        { provide: MembershipService, useValue: { status: () => ({ plan: 'PLUS' }) } },
        { provide: AuctionService, useValue: auctionService },
        { provide: UserService, useValue: {} },
        { provide: MessagingService, useValue: {} },
        { provide: DialogService, useValue: { confirm: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new PinDetail());
    component.auction.set({
      id: 'auction-1',
      pinId: 'pin-1',
      pin: { id: 'pin-1', title: 'Tranh', imageUrl: 'https://x', userId: 'seller-1' },
      sellerId: 'seller-1',
      status: 'ACTIVE',
      currency: 'VND',
      startingPrice: '1000000',
      currentPrice: '1000000',
      minimumIncrement: '100000',
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
      bidCount: 0,
      winnerId: null,
      serverNow: new Date().toISOString(),
      bids: [],
    } as any);
  });

  it('rejects a bid below the starting price without calling the backend (client-side pre-validation)', async () => {
    component.bidAmount = 500_000;

    await component.submitBid();

    expect(auctionService.placeBid).not.toHaveBeenCalled();
    expect(component.bidError()).toContain('1.000.000');
  });

  it('disables further submits while a bid is in flight', async () => {
    let resolveBid: (value: any) => void = () => {};
    auctionService.placeBid.mockReturnValue(new Promise((resolve) => (resolveBid = resolve)));
    component.bidAmount = 1_000_000;

    const submitPromise = component.submitBid();
    expect(component.bidSubmitting()).toBe(true);

    resolveBid({ ...component.auction(), currentPrice: '1000000', bidCount: 1, serverNow: new Date().toISOString() });
    await submitPromise;

    expect(component.bidSubmitting()).toBe(false);
  });

  it('updates currentPrice only from the real backend response — never optimistically before the call resolves', async () => {
    component.bidAmount = 1_000_000;
    auctionService.placeBid.mockResolvedValue({
      ...component.auction(),
      currentPrice: '1100000',
      bidCount: 1,
      serverNow: new Date().toISOString(),
    });

    const submitPromise = component.submitBid();
    // Ngay sau khi gọi, trước khi promise resolve — giá hiển thị vẫn phải là
    // giá cũ (chưa cập nhật lạc quan).
    expect(component.auction()?.currentPrice).toBe('1000000');
    await submitPromise;

    expect(auctionService.placeBid).toHaveBeenCalledWith('auction-1', 1_000_000, expect.any(String));
    expect(component.auction()?.currentPrice).toBe('1100000');
    expect(component.bidSuccessMessage()).toBeTruthy();
  });

  it('shows a friendly error and does not crash when the backend rejects the bid (e.g. optimistic-lock conflict)', async () => {
    component.bidAmount = 1_100_000;
    auctionService.placeBid.mockRejectedValue(new Error('Đã có người đặt giá khác, vui lòng thử lại.'));

    await component.submitBid();

    expect(component.bidError()).toBe('Đã có người đặt giá khác, vui lòng thử lại.');
    expect(component.bidSubmitting()).toBe(false);
  });
});
