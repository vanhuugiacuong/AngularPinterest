import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { applyPinImageProtection, RestrictablePinImage } from '../common/pin-access.util';

type BoardWithPins = {
  boardPins: { pin: { imageUrl: string } }[];
  [key: string]: unknown;
};

function withCover<T extends BoardWithPins>(board: T) {
  const { boardPins, ...rest } = board;
  return {
    ...rest,
    boardPins,
    pinCount: boardPins.length,
    coverImageUrl: boardPins[0]?.pin.imageUrl ?? null,
  };
}

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserBoards(userId: string) {
    const boards = await this.prisma.board.findMany({
      where: { userId },
      include: {
        boardPins: {
          include: { pin: { select: { id: true, imageUrl: true, protectedImageUrl: true, userId: true, isForSale: true } } },
          orderBy: { addedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // A board's owner isn't necessarily each pin's owner — addPinToBoard
    // lets you save someone else's pin onto your own board, and that pin
    // may itself be for-sale/auctioned. Gate on the *pin's* owner, not the
    // board's, same as every other pin-image response in the app.
    await this.protectBoardPinImages(boards, userId);
    return boards.map(withCover);
  }

  async getBoardById(id: string, userId: string) {
    const board = await this.prisma.board.findUnique({
      where: { id },
      include: {
        boardPins: {
          include: { pin: true },
          orderBy: { addedAt: 'desc' },
        },
      },
    });

    // Board riêng tư của người khác phải giống hệt "không tồn tại" - không
    // được để lộ rằng nó tồn tại bằng cách trả mã lỗi khác (403 vs 404).
    if (!board || (board.isSecret && board.userId !== userId)) {
      throw new NotFoundException('Không tìm thấy bộ sưu tập.');
    }

    await this.protectBoardPinImages([board], userId);
    return withCover(board);
  }

  private async protectBoardPinImages(
    boards: { boardPins: { pin: RestrictablePinImage }[] }[],
    viewerId: string,
  ): Promise<void> {
    const pins = boards.flatMap((b) => b.boardPins.map((bp) => bp.pin));
    await applyPinImageProtection(this.prisma, pins, viewerId);
  }

  async createBoard(
    userId: string,
    name: string,
    description?: string,
    isSecret: boolean = false,
  ) {
    const normalizedName = name?.trim();
    const normalizedDescription = description?.trim();
    if (!normalizedName) {
      throw new BadRequestException('Tên bộ sưu tập là bắt buộc.');
    }
    if (normalizedName.length > 80) {
      throw new BadRequestException('Tên bộ sưu tập không được vượt quá 80 ký tự.');
    }
    if (normalizedDescription && normalizedDescription.length > 280) {
      throw new BadRequestException('Mô tả không được vượt quá 280 ký tự.');
    }

    return this.prisma.board.create({
      data: {
        name: normalizedName,
        description: normalizedDescription || null,
        isSecret,
        userId,
      },
    });
  }

  private async assertOwnedBoard(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) throw new NotFoundException('Không tìm thấy bộ sưu tập.');
    if (board.userId !== userId) throw new ForbiddenException('Bạn không sở hữu bộ sưu tập này.');
    return board;
  }

  async updateBoard(
    boardId: string,
    userId: string,
    updates: { name?: string; description?: string | null; isSecret?: boolean },
  ) {
    await this.assertOwnedBoard(boardId, userId);

    const data: { name?: string; description?: string | null; isSecret?: boolean } = {};
    if (updates.name !== undefined) {
      const normalizedName = updates.name.trim();
      if (!normalizedName) throw new BadRequestException('Tên bộ sưu tập là bắt buộc.');
      if (normalizedName.length > 80) throw new BadRequestException('Tên bộ sưu tập không được vượt quá 80 ký tự.');
      data.name = normalizedName;
    }
    if (updates.description !== undefined) {
      const normalizedDescription = updates.description?.trim() || null;
      if (normalizedDescription && normalizedDescription.length > 280) {
        throw new BadRequestException('Mô tả không được vượt quá 280 ký tự.');
      }
      data.description = normalizedDescription;
    }
    if (updates.isSecret !== undefined) {
      data.isSecret = updates.isSecret;
    }

    return this.prisma.board.update({ where: { id: boardId }, data });
  }

  async deleteBoard(boardId: string, userId: string) {
    await this.assertOwnedBoard(boardId, userId);
    // Xoá Board + các dòng BoardPin liên kết (cascade trong schema) - không
    // đụng tới bảng Pin, ảnh gốc vẫn còn nguyên cho chủ sở hữu.
    await this.prisma.board.delete({ where: { id: boardId } });
    return { success: true };
  }

  async addPinToBoard(boardId: string, pinId: string, userId: string) {
    await this.assertOwnedBoard(boardId, userId);

    const existing = await this.prisma.boardPin.findUnique({
      where: {
        boardId_pinId: { boardId, pinId },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.boardPin.create({
      data: {
        boardId,
        pinId,
      },
    });
  }

  async removePinFromBoard(boardId: string, pinId: string, userId: string) {
    await this.assertOwnedBoard(boardId, userId);

    await this.prisma.boardPin.delete({
      where: {
        boardId_pinId: { boardId, pinId },
      },
    });

    return { success: true };
  }
}
