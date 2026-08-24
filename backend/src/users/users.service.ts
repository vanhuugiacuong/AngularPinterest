import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../database/prisma.service';
import {
  buildParticipantKey,
  isUniqueConstraintError,
  PUBLIC_USER_SELECT,
} from '../common/relationship.util';
import { BlocksService } from '../blocks/blocks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../supabase/supabase.service';

export type MessageRequestRelationshipStatus =
  | 'NONE'
  | 'PENDING_OUTGOING'
  | 'PENDING_INCOMING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'REPORTED';

// 3-20 ký tự, chỉ chữ/số/dấu chấm/gạch dưới - khớp với cách username hiện
// dùng làm định danh trong URL (/u/:username) nên không cho ký tự cần encode.
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,20}$/;
const MAX_BIO_LENGTH = 280;
const MAX_DISPLAY_NAME_LENGTH = 50;

/** Mirrors backend FollowStatus, but from the viewer's point of view —
 * PENDING is split into outgoing/incoming so the profile action button can
 * render the right label ("Đã gửi yêu cầu" vs "Chấp nhận/Từ chối") without
 * knowing who sent it. */
export type FollowRelationshipStatus =
  | 'NONE'
  | 'PENDING_OUTGOING'
  | 'PENDING_INCOMING'
  | 'ACCEPTED';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly notificationsService: NotificationsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /** Turns an OAuth display name (spaces, accents, any script) into a
   * username-pattern-safe slug — the raw name was previously stored
   * directly as `username`, silently violating the same 3-20
   * chars/letters/digits/./_  rule that updateProfile() enforces on every
   * edit, which is exactly the "display name and unique ID are the same
   * field" bug. `username` is now always a real slug; the human-readable
   * name goes to `displayName` instead. */
  private slugifyUsername(raw: string): string {
    const slug = raw
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_.]+/g, '')
      .slice(0, 20);
    return slug.length >= 3
      ? slug
      : `user${Math.random().toString(36).slice(2, 8)}`;
  }

  async syncUser(
    id: string,
    email: string,
    displayName?: string,
    avatarUrl?: string,
  ) {
    const existingUser = await this.prisma.user.findUnique({ where: { id } });

    if (existingUser) {
      // `/sync` fires on every sign-in AND every page reload with a live
      // session (see SupabaseService.syncUserWithBackend), always carrying
      // the OAuth provider's own avatar URL. Previously this unconditionally
      // preferred that value, so a custom avatar uploaded via
      // updateProfile() was silently overwritten back to the Google/OAuth
      // picture the very next reload. The OAuth avatar should only ever
      // seed a user who has no avatar at all yet — once any avatar is set
      // (OAuth-seeded or custom-uploaded), only updateProfile() may change it.
      return this.prisma.user.update({
        where: { id },
        data: {
          email,
          avatarUrl: existingUser.avatarUrl || avatarUrl,
        },
      });
    }

    const baseUsername = this.slugifyUsername(
      displayName || email.split('@')[0],
    );
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
        displayName: displayName || null,
        avatarUrl,
      },
    });
  }

  /** Chỉnh sửa hồ sơ của chính người dùng đang đăng nhập — tên hiển thị
   * (displayName, text tự do) tách riêng khỏi ID/username (định danh duy
   * nhất dùng trong URL), tiểu sử, và tuỳ chọn ảnh đại diện mới. Không bao
   * giờ nhận userId từ body, luôn dùng id đã xác thực (userId tham số) làm
   * mục tiêu duy nhất được phép sửa - chặn việc sửa hồ sơ người khác ở tầng
   * service.
   *
   * Toàn bộ thay đổi (kể cả avatar đã upload) chỉ có hiệu lực qua ĐÚNG MỘT
   * lệnh `prisma.user.update` ở cuối - nếu bước nào phía trên ném lỗi trước
   * đó, database không hề bị đổi, không có chuyện hồ sơ rơi vào trạng thái
   * cập nhật dở dang. */
  async updateProfile(
    userId: string,
    input: { displayName?: string; username?: string; bio?: string },
    avatarFile?: Express.Multer.File,
  ) {
    const data: {
      displayName?: string | null;
      username?: string;
      bio?: string | null;
      avatarUrl?: string;
    } = {};

    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        throw new BadRequestException(
          `Tên hiển thị tối đa ${MAX_DISPLAY_NAME_LENGTH} ký tự.`,
        );
      }
      data.displayName = displayName || null;
    }

    if (input.username !== undefined) {
      const username = input.username.trim();
      if (!USERNAME_PATTERN.test(username)) {
        throw new BadRequestException(
          'ID phải từ 3-20 ký tự, chỉ gồm chữ, số, dấu chấm hoặc gạch dưới.',
        );
      }
      const existing = await this.prisma.user.findFirst({
        where: {
          username: { equals: username, mode: 'insensitive' },
          NOT: { id: userId },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('ID này đã có người sử dụng.');
      }
      data.username = username;
    }

    if (input.bio !== undefined) {
      const bio = input.bio.trim();
      if (bio.length > MAX_BIO_LENGTH) {
        throw new BadRequestException(
          `Tiểu sử tối đa ${MAX_BIO_LENGTH} ký tự.`,
        );
      }
      data.bio = bio || null;
    }

    if (avatarFile) {
      try {
        data.avatarUrl = await this.uploadAvatar(userId, avatarFile);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        console.error(
          `[UsersService.updateProfile] Upload avatar thất bại cho user ${userId}:`,
          error,
        );
        throw new ServiceUnavailableException(
          'Không thể tải ảnh đại diện lên lúc này. Vui lòng thử lại.',
        );
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Không có thay đổi nào để lưu.');
    }

    try {
      return await this.prisma.user.update({ where: { id: userId }, data });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('ID này đã có người sử dụng.');
      }
      console.error(
        `[UsersService.updateProfile] Lưu hồ sơ thất bại cho user ${userId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Không thể lưu hồ sơ lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  private async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Ảnh đại diện phải là JPG, PNG hoặc WebP.');
    }

    const buffer = await sharp(file.buffer, { limitInputPixels: 30_000_000 })
      .rotate()
      .resize({ width: 512, height: 512, fit: 'cover' })
      .jpeg({ quality: 88 })
      .toBuffer();

    return this.supabaseService.uploadImage(
      'avatars',
      `${userId}/avatar_${Date.now()}.jpg`,
      buffer,
      'image/jpeg',
    );
  }

  /** Bật/tắt chế độ riêng tư cho chính người dùng đang đăng nhập. */
  async updatePrivacy(userId: string, isPrivate: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isPrivate },
    });
  }

  /** Chặn xem nội dung (bài đăng/bộ sưu tập) của một tài khoản riêng tư khi
   * người xem không phải chủ tài khoản và chưa được chủ tài khoản chấp nhận
   * theo dõi. Đây là điểm thực thi quyền riêng tư thật ở backend - không chỉ
   * ẩn bằng CSS ở frontend. */
  private async assertCanViewContent(
    target: { id: string; isPrivate: boolean },
    viewerId?: string,
  ): Promise<void> {
    if (!target.isPrivate || viewerId === target.id) return;
    if (viewerId) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: viewerId,
            followingId: target.id,
          },
        },
        select: { followerId: true },
      });
      if (follow) return;
    }
    throw new ForbiddenException('Tài khoản này ở chế độ riêng tư.');
  }

  async getUserProfile(username: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
        plan: true,
        isPrivate: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOwnProfile = viewerId === user.id;
    const boardFilter = isOwnProfile
      ? { userId: user.id }
      : { userId: user.id, isSecret: false };

    const [
      posts,
      albums,
      followers,
      following,
      favorites,
      privateBoards,
      followingRow,
      followedByRow,
      pendingFollowRequest,
    ] = await Promise.all([
      this.prisma.pin.count({ where: { userId: user.id } }),
      this.prisma.board.count({ where: boardFilter }),
      this.prisma.follow.count({
        where: { followingId: user.id, status: 'ACCEPTED' },
      }),
      this.prisma.follow.count({
        where: { followerId: user.id, status: 'ACCEPTED' },
      }),
      isOwnProfile
        ? this.prisma.like.count({ where: { userId: user.id } })
        : Promise.resolve(null),
      isOwnProfile
        ? this.prisma.board.count({
            where: { userId: user.id, isSecret: true },
          })
        : Promise.resolve(null),
      viewerId && !isOwnProfile
        ? this.prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerId,
                followingId: user.id,
              },
            },
            select: { status: true },
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
            select: { status: true },
          })
        : Promise.resolve(null),
      viewerId && !isOwnProfile
        ? this.prisma.followRequest.findUnique({
            where: {
              senderId_receiverId: { senderId: viewerId, receiverId: user.id },
            },
            select: { status: true },
          })
        : Promise.resolve(null),
    ]);

    const isFollowing = followingRow?.status === 'ACCEPTED';
    const isFollowedBy = followedByRow?.status === 'ACCEPTED';
    const isMutualFollow = isFollowing && isFollowedBy;
    const canViewPosts = !user.isPrivate || isOwnProfile || isFollowing;
    const hasPendingFollowRequest = pendingFollowRequest?.status === 'PENDING';

    let followRequestStatus: FollowRelationshipStatus = 'NONE';
    if (isFollowing) followRequestStatus = 'ACCEPTED';
    else if (followingRow?.status === 'PENDING') followRequestStatus = 'PENDING_OUTGOING';
    else if (followedByRow?.status === 'PENDING') followRequestStatus = 'PENDING_INCOMING';

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
        hasPendingFollowRequest:
          hasPendingFollowRequest ||
          followRequestStatus === 'PENDING_OUTGOING',
        followRequestStatus,
        canViewFavorites: isOwnProfile,
        canViewPrivateBoards: isOwnProfile,
        canViewPosts,
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

    const [request, conversation, isBlocked, isBlockedByTarget] =
      await Promise.all([
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
          where: {
            participantKey: buildParticipantKey(viewerId, targetUserId),
          },
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
        messageRequestStatus = outgoing
          ? 'PENDING_OUTGOING'
          : 'PENDING_INCOMING';
      } else {
        messageRequestStatus = request.status;
      }
    }

    const canMessage =
      !blockedEitherWay &&
      (isMutualFollow || messageRequestStatus === 'ACCEPTED');
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
    await this.assertCanViewContent(user, viewerId);

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
    await this.assertCanViewContent(user, viewerId);
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
                select: {
                  id: true,
                  username: true,
                  avatarUrl: true,
                  plan: true,
                },
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

  /** Toggles the follow relationship. Every account now requires approval —
   * a first-time follow creates a PENDING request (notifying the target)
   * instead of following instantly; calling this again while PENDING
   * withdraws the request; calling it on an ACCEPTED relationship unfollows. */
  async toggleFollow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException('Bạn không thể tự theo dõi chính mình.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true, username: true, isPrivate: true },
    });
    if (!targetUser) {
      throw new NotFoundException('Không tìm thấy người dùng cần theo dõi.');
    }

    if (await this.blocksService.isBlockedEitherWay(followerId, followingId)) {
      throw new ForbiddenException('Không thể theo dõi người dùng này.');
    }

    const existingFollow = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
      select: { status: true },
    });

    let followRequestStatus: FollowRelationshipStatus;
    if (existingFollow) {
      // Already following or already requested — toggle means "undo".
      await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
      followRequestStatus = 'NONE';
    } else {
      // deleteMany/create thay vì findUnique-rồi-create để giảm cửa sổ race, và
      // bắt lỗi P2002 (đã tồn tại do request đồng thời khác vừa tạo) thay vì
      // để nó văng ra ngoài thành lỗi 500.
      try {
        await this.prisma.follow.create({ data: { followerId, followingId, status: 'PENDING' } });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
      followRequestStatus = 'PENDING_OUTGOING';
    }

    const [followerCount, followingCount] = await Promise.all([
      this.prisma.follow.count({ where: { followingId, status: 'ACCEPTED' } }),
      this.prisma.follow.count({ where: { followerId, status: 'ACCEPTED' } }),
    ]);

    if (followRequestStatus === 'PENDING_OUTGOING' && !existingFollow) {
      const follower = await this.prisma.user.findUnique({
        where: { id: followerId },
        select: { username: true },
      });
      await this.notificationsService.createNotification(
        followingId,
        'FOLLOW_REQUEST',
        `${follower?.username ?? 'Một người dùng'} muốn theo dõi bạn.`,
        followerId,
      );
    }

    return { followRequestStatus, followerCount, followingCount };
  }

  /** Target user accepts a pending follow request from `requesterId`. */
  async acceptFollowRequest(currentUserId: string, requesterId: string) {
    const result = await this.prisma.follow.updateMany({
      where: { followerId: requesterId, followingId: currentUserId, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy yêu cầu theo dõi này.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: currentUserId },
      select: { username: true },
    });
    await this.notificationsService.createNotification(
      requesterId,
      'FOLLOW',
      `${target?.username ?? 'Một người dùng'} đã chấp nhận yêu cầu theo dõi của bạn.`,
      currentUserId,
    );

    return { accepted: true };
  }

  /** Target user rejects (or the requester withdraws) a pending request. */
  async rejectFollowRequest(currentUserId: string, requesterId: string) {
    const result = await this.prisma.follow.deleteMany({
      where: { followerId: requesterId, followingId: currentUserId, status: 'PENDING' },
    });
    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy yêu cầu theo dõi này.');
    }
    return { rejected: true };
  }

  /** Danh sách yêu cầu theo dõi đang chờ chủ tài khoản (đang đăng nhập) xử lý. */
  async listIncomingFollowRequests(userId: string) {
    return this.prisma.followRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: PUBLIC_USER_SELECT } },
    });
  }

  async getFollowers(
    username: string,
    viewerId: string | undefined,
    rawPage?: string,
    rawLimit?: string,
  ) {
    const user = await this.findUserByUsername(username);
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const where = { followingId: user.id, status: 'ACCEPTED' as const };

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

    return this.annotateConnections(
      rows.map((r) => r.follower),
      viewerId,
      page,
      limit,
      total,
    );
  }

  async getFollowing(
    username: string,
    viewerId: string | undefined,
    rawPage?: string,
    rawLimit?: string,
  ) {
    const user = await this.findUserByUsername(username);
    const { page, limit, skip } = this.getPagination(rawPage, rawLimit);
    const where = { followerId: user.id, status: 'ACCEPTED' as const };

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

    return this.annotateConnections(
      rows.map((r) => r.following),
      viewerId,
      page,
      limit,
      total,
    );
  }

  /** Lọc người đã bị chặn/đang chặn viewer khỏi danh sách, và gắn thêm
   * viewerIsFollowing/followsViewer cho mỗi người - dùng chung cho cả
   * followers và following. */
  private async annotateConnections(
    users: {
      id: string;
      username: string;
      avatarUrl: string | null;
      bio: string | null;
      plan: string;
    }[],
    viewerId: string | undefined,
    page: number,
    limit: number,
    total: number,
  ) {
    const blockedFlags = viewerId
      ? await Promise.all(
          users.map((u) =>
            this.blocksService.isBlockedEitherWay(viewerId, u.id),
          ),
        )
      : users.map(() => false);
    const visibleUsers = users.filter((_, i) => !blockedFlags[i]);

    let viewerFollowing = new Set<string>();
    let viewerFollowers = new Set<string>();
    if (viewerId && visibleUsers.length > 0) {
      const ids = visibleUsers.map((u) => u.id);
      const [followingRows, followerRows] = await Promise.all([
        this.prisma.follow.findMany({
          where: { followerId: viewerId, followingId: { in: ids }, status: 'ACCEPTED' },
          select: { followingId: true },
        }),
        this.prisma.follow.findMany({
          where: { followerId: { in: ids }, followingId: viewerId, status: 'ACCEPTED' },
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
      select: { id: true, username: true, isPrivate: true },
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
