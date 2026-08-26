import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BillingService } from './billing.service';
import { getSepayApiToken } from './billing.config';

/**
 * Nền: cứ ~20s tự hỏi SePay xem có tiền vào khớp đơn đang chờ không, rồi ghi nhận.
 * Chỉ chạy khi có SEPAY_API_TOKEN. Nhờ vậy thanh toán tự lên Pro/credit kể cả khi
 * người dùng đã đóng trang QR (không phụ thuộc frontend polling).
 */
@Injectable()
export class SepayPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SepayPoller');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly billing: BillingService) {}

  onModuleInit() {
    if (!getSepayApiToken()) {
      this.logger.log('SEPAY_API_TOKEN chưa đặt → tắt tự đối soát nền (thanh toán chưa tự động).');
      return;
    }
    this.logger.log('Bật tự đối soát SePay mỗi 20s.');
    this.timer = setInterval(() => void this.tick(), 20_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // tránh chồng lần chạy
    this.running = true;
    try {
      const n = await this.billing.reconcilePendingViaSepay();
      if (n > 0) this.logger.log(`Đã tự ghi nhận ${n} thanh toán từ SePay.`);
    } catch (e) {
      this.logger.warn('Lỗi khi đối soát SePay: ' + (e as Error).message);
    } finally {
      this.running = false;
    }
  }
}
