import { Controller, Get, Post, Patch, Param, Body, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('sync')
  @UseGuards(SupabaseAuthGuard)
  async syncUser(
    @CurrentUser() user: UserPayload,
    @Body('username') username?: string,
    @Body('avatarUrl') avatarUrl?: string,
  ) {
    return this.usersService.syncUser(user.id, user.email, username, avatarUrl);
  }

  @Patch('me')
  @UseGuards(SupabaseAuthGuard)
  async updateProfile(
    @CurrentUser() user: UserPayload,
    @Body('username') username?: string,
    @Body('bio') bio?: string,
    @Body('avatarUrl') avatarUrl?: string,
    @Body('showAllPins') showAllPins?: boolean,
  ) {
    return this.usersService.updateProfile(user.id, { username, bio, avatarUrl, showAllPins });
  }

  @Post('me/avatar')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('avatar', {
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
  }))
  async uploadAvatar(
    @CurrentUser() user: UserPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadAvatar(user.id, file);
  }

  @Get(':username')
  async getUserProfile(@Param('username') username: string) {
    return this.usersService.getUserProfile(username);
  }

  @Post(':id/follow')
  @UseGuards(SupabaseAuthGuard)
  async toggleFollow(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.toggleFollow(user.id, id);
  }
}
