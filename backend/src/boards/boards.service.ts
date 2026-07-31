import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserBoards(userId: string) {
    return this.prisma.board.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBoardById(id: string, userId: string) {
    const board = await this.prisma.board.findUnique({
      where: { id },
      include: {
        boardPins: {
          include: {
            pin: true,
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException('Board not found');
    }

    // If it's a secret board, only the owner can view it
    if (board.isSecret && board.userId !== userId) {
      throw new ForbiddenException('This board is private');
    }

    return board;
  }

  async createBoard(userId: string, name: string, description?: string, isSecret: boolean = false) {
    return this.prisma.board.create({
      data: {
        name,
        description,
        isSecret,
        userId,
      },
    });
  }

  async addPinToBoard(boardId: string, pinId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (board.userId !== userId) {
      throw new ForbiddenException('You do not own this board');
    }

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
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (board.userId !== userId) {
      throw new ForbiddenException('You do not own this board');
    }

    await this.prisma.boardPin.delete({
      where: {
        boardId_pinId: { boardId, pinId },
      },
    });

    return { success: true };
  }
}
