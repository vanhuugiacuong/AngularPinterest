import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// Không dùng SupabaseAuthGuard - đây là request từ SePay, không phải người
// dùng đăng nhập. Xác thực bằng API key header (verifySepayApiKey).
@Controller('api/memberships/payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('sepay')
  sepay(@Headers('authorization') authHeader: string | undefined, @Body() body: Record<string, unknown>) {
    this.payments.verifySepayApiKey(authHeader);
    return this.payments.handleSepayWebhook(body);
  }
}
