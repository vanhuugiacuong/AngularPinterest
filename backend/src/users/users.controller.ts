import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
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
