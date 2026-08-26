-- ─────────────────────────────────────────────────────────────────────────────
-- Billing-QR (nhánh liem-billing-qr) — SQL CHỈ-THÊM, idempotent.
-- KHÔNG DROP / KHÔNG ALTER bảng cũ. Chạy lại nhiều lần đều an toàn.
-- Áp bằng: node backend/scratch/apply-billing.cjs
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Enums (CREATE TYPE không có IF NOT EXISTS -> bọc DO/EXCEPTION)
DO $$ BEGIN CREATE TYPE "SubPlan" AS ENUM ('MONTHLY','YEARLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SubStatus" AS ENUM ('ACTIVE','EXPIRED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PaymentPurpose" AS ENUM ('PRO_SUB','CREDIT_PACK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "QrPaymentStatus" AS ENUM ('PENDING','PAID','FAILED','EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CreditTxnType" AS ENUM ('PURCHASE','MONTHLY_GRANT','SPEND_DOWNLOAD','EARN_SALE','PLATFORM_FEE','GRANT_EXPIRE','REFUND'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Cột thêm vào User / Pin (ADD COLUMN IF NOT EXISTS -> an toàn)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPro" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "proExpiresAt" TIMESTAMP(3);

ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "isPremium" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "priceCredits" INTEGER;
ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "previewUrl" TEXT;
ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "originalPath" TEXT;
ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- 3) Bảng mới
CREATE TABLE IF NOT EXISTS "Wallet" (
  "userId"         TEXT PRIMARY KEY,
  "spendable"      INTEGER NOT NULL DEFAULT 0,
  "earnings"       INTEGER NOT NULL DEFAULT 0,
  "grantExpiresAt" TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Subscription" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "plan"      "SubPlan" NOT NULL,
  "status"    "SubStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "paymentId" TEXT,
  CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "Subscription_userId_idx" ON "Subscription"("userId");

CREATE TABLE IF NOT EXISTS "Payment" (
  "id"             TEXT PRIMARY KEY,
  "userId"         TEXT NOT NULL,
  "provider"       TEXT NOT NULL DEFAULT 'VIETQR',
  "purpose"        "PaymentPurpose" NOT NULL,
  "amountVnd"      INTEGER NOT NULL,
  "planCode"       TEXT,
  "packCode"       TEXT,
  "creditsGranted" INTEGER,
  "status"         "QrPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "memo"           TEXT NOT NULL,
  "gatewayRef"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "paidAt"         TIMESTAMP(3),
  CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_memo_key" ON "Payment"("memo");
CREATE INDEX IF NOT EXISTS "Payment_userId_createdAt_idx" ON "Payment"("userId","createdAt");

CREATE TABLE IF NOT EXISTS "PinEntitlement" (
  "userId"      TEXT NOT NULL,
  "pinId"       TEXT NOT NULL,
  "creditsPaid" INTEGER NOT NULL,
  "grantedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PinEntitlement_pkey" PRIMARY KEY ("userId","pinId"),
  CONSTRAINT "PinEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "PinEntitlement_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "PinEntitlement_pinId_idx" ON "PinEntitlement"("pinId");

CREATE TABLE IF NOT EXISTS "CreditTransaction" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL,
  "type"         "CreditTxnType" NOT NULL,
  "amount"       INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "refPinId"     TEXT,
  "refPaymentId" TEXT,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId","createdAt");
