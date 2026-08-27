import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getUserBoards(userId: string) {
    return this.prisma.board.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        boardPins: {
          orderBy: { addedAt: 'desc' },
          include: {
            // The profile page's aggregated "Ghim bạn đã lưu" grid (see Profile.getSavedPins)
            // needs id/title/isAiGenerated/userId too, not just the thumbnail image.
            pin: {
              select: { id: true, title: true, imageUrl: true, isAiGenerated: true, userId: true },
            },
          },
        },
      },
    });
  }

  // Boards owned by someone else that this user was invited to collaborate on
  // ("Nhóm" filter in the Boards tab).
  async getGroupBoards(userId: string) {
    return this.prisma.board.findMany({
      where: { collaborators: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        boardPins: {
          orderBy: { addedAt: 'desc' },
          include: {
            pin: { select: { imageUrl: true } },
          },
        },
      },
    });
  }

  async getBoardById(id: string, userId: string) {
    const board = await this.prisma.board.findUnique({
      where: { id },
      include: {
        boardPins: {
          orderBy: { addedAt: 'desc' },
          include: {
            pin: true,
          },
        },
        collaborators: {
          orderBy: { addedAt: 'asc' },
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException('Board not found');
    }

    const isCollaborator = board.collaborators.some((c) => c.userId === userId);

    // If it's a secret board, only the owner or an invited collaborator can view it
    if (board.isSecret && board.userId !== userId && !isCollaborator) {
      throw new ForbiddenException('This board is private');
    }

    // Pins with a manual sortOrder (set via "Chọn và sắp xếp lại") come first, in that
    // order; everything else (never manually placed) follows, most-recently-added first.
    const orderedPins = [...board.boardPins].sort((a, b) => {
      if (a.sortOrder !== null && b.sortOrder !== null) return a.sortOrder - b.sortOrder;
      if (a.sortOrder !== null) return -1;
      if (b.sortOrder !== null) return 1;
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });

    return { ...board, boardPins: orderedPins };
  }

  // Persists a manual drag-reorder from the "Chọn và sắp xếp lại" screen. pinIds is the
  // full desired order (owner or collaborator only, same as add/removePinToBoard).
  async reorderPins(boardId: string, pinIds: string[], userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (!(await this.canManagePins(boardId, userId, board.userId))) {
      throw new ForbiddenException('You do not have access to this board');
    }

    await this.prisma.$transaction(
      pinIds.map((pinId, index) =>
        this.prisma.boardPin.update({
          where: { boardId_pinId: { boardId, pinId } },
          data: { sortOrder: index },
        }),
      ),
    );

    return { success: true };
  }

  // Owner + any invited collaborator can add/remove pins — a plain boolean rather than
  // re-fetching collaborators everywhere addPinToBoard/removePinFromBoard need this check.
  private async canManagePins(boardId: string, userId: string, ownerId: string): Promise<boolean> {
    if (ownerId === userId) return true;
    const membership = await this.prisma.boardCollaborator.findUnique({
      where: { boardId_userId: { boardId, userId } },
    });
    return !!membership;
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
    if (!(await this.canManagePins(boardId, userId, board.userId))) {
      throw new ForbiddenException('You do not have access to this board');
    }

    const existing = await this.prisma.boardPin.findUnique({
      where: {
        boardId_pinId: { boardId, pinId },
      },
    });

    if (existing) {
      return existing;
    }

    const boardPin = await this.prisma.boardPin.create({
      data: {
        boardId,
        pinId,
      },
    });

    const pin = await this.prisma.pin.findUnique({ where: { id: pinId } });
    if (pin) {
      await this.notificationsService.create(pin.userId, userId, 'save', pinId);
    }

    return boardPin;
  }

  async removePinFromBoard(boardId: string, pinId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (!(await this.canManagePins(boardId, userId, board.userId))) {
      throw new ForbiddenException('You do not have access to this board');
    }

    await this.prisma.boardPin.delete({
      where: {
        boardId_pinId: { boardId, pinId },
      },
    });

    return { success: true };
  }

  async toggleFavoritePin(boardId: string, pinId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (!(await this.canManagePins(boardId, userId, board.userId))) {
      throw new ForbiddenException('You do not have access to this board');
    }

    const boardPin = await this.prisma.boardPin.findUnique({
      where: { boardId_pinId: { boardId, pinId } },
    });
    if (!boardPin) {
      throw new NotFoundException('Pin is not on this board');
    }

    const updated = await this.prisma.boardPin.update({
      where: { boardId_pinId: { boardId, pinId } },
      data: { isFavorite: !boardPin.isFavorite },
    });

    return { isFavorite: updated.isFavorite };
  }

  // === Collaborators ===

  async addCollaborator(boardId: string, ownerId: string, username: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (board.userId !== ownerId) {
      throw new ForbiddenException('Chỉ chủ bảng mới có thể mời cộng tác viên');
    }

    const trimmed = username.trim().replace(/^@/, '');
    if (!trimmed) {
      throw new BadRequestException('Vui lòng nhập tên người dùng');
    }

    const targetUser = await this.prisma.user.findUnique({ where: { username: trimmed } });
    if (!targetUser) {
      throw new NotFoundException('Không tìm thấy người dùng này');
    }
    if (targetUser.id === ownerId) {
      throw new BadRequestException('Bạn đã là chủ bảng này rồi');
    }

    const existing = await this.prisma.boardCollaborator.findUnique({
      where: { boardId_userId: { boardId, userId: targetUser.id } },
    });
    if (existing) {
      throw new ConflictException('Người dùng này đã là cộng tác viên');
    }

    const collaborator = await this.prisma.boardCollaborator.create({
      data: { boardId, userId: targetUser.id },
      include: { user: { select: { id: true, username: true, avatarUrl: true } } },
    });

    await this.notificationsService.create(targetUser.id, ownerId, 'board_invite');

    return collaborator;
  }

  async removeCollaborator(boardId: string, requesterId: string, targetUserId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    // The owner can remove any collaborator; a collaborator can only remove themself (leave).
    if (board.userId !== requesterId && requesterId !== targetUserId) {
      throw new ForbiddenException('Bạn không có quyền gỡ cộng tác viên này');
    }

    await this.prisma.boardCollaborator.delete({
      where: { boardId_userId: { boardId, userId: targetUserId } },
    }).catch(() => {
      throw new NotFoundException('Người này không phải là cộng tác viên');
    });

    return { success: true };
  }
}
