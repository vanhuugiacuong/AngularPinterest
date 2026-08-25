import { SetMetadata } from '@nestjs/common';
import { PlanEntitlements } from './entitlements';

export const ENTITLEMENT_KEY = 'requiredEntitlement';

// Đánh dấu 1 route yêu cầu quyền lợi cụ thể theo PLAN_ENTITLEMENTS, ví dụ
// @RequireEntitlement('canSell'). Dùng cùng với PlansGuard.
export const RequireEntitlement = (key: keyof PlanEntitlements) =>
  SetMetadata(ENTITLEMENT_KEY, key);
