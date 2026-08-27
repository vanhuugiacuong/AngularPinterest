import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';

/**
 * Khu vực quản trị. MỌI endpoint đều qua hai lớp:
 *   SupabaseAuthGuard -> xác thực người dùng (đặt request.user)
 *   AdminGuard        -> đọc cờ quyền từ DB, không tin dữ liệu client gửi lên
 */
@Controller('api/admin')
@UseGuards(SupabaseAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** Người dùng tự hỏi "tôi có phải admin không" — dùng để hiện/ẩn menu. */
  @Get('check')
  check() {
    return { isAdmin: true }; // qua được guard nghĩa là đúng admin
  }

  @Get('stats')
  stats() {
    return this.adminService.getStats();
  }

  // ── Rút tiền ────────────────────────────────────────────────────────────────
  @Get('payouts')
  payouts(@Query('status') status?: string) {
    return this.adminService.listPayouts(status);
  }

  @Post('payouts/:id/approve')
  approvePayout(@Param('id') id: string) {
    return this.adminService.approvePayout(id);
  }

  @Post('payouts/:id/paid')
  markPaid(@Param('id') id: string, @Body() body: { bankRef?: string }) {
    return this.adminService.markPayoutPaid(id, body?.bankRef);
  }

  @Post('payouts/:id/reject')
  rejectPayout(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.adminService.rejectPayout(id, body?.reason);
  }

  // ── Báo cáo ảnh ─────────────────────────────────────────────────────────────
  @Get('reports')
  reports(@Query('status') status?: string) {
    return this.adminService.listPinReports(status || 'OPEN');
  }

  @Post('reports/:pinId/resolve')
  resolveReports(@Param('pinId') pinId: string) {
    return this.adminService.resolvePinReports(pinId);
  }

  @Delete('pins/:id')
  deletePin(@Param('id') id: string) {
    return this.adminService.deletePin(id);
  }

  // ── Báo sự cố chuyển khoản ──────────────────────────────────────────────────
  @Get('payment-reports')
  paymentReports(@Query('status') status?: string) {
    return this.adminService.listPaymentReports(status || 'OPEN');
  }

  @Post('payment-reports/:id/resolve')
  resolvePaymentReport(@Param('id') id: string) {
    return this.adminService.resolvePaymentReport(id);
  }

  // ── Người dùng ──────────────────────────────────────────────────────────────
  @Get('users')
  users(@Query('q') q?: string) {
    return this.adminService.listUsers(q);
  }

  @Post('users/:id/ban')
  banUser(@Param('id') id: string, @Body() body: { banned: boolean }) {
    return this.adminService.setUserBanned(id, !!body?.banned);
  }

  // ── Doanh thu ───────────────────────────────────────────────────────────────
  @Get('payments')
  payments(@Query('status') status?: string) {
    return this.adminService.listPayments(status);
  }

  @Get('revenue/daily')
  revenueDaily() {
    return this.adminService.revenueDaily();
  }

  @Get('wallets')
  wallets() {
    return this.adminService.listWallets();
  }

  // ── Nội dung ────────────────────────────────────────────────────────────────
  @Get('pins')
  pins(@Query('filter') filter?: string, @Query('q') q?: string) {
    return this.adminService.listPins(filter || 'all', q);
  }
}
