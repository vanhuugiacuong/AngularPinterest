import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { OptionalSupabaseAuthGuard } from '../supabase/optional-supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('sync')
  @UseGuards(SupabaseAuthGuard)
  async syncUser(
    @CurrentUser() user: UserPayload,
    // Historically named "username" in the request body (frontend still
    // sends it that way) but it's really the OAuth display name — syncUser()
    // derives a proper unique `username` slug from it and stores this raw
    // value as `displayName`.
    @Body('username') displayName?: string,
    @Body('avatarUrl') avatarUrl?: string,
  ) {
    return this.usersService.syncUser(
      user.id,
      user.email,
      displayName,
      avatarUrl,
    );
  }

  @Patch('me')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async updateMyProfile(
    @CurrentUser() user: UserPayload,
    @UploadedFile() avatar?: Express.Multer.File,
    @Body('displayName') displayName?: string,
    @Body('username') username?: string,
    @Body('bio') bio?: string,
  ) {
    return this.usersService.updateProfile(
      user.id,
      { displayName, username, bio },
      avatar,
    );
  }

  @Patch('me/privacy')
  @UseGuards(SupabaseAuthGuard)
  async updateMyPrivacy(
    @CurrentUser() user: UserPayload,
    @Body('isPrivate') isPrivate: boolean,
  ) {
    return this.usersService.updatePrivacy(user.id, isPrivate === true);
  }

  @Get('me/favorites')
  @UseGuards(SupabaseAuthGuard)
  async getFavorites(
    @CurrentUser() user: UserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getFavorites(user.id, page, limit);
  }

  // Phải đăng ký trước route ':username' bên dưới, giống 'me/favorites'.
  @Get('me/private-boards')
  @UseGuards(SupabaseAuthGuard)
  async getPrivateBoards(
    @CurrentUser() user: UserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getPrivateBoards(user.id, page, limit);
  }

  @Get('me/follow-requests')
  @UseGuards(SupabaseAuthGuard)
  async getIncomingFollowRequests(@CurrentUser() user: UserPayload) {
    return this.usersService.listIncomingFollowRequests(user.id);
  }

  @Get(':username/posts')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getUserPosts(
    @CurrentUser() viewer: UserPayload | undefined,
    @Param('username') username: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getUserPosts(username, viewer?.id, page, limit);
  }

  @Get(':username/boards')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getUserBoards(
    @CurrentUser() viewer: UserPayload | undefined,
    @Param('username') username: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getUserBoards(username, viewer?.id, page, limit);
  }

  // Must stay registered before the ':username' route below — otherwise Nest
  // matches a literal request for "/api/users/search" against ':username'
  // and treats "search" as a username instead of routing here.
  @Get('search')
  async searchUsers(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.usersService.searchUsers(query || '', limit);
  }

  @Get(':username')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getUserProfile(
    @CurrentUser() viewer: UserPayload | undefined,
    @Param('username') username: string,
  ) {
    return this.usersService.getUserProfile(username, viewer?.id);
  }

  @Get(':username/followers')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getFollowers(
    @CurrentUser() viewer: UserPayload | undefined,
    @Param('username') username: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getFollowers(username, viewer?.id, page, limit);
  }

  @Get(':username/following')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getFollowing(
    @CurrentUser() viewer: UserPayload | undefined,
    @Param('username') username: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getFollowing(username, viewer?.id, page, limit);
  }

  @Post(':id/follow')
  @UseGuards(SupabaseAuthGuard)
  async toggleFollow(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.toggleFollow(user.id, id);
  }

  @Patch('follow-requests/:senderId/accept')
  @UseGuards(SupabaseAuthGuard)
  async acceptFollowRequest(
    @CurrentUser() user: UserPayload,
    @Param('senderId') senderId: string,
  ) {
    return this.usersService.acceptFollowRequest(user.id, senderId);
  }

  @Patch('follow-requests/:senderId/reject')
  @UseGuards(SupabaseAuthGuard)
  async rejectFollowRequest(
    @CurrentUser() user: UserPayload,
    @Param('senderId') senderId: string,
  ) {
    return this.usersService.rejectFollowRequest(user.id, senderId);
  }
}
