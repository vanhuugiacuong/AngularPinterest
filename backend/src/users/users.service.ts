import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ModerationService } from '../moderation/moderation.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly supabaseService: SupabaseService,
    private readonly moderationService: ModerationService,
  ) {}

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
          orderBy: { createdAt: 'desc' },
          include: {
            boardPins: {
              orderBy: { addedAt: 'desc' },
              include: {
                pin: {
                  select: { imageUrl: true },
                },
              },
            },
          },
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
      await this.notificationsService.create(followingId, followerId, 'follow');
      return { followed: true };
    }
  }

  async updateProfile(
    id: string,
    updates: { username?: string; bio?: string; avatarUrl?: string },
  ) {
    const data: { username?: string; bio?: string; avatarUrl?: string } = {};

    if (updates.username !== undefined) {
      const trimmed = updates.username.trim();
      if (trimmed.length < 3) {
        throw new BadRequestException('Tên người dùng phải có ít nhất 3 ký tự');
      }
      const existing = await this.prisma.user.findUnique({ where: { username: trimmed } });
      if (existing && existing.id !== id) {
        throw new ConflictException('Tên người dùng đã được sử dụng');
      }
      data.username = trimmed;
    }

    if (updates.bio !== undefined) {
      data.bio = updates.bio.trim().slice(0, 280);
    }

    if (updates.avatarUrl !== undefined) {
      data.avatarUrl = updates.avatarUrl;
    }

    return this.prisma.user.update({ where: { id }, data });
  }

  async uploadAvatar(id: string, file: Express.Multer.File) {
    await this.moderationService.checkImageIsSafe(file.buffer, file.originalname, file.mimetype);

    const extension = file.originalname.split('.').pop() || 'png';
    const filename = `${id}/avatar_${Date.now()}.${extension}`;
    const avatarUrl = await this.supabaseService.uploadImage('avatars', filename, file.buffer, file.mimetype);
    return this.prisma.user.update({ where: { id }, data: { avatarUrl } });
  }
}
