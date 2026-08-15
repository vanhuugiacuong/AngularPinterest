import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOwnProfile = viewerId === user.id;
    const boardFilter = isOwnProfile
      ? { userId: user.id }
      : { userId: user.id, isSecret: false };

    const [posts, albums, followers, following, favorites, follow] =
      await Promise.all([
        this.prisma.pin.count({ where: { userId: user.id } }),
        this.prisma.board.count({ where: boardFilter }),
        this.prisma.follow.count({ where: { followingId: user.id } }),
        this.prisma.follow.count({ where: { followerId: user.id } }),
        isOwnProfile
          ? this.prisma.like.count({ where: { userId: user.id } })
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
      ]);

    return {
      user,
      counts: {
        posts,
        albums,
        followers,
        following,
        favorites,
      },
      viewer: {
        isOwnProfile,
        isFollowing: Boolean(follow),
        canViewFavorites: isOwnProfile,
      },
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
            select: { id: true, username: true, avatarUrl: true },
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
                select: { id: true, username: true, avatarUrl: true },
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
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException('User to follow not found');
    }

    const existingFollow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    let followed: boolean;
    if (existingFollow) {
      await this.prisma.follow.delete({
        where: { followerId_followingId: { followerId, followingId } },
      });
      followed = false;
    } else {
      await this.prisma.follow.create({
        data: { followerId, followingId },
      });
      followed = true;
    }

    const followerCount = await this.prisma.follow.count({
      where: { followingId },
    });
    return { followed, followerCount };
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
