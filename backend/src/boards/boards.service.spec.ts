import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BoardsService } from './boards.service';

describe('BoardsService privacy and ownership', () => {
  const prisma = {
    board: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pin: { findUnique: jest.fn() },
    boardPin: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    auction: { findMany: jest.fn(), findFirst: jest.fn() },
    imagePurchase: { findMany: jest.fn(), findFirst: jest.fn() },
  };
  const service = new BoardsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no pin in these tests is commerce-restricted — none of them
    // exercise the pin-image-protection feature.
    prisma.auction.findMany.mockResolvedValue([]);
    prisma.auction.findFirst.mockResolvedValue(null);
    prisma.imagePurchase.findMany.mockResolvedValue([]);
    prisma.imagePurchase.findFirst.mockResolvedValue(null);
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1',
      userId: 'pin-owner',
      isForSale: false,
    });
  });

  it('returns 404 (not 403) for a private board viewed by a non-owner, so it is indistinguishable from a board that does not exist', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'owner-1',
      isSecret: true,
      boardPins: [],
    });

    const error = await service
      .getBoardById('board-1', 'stranger-1')
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('returns 404 for a board id that genuinely does not exist (same error type as a private board)', async () => {
    prisma.board.findUnique.mockResolvedValue(null);
    const error = await service
      .getBoardById('missing', 'anyone')
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('lets the owner view their own private board and returns a computed coverImageUrl from the most recent pin', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'owner-1',
      isSecret: true,
      boardPins: [
        { pin: { imageUrl: 'https://x/newest.jpg' } },
        { pin: { imageUrl: 'https://x/older.jpg' } },
      ],
    });

    const result = await service.getBoardById('board-1', 'owner-1');
    expect(result.coverImageUrl).toBe('https://x/newest.jpg');
    expect(result.pinCount).toBe(2);
  });

  it('rejects updateBoard from a non-owner', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'owner-1',
    });
    await expect(
      service.updateBoard('board-1', 'stranger-1', { name: 'Hacked' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.board.update).not.toHaveBeenCalled();
  });

  it('rejects deleteBoard from a non-owner, and never touches the Pin table (only the Board row)', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'owner-1',
    });
    await expect(service.deleteBoard('board-1', 'stranger-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.board.delete).not.toHaveBeenCalled();
  });

  it('allows the owner to delete their own board', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'owner-1',
    });
    prisma.board.delete.mockResolvedValue({ id: 'board-1' });
    const result = await service.deleteBoard('board-1', 'owner-1');
    expect(result).toEqual({ success: true });
    expect(prisma.board.delete).toHaveBeenCalledWith({
      where: { id: 'board-1' },
    });
  });

  it('does not add a duplicate BoardPin when the pin is already on the board', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'owner-1',
    });
    prisma.boardPin.findUnique.mockResolvedValue({
      boardId: 'board-1',
      pinId: 'pin-1',
    });

    await service.addPinToBoard('board-1', 'pin-1', 'owner-1');

    expect(prisma.boardPin.create).not.toHaveBeenCalled();
  });

  it('rejects saving a paid or auctioned pin before the viewer has purchased it', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'viewer-1',
    });
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1',
      userId: 'seller-1',
      isForSale: true,
    });

    await expect(
      service.addPinToBoard('board-1', 'pin-1', 'viewer-1'),
    ).rejects.toThrow(
      'Bạn cần thanh toán tác phẩm trước khi lưu vào bộ sưu tập.',
    );
    expect(prisma.boardPin.create).not.toHaveBeenCalled();
  });

  it('allows saving a paid pin after the purchase is confirmed', async () => {
    prisma.board.findUnique.mockResolvedValue({
      id: 'board-1',
      userId: 'viewer-1',
    });
    prisma.pin.findUnique.mockResolvedValue({
      id: 'pin-1',
      userId: 'seller-1',
      isForSale: true,
    });
    prisma.imagePurchase.findFirst.mockResolvedValue({ id: 'purchase-1' });
    prisma.boardPin.findUnique.mockResolvedValue(null);
    prisma.boardPin.create.mockResolvedValue({
      boardId: 'board-1',
      pinId: 'pin-1',
    });

    await service.addPinToBoard('board-1', 'pin-1', 'viewer-1');

    expect(prisma.boardPin.create).toHaveBeenCalledWith({
      data: { boardId: 'board-1', pinId: 'pin-1' },
    });
  });
});
