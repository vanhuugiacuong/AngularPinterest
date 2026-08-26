-- AlterEnum (add-only, safe against the shared DB — existing rows/values untouched)
ALTER TYPE "CoinTransactionType" ADD VALUE IF NOT EXISTS 'PLAN_REDEEM';
ALTER TYPE "CoinTransactionType" ADD VALUE IF NOT EXISTS 'AI_OVERAGE';
