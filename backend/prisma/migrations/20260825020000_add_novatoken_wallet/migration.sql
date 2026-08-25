ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'NOVA_TOKEN';

CREATE TYPE "NovaTokenTopUpStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');
CREATE TYPE "NovaTokenEntryType" AS ENUM ('TOP_UP', 'FIXED_PURCHASE', 'FIXED_SALE', 'BID_HOLD', 'BID_RELEASE', 'AUCTION_SALE', 'REFUND', 'ADMIN_ADJUSTMENT');

ALTER TABLE "User" ADD COLUMN "novaTokenBalance" DECIMAL(18,0) NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_novaTokenBalance_nonnegative" CHECK ("novaTokenBalance" >= 0);

CREATE TABLE "NovaTokenTopUp" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenAmount" DECIMAL(18,0) NOT NULL,
  "vndAmount" DECIMAL(12,2) NOT NULL,
  "paymentReference" TEXT NOT NULL,
  "status" "NovaTokenTopUpStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL DEFAULT 'sepay',
  "providerTransactionId" TEXT,
  "rawPayload" JSONB,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NovaTokenTopUp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NovaTokenTopUp_positive" CHECK ("tokenAmount" > 0 AND "vndAmount" > 0)
);

CREATE TABLE "NovaTokenLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NovaTokenEntryType" NOT NULL,
  "amount" DECIMAL(18,0) NOT NULL,
  "balanceAfter" DECIMAL(18,0) NOT NULL,
  "referenceKey" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NovaTokenLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuctionTokenHold" (
  "id" TEXT NOT NULL,
  "auctionId" TEXT NOT NULL,
  "bidderId" TEXT NOT NULL,
  "amount" DECIMAL(18,0) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuctionTokenHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuctionTokenHold_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "NovaTokenTopUp_paymentReference_key" ON "NovaTokenTopUp"("paymentReference");
CREATE UNIQUE INDEX "NovaTokenTopUp_providerTransactionId_key" ON "NovaTokenTopUp"("providerTransactionId");
CREATE INDEX "NovaTokenTopUp_userId_status_createdAt_idx" ON "NovaTokenTopUp"("userId", "status", "createdAt");
CREATE UNIQUE INDEX "NovaTokenLedger_referenceKey_key" ON "NovaTokenLedger"("referenceKey");
CREATE INDEX "NovaTokenLedger_userId_createdAt_idx" ON "NovaTokenLedger"("userId", "createdAt");
CREATE UNIQUE INDEX "AuctionTokenHold_auctionId_bidderId_key" ON "AuctionTokenHold"("auctionId", "bidderId");
CREATE INDEX "AuctionTokenHold_bidderId_idx" ON "AuctionTokenHold"("bidderId");

ALTER TABLE "NovaTokenTopUp" ADD CONSTRAINT "NovaTokenTopUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NovaTokenLedger" ADD CONSTRAINT "NovaTokenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuctionTokenHold" ADD CONSTRAINT "AuctionTokenHold_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuctionTokenHold" ADD CONSTRAINT "AuctionTokenHold_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
