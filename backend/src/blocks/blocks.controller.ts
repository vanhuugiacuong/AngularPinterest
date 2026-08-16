import { Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { BlocksService } from './blocks.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/users')
@UseGuards(SupabaseAuthGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Post(':id/block')
  async block(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.blocksService.blockUser(user.id, id);
  }

  @Delete(':id/block')
  async unblock(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.blocksService.unblockUser(user.id, id);
  }
}
