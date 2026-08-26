// DTO thuần (không dùng class-validator vì dự án không cài). Service tự kiểm tra
// giá trị hợp lệ (findPlan/findPack ném BadRequest nếu sai).

export interface SubscribeDto {
  plan: 'MONTHLY' | 'YEARLY';
}

export interface BuyCreditsDto {
  packCode: 'S' | 'M' | 'L' | 'XL';
}

/**
 * Payload webhook SePay (các trường mình dùng).
 * Tham chiếu: https://docs.sepay.vn/tich-hop-webhooks.html
 */
export interface SepayWebhookDto {
  id?: string;
  content?: string; // nội dung CK (chứa memo định danh, vd "PINHUBABC123")
  code?: string;
  transferAmount?: number;
  transferType?: string; // "in" | "out"
  referenceCode?: string;
  gateway?: string;
}
