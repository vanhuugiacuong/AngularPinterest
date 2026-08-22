import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { buildParticipantKey, isUniqueConstraintError, PUBLIC_USER_SELECT } from '../common/relationship.util';
import { BlocksService } from '../blocks/blocks.service';
import { NotificationsService } from '../notifications/notifications.service';

export type MessageRequestRelationshipStatus =
  | 'NONE'
  | 'PENDING_OUTGOING'
  | 'PENDING_INCOMING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'REPORTED';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async syncUser(
    id: string,
    email: string,
    username?: string,
    avatarUrl?: string,
  ) {
    const baseUsername = username || email.split('@')[0];
    const existingUser = await this.prisma.user.findUnique({ where: { id } });

    if (existingUser) {
      return this.prisma.user.update({
        where: { id },
        data: {
          email,
          avatarUrl: avatarUrl || existingUser.avatarUrl,
        },
      });
    }

    let uniqueUsername = baseUsername;
    let count = 0;
    while (
      await this.prisma.user.findUnique({ where: { username: uniqueUsername } })
    ) {
      count += 1;
      uniqueUsername = `${baseUsername}${count}`;
    }

    return this.prisma.user.create({
      data: {
        id,
        email,
        username: uniqueUsername,
        avatarUrl,
      },
    });
  }

  async getUserProfile(username: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
        plan: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOwnProfile = viewerId === user.id;
    const boardFilter = isOwnProfile
      ? { userId: user.id }
      : { userId: user.id, isSecret: false };

    const [posts, albums, followers, following, favorites, privateBoards, followingRow, followedByRow] =
      await Promise.all([
        this.prisma.pin.count({ where: { userId: user.id } }),
        this.prisma.board.count({ where: boardFilter }),
        this.prisma.follow.count({ where: { followingId: user.id } }),
        this.prisma.follow.count({ where: { followerId: user.id } }),
        isOwnProfile
          ? this.prisma.like.count({ where: { userId: user.id } })
          : Promise.resolve(null),
        isOwnProfile
          ? this.prisma.board.count({ where: { userId: user.id, isSecret: true } })
          : Promise.resolve(null),
        viewerId && !isOwnProfile
          ? this.prisma.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: viewerId,
                  followingId: user.id,
                },
              },
              select: { followerId: true },
            })
          : Promise.resolve(null),
        viewerId && !isOwnProfile
          ? this.prisma.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: user.id,
                  followingId: viewerId,
                },
              },
              select: { followerId: true },
            })
          : Promise.resolve(null),
      ]);

    const isFollowing = Boolean(followingRow);
    const isFollowedBy = Boolean(followedByRow);
    const isMutualFollow = isFollowing && isFollowedBy;

    const relationship = await this.getMessagingRelationship(
      viewerId,
      isOwnProfile,
      user.id,
      isMutualFollow,
    );

    return {
      user,
      counts: {
        posts,
        albums,
        followers,
        following,
        favorites,
        privateBoards,
      },
      viewer: {
        isOwnProfile,
        isFollowing,
        isFollowedBy,
        isMutualFollow,
        canViewFavorites: isOwnProfile,
        canViewPrivateBoards: isOwnProfile,
        ...relationship,
      },
    };
  }

  private async getMessagingRelationship(
    viewerId: string | undefined,
    isOwnProfile: boolean,
    targetUserId: string,
    isMutualFollow: boolean,
  ) {
    const empty = {
      messageRequestStatus: 'NONE' as MessageRequestRelationshipStatus,
      conversationId: null as string | null,
      isBlocked: false,
      isBlockedByTarget: false,
      canMessage: false,
      canSendMessageRequest: false,
    };

    if (!viewerId || isOwnProfile) {
      return empty;
    }

    const [request, conversation, isBlocked, isBlockedByTarget] = await Promise.all([
      this.prisma.messageRequest.findFirst({
        where: {
          OR: [
            { senderId: viewerId, receiverId: targetUserId },
            { senderId: targetUserId, receiverId: viewerId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { senderId: true, status: true },
      }),
      this.prisma.conversation.findUnique({
        where: { participantKey: buildParticipantKey(viewerId, targetUserId) },
        select: { id: true },
      }),
      this.blocksService.isBlocked(viewerId, targetUserId),
      this.blocksService.isBlocked(targetUserId, viewerId),
    ]);

    const blockedEitherWay = isBlocked || isBlockedByTarget;

    let messageRequestStatus: MessageRequestRelationshipStatus = 'NONE';
    if (request) {
      const outgoing = request.senderId === viewerId;
      if (request.status === 'PENDING') {
        messageRequestStatus = outgoing ? 'PENDING_OUTGOING' : 'PENDING_INCOMING';
      } else {
        messageRequestStatus = request.status as MessageRequestRelationshipStatus;
      }
    }

    const canMessage =
      !blockedEitherWay && (isMutualFollow || messageRequestStatus === 'ACCEPTED');
    const canSendMessageRequest =
      !blockedEitherWay && !isMutualFollow && messageRequestStatus === 'NONE';

    return {
      messageRequestStatus,
      conversationId: conversation?.id ?? null,
      isBlocked,
      isBlockedByTarget,
      canMessage,
      canSendMessageRequest,
    };
  }

  async getUserPosts(
    username: string,
    viewerId?: string,
    rawPage?: string,
    rawLimit?: string,
  ) {
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const user = await this.findUserByUsername(username);

    const where = { userId: user.id };
    const [items, total] = await Promise.all([
      this.prisma.pin.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          imageUrl: true,
          sourceUrl: true,
          userId: true,
          createdAt: true,
          isAiGenerated: true,
          promptUsed: true,
          negativePrompt: true,
          generationModel: true,
          category: true,
          user: {
            select: { id: true, username: true, avatarUrl: true, plan: true },
          },
          _count: { select: { likes: true, comments: true } },
          likes: {
            where: { userId: viewerId || '__anonymous__' },
            select: { userId: true },
            take: 1,
          },
        },
      }),
      this.prisma.pin.count({ where }),
    ]);

    return this.pageResult(
      items.map(({ likes, ...pin }) => ({
        ...pin,
        isLiked: likes.length > 0,
      })),
      total,
      page,
      limit,
    );
  }

  async getUserBoards(
    username: string,
    viewerId?: string,
    rawPage?: string,
    rawLimit?: string,
  ) {
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const user = await this.findUserByUsername(username);
    const isOwner = viewerId === user.id;
    const where = {
      userId: user.id,
      ...(isOwner ? {} : { isSecret: false }),
    };

    const [boards, total] = await Promise.all([
      this.prisma.board.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          isSecret: true,
          userId: true,
          createdAt: true,
          _count: { select: { boardPins: true } },
          boardPins: {
            orderBy: { addedAt: 'desc' },
            take: 3,
            select: {
              pin: {
                select: {
                  id: true,
                  title: true,
                  imageUrl: true,
                  isAiGenerated: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.board.count({ where }),
    ]);

    const items = boards.map(({ boardPins, _count, ...board }) => ({
      ...board,
      pinCount: _count.boardPins,
      thumbnails: boardPins.map(({ pin }) => pin),
    }));

    return this.pageResult(items, total, page, limit);
  }

  async getFavorites(userId: string, rawPage?: string, rawLimit?: string) {
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const where = { userId };

    const [favorites, total] = await Promise.all([
      this.prisma.like.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { pinId: 'desc' }],
        skip,
        take: limit,
        select: {
          createdAt: true,
          pin: {
            select: {
              id: true,
              title: true,
              description: true,
              imageUrl: true,
              sourceUrl: true,
              userId: true,
              createdAt: true,
              isAiGenerated: true,
              promptUsed: true,
              negativePrompt: true,
              generationModel: true,
              category: true,
              user: {
                select: { id: true, username: true, avatarUrl: true, plan: true },
              },
              _count: { select: { likes: true, comments: true } },
            },
          },
        },
      }),
      this.prisma.like.count({ where }),
    ]);

    const items = favorites.map(({ pin, createdAt }) => ({
      ...pin,
      favoritedAt: createdAt,
      isLiked: true,
    }));

    return this.pageResult(items, total, page, limit);
  }

  async toggleFollow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException('Bạn không thể tự theo dõi chính mình.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true, username: true },
    });
    if (!targetUser) {
      throw new NotFoundException('Không tìm thấy người dùng cần theo dõi.');
    }

    if (await this.blocksService.isBlockedEitherWay(followerId, followingId)) {
      throw new ForbiddenException('Không thể theo dõi người dùng này.');
    }

    const existingFollow = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
      select: { followerId: true },
    });

    let followed: boolean;
    if (existingFollow) {
      await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
      followed = false;
    } else {
      // deleteMany/create thay vì findUnique-rồi-create để giảm cửa sổ race, và
      // bắt lỗi P2002 (đã tồn tại do request đồng thời khác vừa tạo) thay vì
      // để nó văng ra ngoài thành lỗi 500.
      try {
        await this.prisma.follow.create({ data: { followerId, followingId } });
        followed = true;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          followed = true;
        } else {
          throw error;
        }
      }
    }

    const [followerCount, followingCount] = await Promise.all([
      this.prisma.follow.count({ where: { followingId } }),
      this.prisma.follow.count({ where: { followerId } }),
    ]);

    if (followed && !existingFollow) {
      const follower = await this.prisma.user.findUnique({
        where: { id: followerId },
        select: { username: true },
      });
      await this.notificationsService.createNotification(
        followingId,
        'FOLLOW',
        `${follower?.username ?? 'Một người dùng'} đã bắt đầu theo dõi bạn.`,
        followerId,
      );
    }

    return { followed, followerCount, followingCount };
  }

  async getFollowers(username: string, viewerId: string | undefined, rawPage?: string, rawLimit?: string) {
    const user = await this.findUserByUsername(username);
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const where = { followingId: user.id };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { follower: { select: PUBLIC_USER_SELECT } },
      }),
      this.prisma.follow.count({ where }),
    ]);

    return this.annotateConnections(rows.map((r) => r.follower), viewerId, page, limit, total);
  }

  async getFollowing(username: string, viewerId: string | undefined, rawPage?: string, rawLimit?: string) {
    const user = await this.findUserByUsername(username);
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const where = { followerId: user.id };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { following: { select: PUBLIC_USER_SELECT } },
      }),
      this.prisma.follow.count({ where }),
    ]);

    return this.annotateConnections(rows.map((r) => r.following), viewerId, page, limit, total);
  }

  /** Lọc người đã bị chặn/đang chặn viewer khỏi danh sách, và gắn thêm
   * viewerIsFollowing/followsViewer cho mỗi người - dùng chung cho cả
   * followers và following. */
  private async annotateConnections(
    users: { id: string; username: string; avatarUrl: string | null; bio: string | null; plan: string }[],
    viewerId: string | undefined,
    page: number,
    limit: number,
    total: number,
  ) {
    const blockedFlags = viewerId
      ? await Promise.all(users.map((u) => this.blocksService.isBlockedEitherWay(viewerId, u.id)))
      : users.map(() => false);
    const visibleUsers = users.filter((_, i) => !blockedFlags[i]);

    let viewerFollowing = new Set<string>();
    let viewerFollowers = new Set<string>();
    if (viewerId && visibleUsers.length > 0) {
      const ids = visibleUsers.map((u) => u.id);
      const [followingRows, followerRows] = await Promise.all([
        this.prisma.follow.findMany({
          where: { followerId: viewerId, followingId: { in: ids } },
          select: { followingId: true },
        }),
        this.prisma.follow.findMany({
          where: { followerId: { in: ids }, followingId: viewerId },
          select: { followerId: true },
        }),
      ]);
      viewerFollowing = new Set(followingRows.map((r) => r.followingId));
      viewerFollowers = new Set(followerRows.map((r) => r.followerId));
    }

    const items = visibleUsers.map((u) => ({
      ...u,
      viewerIsFollowing: viewerFollowing.has(u.id),
      followsViewer: viewerFollowers.has(u.id),
    }));

    return { items, page, limit, total, hasMore: page * limit < total };
  }

  async getPrivateBoards(userId: string, rawPage?: string, rawLimit?: string) {
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const where = { userId, isSecret: true };

    const [boards, total] = await Promise.all([
      this.prisma.board.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          isSecret: true,
          userId: true,
          createdAt: true,
          _count: { select: { boardPins: true } },
          boardPins: {
            orderBy: { addedAt: 'desc' },
            take: 3,
            select: { pin: { select: { id: true, title: true, imageUrl: true, isAiGenerated: true } } },
          },
        },
      }),
      this.prisma.board.count({ where }),
    ]);

    const items = boards.map(({ boardPins, _count, ...board }) => ({
      ...board,
      pinCount: _count.boardPins,
      thumbnails: boardPins.map(({ pin }) => pin),
    }));

    return this.pageResult(items, total, page, limit);
  }

  /** Account search for the navbar's search dropdown/results. Only ever
   * selects public-safe fields (id, username, avatarUrl, plan) — never email
   * or other private profile data. Exact-prefix matches are ranked before
   * matches that only contain the query elsewhere in the username. */
  async searchUsers(rawQuery: string, rawLimit?: string) {
    const query = rawQuery.trim();
    if (!query) {
      return { items: [] };
    }

    const parsedLimit = Number.parseInt(rawLimit || '10', 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 25)
        : 10;

    const matches = await this.prisma.user.findMany({
      where: { username: { contains: query, mode: 'insensitive' } },
      select: { id: true, username: true, avatarUrl: true, plan: true },
      take: limit * 3,
    });

    const lowerQuery = query.toLowerCase();
    const startsWith: typeof matches = [];
    const contains: typeof matches = [];
    for (const user of matches) {
      if (user.username.toLowerCase().startsWith(lowerQuery)) {
        startsWith.push(user);
      } else {
        contains.push(user);
      }
    }

    return { items: [...startsWith, ...contains].slice(0, limit) };
  }

  private async findUserByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private getPagination(rawPage?: string, rawLimit?: string) {
    const parsedPage = Number.parseInt(rawPage || '1', 10);
    const parsedLimit = Number.parseInt(rawLimit || '20', 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 50)
        : 20;
    return { page, limit, skip: (page - 1) * limit };
  }

  private pageResult<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
  ) {
    return {
      items,
      page,
      limit,
      total,
      hasMore: page * limit < total,
    };
  }
}
