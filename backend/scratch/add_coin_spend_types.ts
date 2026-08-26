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
  console.log('Thêm giá trị PLAN_REDEEM / AI_OVERAGE vào enum CoinTransactionType...');
  try {
    // ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction block,
    // so these run as two separate statements.
    await prisma.$executeRawUnsafe(`ALTER TYPE "CoinTransactionType" ADD VALUE IF NOT EXISTS 'PLAN_REDEEM';`);
    await prisma.$executeRawUnsafe(`ALTER TYPE "CoinTransactionType" ADD VALUE IF NOT EXISTS 'AI_OVERAGE';`);
    console.log('Hoàn tất!');
  } catch (error) {
    console.error('Lỗi:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
