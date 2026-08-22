ALTER TABLE "Pin" ADD COLUMN "originalStoragePath" TEXT;

ALTER TABLE "ImagePurchase" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "ImagePurchase" ADD COLUMN "providerTransactionId" TEXT;
ALTER TABLE "ImagePurchase" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "ImagePurchase" ALTER COLUMN "status" SET DEFAULT 'PENDING';
CREATE UNIQUE INDEX "ImagePurchase_paymentReference_key" ON "ImagePurchase"("paymentReference");
CREATE UNIQUE INDEX "ImagePurchase_providerTransactionId_key" ON "ImagePurchase"("providerTransactionId");

CREATE TYPE "WatermarkType" AS ENUM ('TEXT', 'LOGO');
CREATE TYPE "WatermarkPosition" AS ENUM ('TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'MIDDLE_LEFT', 'MIDDLE_CENTER', 'MIDDLE_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT');

CREATE TABLE "WatermarkPreset" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "WatermarkType" NOT NULL,
  "text" TEXT,
  "logoStoragePath" TEXT,
  "position" "WatermarkPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT',
  "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "scale" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
  "margin" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tiled" BOOLEAN NOT NULL DEFAULT false,
  "spacing" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WatermarkPreset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WatermarkPreset_userId_idx" ON "WatermarkPreset"("userId");
ALTER TABLE "WatermarkPreset" ADD CONSTRAINT "WatermarkPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
