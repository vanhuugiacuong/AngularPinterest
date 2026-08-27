import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { SupabaseAuthGuard } from '../supabase/supabase.guard';
import { CurrentUser, UserPayload } from '../supabase/current-user.decorator';
import type { BuyCreditsDto, SepayWebhookDto, SubscribeDto } from './dto/create-payment.dto';
import { getSepayApiKey } from './billing.config';

@Controller('api/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  getPlans() {
    return this.billingService.getPlansConfig();
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  getMe(@CurrentUser() user: UserPayload) {
    return this.billingService.getMe(user.id);
  }

  @Get('transactions')
  @UseGuards(SupabaseAuthGuard)
  getTransactions(@CurrentUser() user: UserPayload) {
    return this.billingService.getTransactions(user.id);
  }

  @Post('subscribe')
  @UseGuards(SupabaseAuthGuard)
  subscribe(@CurrentUser() user: UserPayload, @Body() dto: SubscribeDto) {
    return this.billingService.createSubscription(user.id, dto.plan);
  }

  @Post('credits/purchase')
  @UseGuards(SupabaseAuthGuard)
  buyCredits(@CurrentUser() user: UserPayload, @Body() dto: BuyCreditsDto) {
    return this.billingService.createCreditPurchase(user.id, dto.packCode);
  }

  @Get('payments/:ref/status')
  @UseGuards(SupabaseAuthGuard)
  paymentStatus(@CurrentUser() user: UserPayload, @Param('ref') ref: string) {
    return this.billingService.getPaymentStatus(user.id, ref);
  }

  @Post('payments/:ref/cancel')
  @UseGuards(SupabaseAuthGuard)
  cancelPayment(@CurrentUser() user: UserPayload, @Param('ref') ref: string) {
    return this.billingService.cancelPayment(user.id, ref);
  }

  /**
   * Báo sự cố chuyển khoản để admin xử lý — vd đã chuyển tiền nhưng hệ thống
   * chưa ghi nhận. Lưu vào bảng PaymentReport, trang admin sẽ đọc từ đó.
   */
  @Post('payments/:ref/report')
  @UseGuards(SupabaseAuthGuard)
  reportPayment(
    @CurrentUser() user: UserPayload,
    @Param('ref') ref: string,
    @Body() body: { reason?: string; note?: string },
  ) {
    return this.billingService.reportPayment(user.id, ref, body?.reason, body?.note);
  }

  /**
   * Link tải bản gốc HD — chỉ chủ ảnh hoặc người đã mua mới lấy được.
   * Link ký từ bucket riêng tư, hết hạn sau 5 phút.
   */
  @Get('pins/:id/download')
  @UseGuards(SupabaseAuthGuard)
  downloadPin(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.billingService.getPremiumDownloadUrl(user.id, id);
  }

  // ── Rút tiền: người bán đổi credit kiếm được ra tiền mặt ───────────────────
  @Get('payout')
  @UseGuards(SupabaseAuthGuard)
  payoutInfo(@CurrentUser() user: UserPayload) {
    return this.billingService.getPayoutInfo(user.id);
  }

  @Post('payout')
  @UseGuards(SupabaseAuthGuard)
  requestPayout(
    @CurrentUser() user: UserPayload,
    @Body() body: { credits: number; bankName: string; accountNumber: string; accountName: string },
  ) {
    return this.billingService.createPayoutRequest(user.id, body);
  }

  @Post('payout/:id/cancel')
  @UseGuards(SupabaseAuthGuard)
  cancelPayout(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.billingService.cancelPayoutRequest(user.id, id);
  }

  // Mua quyền tải ảnh Premium bằng credit
  @Post('pins/:id/purchase')
  @UseGuards(SupabaseAuthGuard)
  purchasePin(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.billingService.purchasePin(user.id, id);
  }

  @Get('pins/:id/access')
  @UseGuards(SupabaseAuthGuard)
  pinAccess(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return this.billingService.getPinAccess(user.id, id);
  }

  @Post('webhook/sepay')
  async sepayWebhook(@Headers('authorization') auth: string, @Body() body: SepayWebhookDto) {
    const apiKey = getSepayApiKey();
    if (apiKey) {
      const expected = `Apikey ${apiKey}`;
      if (auth !== expected) throw new UnauthorizedException('Sai API key webhook.');
    }
    // Chỉ xử lý giao dịch tiền vào.
    if (body.transferType && body.transferType !== 'in') {
      return { success: true, ignored: 'not_incoming' };
    }
    const content = body.content || body.code || '';
    const amount = Number(body.transferAmount || 0);
    const result = await this.billingService.settleIncomingTransfer(
      content,
      amount,
      body.referenceCode || body.id,
    );
    return { success: true, ...result };
  }
}
