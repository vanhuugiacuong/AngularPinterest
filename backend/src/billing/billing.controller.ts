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
import { SEPAY_API_KEY } from './billing.config';

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

  /**
   * Webhook SePay — đối soát tiền vào tự động. KHÔNG dùng SupabaseAuthGuard.
   * SePay gửi header: Authorization: Apikey <SEPAY_API_KEY>.
   * Cấu hình URL này trong dashboard SePay: https://my.sepay.vn (Webhooks).
   * Với PayOS: đổi sang verify chữ ký HMAC theo payos-node SDK rồi gọi cùng service.
   */
  @Post('webhook/sepay')
  async sepayWebhook(@Headers('authorization') auth: string, @Body() body: SepayWebhookDto) {
    if (SEPAY_API_KEY) {
      const expected = `Apikey ${SEPAY_API_KEY}`;
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
