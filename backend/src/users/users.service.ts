import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async syncUser(id: string, email: string, username?: string, avatarUrl?: string) {
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
    while (true) {
      const userWithUsername = await this.prisma.user.findUnique({
        where: { username: uniqueUsername },
      });
      if (!userWithUsername) {
        break;
      }
      count++;
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

  async getUserProfile(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        pins: {
          orderBy: { createdAt: 'desc' },
        },
        boards: {
          where: { isSecret: false },
          include: {
            boardPins: {
              include: {
                pin: true,
              },
              orderBy: {
                addedAt: 'desc',
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async toggleFollow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetUser = await this.prisma.user.findUnique({ where: { id: followingId } });
    if (!targetUser) {
      throw new NotFoundException('User to follow not found');
    }

    const existingFollow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    if (existingFollow) {
      await this.prisma.follow.delete({
        where: {
          followerId_followingId: { followerId, followingId },
        },
      });
      return { followed: false };
    } else {
      await this.prisma.follow.create({
        data: {
          followerId,
          followingId,
        },
      });
      return { followed: true };
    }
  }
}
