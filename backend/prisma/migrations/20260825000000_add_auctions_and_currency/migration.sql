-- Đấu giá tranh: thêm Currency (whitelist, chỉ VND ở giai đoạn này), Auction,
-- AuctionBid, và liên kết ImagePurchase với phiên đấu giá để tái sử dụng
-- luồng thanh toán/tải bản gốc đã có cho người thắng đấu giá.

CREATE TYPE "Currency" AS ENUM ('VND');

CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

ALTER TABLE "Pin" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'VND';

ALTER TABLE "ImagePurchase" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'VND', ADD COLUMN "auctionId" TEXT;

CREATE TABLE "Auction" (
  "id" TEXT NOT NULL,
  "pinId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'VND',
  "startingPrice" DECIMAL(12,2) NOT NULL,
  "currentPrice" DECIMAL(12,2) NOT NULL,
  "minimumIncrement" DECIMAL(12,2) NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "AuctionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "winnerId" TEXT,
  "bidCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Auction_sellerId_status_idx" ON "Auction"("sellerId", "status");
CREATE INDEX "Auction_status_endsAt_idx" ON "Auction"("status", "endsAt");
CREATE INDEX "Auction_pinId_status_idx" ON "Auction"("pinId", "status");

-- Tối đa 1 phiên đấu giá chưa kết thúc (DRAFT/SCHEDULED/ACTIVE) cho mỗi pin.
-- Prisma schema DSL không hỗ trợ unique index có điều kiện (WHERE) nên
-- constraint này chỉ tồn tại ở migration.sql, không có trong schema.prisma -
-- đây là điểm "unmanaged" cần lưu ý khi chạy `prisma migrate diff`/`db pull`.
CREATE UNIQUE INDEX "Auction_pin_active_unique" ON "Auction"("pinId") WHERE "status" IN ('DRAFT', 'SCHEDULED', 'ACTIVE');

ALTER TABLE "Auction" ADD CONSTRAINT "Auction_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuctionBid" (
  "id" TEXT NOT NULL,
  "auctionId" TEXT NOT NULL,
  "bidderId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "requestKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuctionBid_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuctionBid_requestKey_key" ON "AuctionBid"("requestKey");
CREATE INDEX "AuctionBid_auctionId_createdAt_idx" ON "AuctionBid"("auctionId", "createdAt");

ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ImagePurchase_auctionId_key" ON "ImagePurchase"("auctionId");
ALTER TABLE "ImagePurchase" ADD CONSTRAINT "ImagePurchase_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
