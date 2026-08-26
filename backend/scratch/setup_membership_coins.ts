import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not defined in environment variables.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Bắt đầu thiết lập bảng gói thành viên (plan) và xu (coin)...');

  try {
    console.log('1. Tạo enum MembershipPlan / CoinTransactionType...');
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "MembershipPlan" AS ENUM ('FREE', 'PLUS', 'PRO');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "CoinTransactionType" AS ENUM ('PLAN_ALLOWANCE', 'TOP_UP', 'GIFT_SENT', 'GIFT_RECEIVED');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log('Tạo enum thành công.');

    console.log('2. Thêm cột plan / coinBalance vào bảng User...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" "MembershipPlan" NOT NULL DEFAULT \'FREE\';'
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coinBalance" INTEGER NOT NULL DEFAULT 0;'
    );
    console.log('Thêm cột vào User thành công.');

    console.log('3. Tạo bảng DailyUsage...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DailyUsage" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "usageDate" DATE NOT NULL,
        "pinCount" INTEGER NOT NULL DEFAULT 0,
        "aiCount" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsage_userId_usageDate_key" ON "DailyUsage"("userId", "usageDate");'
    );
    console.log('Tạo bảng DailyUsage thành công.');

    console.log('4. Tạo bảng CoinTransaction...');
    await prisma.$executeRawUnsafe(`
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
    `);
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");'
    );
    console.log('Tạo bảng CoinTransaction thành công.');

    console.log('Hoàn tất thiết lập gói thành viên và xu!');
  } catch (error) {
    console.error('Lỗi trong quá trình thiết lập:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
