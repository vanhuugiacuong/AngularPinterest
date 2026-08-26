-- CreateEnum (guarded: CREATE TYPE has no IF NOT EXISTS in Postgres)
DO $$ BEGIN
  CREATE TYPE "MembershipPlan" AS ENUM ('FREE', 'PLUS', 'PRO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CoinTransactionType" AS ENUM ('PLAN_ALLOWANCE', 'TOP_UP', 'GIFT_SENT', 'GIFT_RECEIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" "MembershipPlan" NOT NULL DEFAULT 'FREE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coinBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DailyUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "usageDate" DATE NOT NULL,
  "pinCount" INTEGER NOT NULL DEFAULT 0,
  "aiCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsage_userId_usageDate_key" ON "DailyUsage"("userId", "usageDate");

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoinTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "type" "CoinTransactionType" NOT NULL,
  "relatedUserId" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");
