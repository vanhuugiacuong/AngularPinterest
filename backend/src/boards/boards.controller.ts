import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';

@Controller('api/boards')
@UseGuards(SupabaseAuthGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Get()
  async getUserBoards(@CurrentUser() user: UserPayload) {
    return this.boardsService.getUserBoards(user.id);
  }

  // Must come before ':id' — otherwise Nest would match "group" as an :id param.
  @Get('group')
  async getGroupBoards(@CurrentUser() user: UserPayload) {
    return this.boardsService.getGroupBoards(user.id);
  }

  @Get(':id')
  async getBoardById(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.boardsService.getBoardById(id, user.id);
  }

  @Post()
  async createBoard(
    @CurrentUser() user: UserPayload,
    @Body('name') name: string,
    @Body('description') description?: string,
    @Body('isSecret') isSecret?: boolean,
  ) {
    return this.boardsService.createBoard(user.id, name, description, !!isSecret);
  }

  @Patch(':id')
  async updateBoard(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('name') name?: string,
    @Body('description') description?: string,
    @Body('isSecret') isSecret?: boolean,
  ) {
    return this.boardsService.updateBoard(id, user.id, { name, description, isSecret });
  }

  @Delete(':id')
  async deleteBoard(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return this.boardsService.deleteBoard(id, user.id);
  }

  @Post(':id/pins')
  async addPinToBoard(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('pinId') pinId: string,
  ) {
    return this.boardsService.addPinToBoard(id, pinId, user.id);
  }

  @Patch(':id/pins/order')
  async reorderPins(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('pinIds') pinIds: string[],
  ) {
    return this.boardsService.reorderPins(id, pinIds || [], user.id);
  }

  @Post(':id/pins/:pinId/favorite')
  async toggleFavoritePin(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('pinId') pinId: string,
  ) {
    return this.boardsService.toggleFavoritePin(id, pinId, user.id);
  }

  @Delete(':id/pins/:pinId')
  async removePinFromBoard(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('pinId') pinId: string,
  ) {
    return this.boardsService.removePinFromBoard(id, pinId, user.id);
  }

  @Post(':id/collaborators')
  async addCollaborator(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body('username') username: string,
  ) {
    return this.boardsService.addCollaborator(id, user.id, username);
  }

  @Delete(':id/collaborators/:userId')
  async removeCollaborator(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.boardsService.removeCollaborator(id, user.id, userId);
  }
}
