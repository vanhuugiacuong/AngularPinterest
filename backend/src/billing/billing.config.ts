/**
 * Cấu hình thương mại hoá — chỉnh ở đây, không cần sửa logic.
 * Giá theo VND (số nguyên). Nên đồng bộ với frontend billing.ts.
 */

export type PlanCode = 'MONTHLY' | 'YEARLY';
export type PackCode = 'S' | 'M' | 'L' | 'XL';

export interface Plan {
  code: PlanCode;
  name: string;
  priceVnd: number;
  months: number;
  grantCredits: number;
  badge?: string;
}

export interface CreditPack {
  code: PackCode;
  credits: number;
  priceVnd: number;
  popular?: boolean;
}

export const PLANS: Plan[] = [
  { code: 'MONTHLY', name: 'Pro tháng', priceVnd: 79000, months: 1, grantCredits: 300 },
  { code: 'YEARLY', name: 'Pro năm', priceVnd: 790000, months: 12, grantCredits: 300, badge: 'Tiết kiệm 17%' },
];

export const CREDIT_PACKS: CreditPack[] = [
  { code: 'S', credits: 100, priceVnd: 20000 },
  { code: 'M', credits: 300, priceVnd: 55000, popular: true },
  { code: 'L', credits: 700, priceVnd: 120000 },
  { code: 'XL', credits: 1500, priceVnd: 240000 },
];

export const PREMIUM_PRICE_MIN = 10;
export const PREMIUM_PRICE_MAX = 500;
export const PLATFORM_FEE_PERCENT = 30;

/** Đơn QR hết hạn sau 10 phút. */
export const QR_EXPIRE_MS = 10 * 60 * 1000;

/**
 * Tài khoản nhận tiền để sinh VietQR.
 * Đọc từ ENV để không hardcode; có giá trị mặc định (placeholder) cho môi trường dev.
 *   BANK_BIN         mã ngân hàng theo chuẩn Napas (vd MB Bank = 970422)
 *   BANK_ACCOUNT_NO  số tài khoản nhận tiền
 *   BANK_ACCOUNT_NAME tên chủ tài khoản (không dấu)
 *   BANK_SHORT_NAME  tên hiển thị
 */
// Đọc process.env LAZY (mỗi lần gọi) — vì .env được ConfigModule nạp lúc runtime,
// SAU khi file config này được import. Nếu đọc ở top-level sẽ ra giá trị mặc định.
export function getBank() {
  return {
    bin: process.env.BANK_BIN || '970418', // BIDV
    accountNo: process.env.BANK_ACCOUNT_NO || '8883473334',
    accountName: process.env.BANK_ACCOUNT_NAME || 'NGUYEN THANH LIEM',
    shortName: process.env.BANK_SHORT_NAME || 'BIDV',
  };
}

/** Khoá xác thực webhook SePay (đặt trùng với "API Key" cấu hình trong SePay). */
export function getSepayApiKey(): string {
  return process.env.SEPAY_API_KEY || '';
}

export function findPlan(code?: string): Plan | undefined {
  return PLANS.find((p) => p.code === code);
}

export function findPack(code?: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.code === code);
}

/** URL ảnh VietQR có nhúng sẵn số tiền + nội dung chuyển khoản. */
export function buildQrUrl(amountVnd: number, memo: string): string {
  const bank = getBank();
  const params = new URLSearchParams({
    amount: String(amountVnd),
    addInfo: memo,
    accountName: bank.accountName,
  });
  return `https://img.vietqr.io/image/${bank.bin}-${bank.accountNo}-compact2.png?${params.toString()}`;
}
