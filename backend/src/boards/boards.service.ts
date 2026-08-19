import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
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

  async updateBoard(
    boardId: string,
    userId: string,
    updates: { name?: string; description?: string; isSecret?: boolean },
  ) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (board.userId !== userId) {
      throw new ForbiddenException('You do not own this board');
    }

    const data: { name?: string; description?: string; isSecret?: boolean } = {};
    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Board name cannot be empty');
      }
      data.name = trimmed;
    }
    if (updates.description !== undefined) {
      data.description = updates.description.trim();
    }
    if (updates.isSecret !== undefined) {
      data.isSecret = updates.isSecret;
    }

    return this.prisma.board.update({ where: { id: boardId }, data });
  }

  async deleteBoard(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (board.userId !== userId) {
      throw new ForbiddenException('You do not own this board');
    }

    await this.prisma.board.delete({ where: { id: boardId } });
    return { success: true };
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
