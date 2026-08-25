import { MembershipPlan } from '@prisma/client';

export interface PlanEntitlements {
  /** null means unlimited AI generations. */
  aiDailyLimit: number | null;
  cleanDownload: boolean;
  customWatermark: boolean;
  advancedWatermark: boolean;
  canSell: boolean;
  canAuction: boolean;
  maxWatermarkPresets: number;
}

// Nguồn sự thật duy nhất cho quyền lợi từng gói - backend phải luôn kiểm tra
// dựa trên bảng này, không tin bất kỳ giá trị entitlement nào gửi từ client.
export const PLAN_ENTITLEMENTS: Record<MembershipPlan, PlanEntitlements> = {
  FREE: {
    aiDailyLimit: 3,
    cleanDownload: false,
    customWatermark: false,
    advancedWatermark: false,
    canSell: false,
    canAuction: false,
    maxWatermarkPresets: 0,
  },
  PLUS: {
    aiDailyLimit: 10,
    cleanDownload: true,
    customWatermark: true,
    advancedWatermark: false,
    canSell: true,
    canAuction: false,
    maxWatermarkPresets: 1,
  },
  PRO: {
    aiDailyLimit: null,
    cleanDownload: true,
    customWatermark: true,
    advancedWatermark: true,
    canSell: true,
    canAuction: true,
    maxWatermarkPresets: 20,
  },
};

// Giá tự tính ở backend - frontend không bao giờ được quyết định số tiền.
export const PLAN_PRICE_VND: Record<MembershipPlan, number> = {
  FREE: 0,
  PLUS: 99000,
  PRO: 199000,
};

export const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
