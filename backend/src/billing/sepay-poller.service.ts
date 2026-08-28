import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BillingService } from './billing.service';
import { getSepayApiToken } from './billing.config';

/**
 * Nền: cứ ~20s tự hỏi SePay xem có tiền vào khớp đơn đang chờ không, rồi ghi nhận.
 * Việc đối soát SePay chỉ chạy khi có SEPAY_API_TOKEN, nhưng việc DỌN đơn PENDING
 * đã hết hạn thì luôn chạy — đây là timer duy nhất làm việc đó (xem
 * expireStalePendingPayments), nên không thể tắt cùng điều kiện với SePay.
 * Nhờ vậy thanh toán tự lên Pro/credit kể cả khi người dùng đã đóng trang QR
 * (không phụ thuộc frontend polling).
 */
@Injectable()
export class SepayPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SepayPoller');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly billing: BillingService) {}

  onModuleInit() {
    if (getSepayApiToken()) {
      this.logger.log('Bật tự đối soát SePay + dọn đơn hết hạn mỗi 20s.');
    } else {
      this.logger.log('SEPAY_API_TOKEN chưa đặt → chỉ tự dọn đơn hết hạn mỗi 20s (chưa tự đối soát tiền vào).');
    }
    this.timer = setInterval(() => void this.tick(), 20_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // tránh chồng lần chạy
    this.running = true;
    try {
      if (getSepayApiToken()) {
        const n = await this.billing.reconcilePendingViaSepay();
        if (n > 0) this.logger.log(`Đã tự ghi nhận ${n} thanh toán từ SePay.`);
      }
      const expired = await this.billing.expireStalePendingPayments();
      if (expired > 0) this.logger.log(`Đã chuyển ${expired} đơn quá hạn sang EXPIRED.`);
    } catch (e) {
      this.logger.warn('Lỗi khi đối soát/dọn đơn: ' + (e as Error).message);
    } finally {
      this.running = false;
    }
  }
}
