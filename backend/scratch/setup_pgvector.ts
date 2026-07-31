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
  console.log('Bắt đầu thiết lập pgvector trên Supabase PostgreSQL...');

  try {
    // 1. Kích hoạt extension vector
    console.log('1. Kích hoạt extension vector...');
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('Kích hoạt extension vector thành công.');

    // 2. Thêm cột embedding nếu chưa tồn tại
    console.log('2. Thêm cột embedding vào bảng Pin...');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "embedding" vector(512);'
    );
    console.log('Thêm cột embedding thành công.');

    // 3. Tạo chỉ mục HNSW cho tìm kiếm cosine
    console.log('3. Tạo chỉ mục HNSW cho cột embedding...');
    // Lưu ý: Chúng ta đặt tên chỉ mục rõ ràng để dễ quản lý và kiểm tra
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Pin_embedding_hnsw_idx" ON "Pin" USING hnsw (embedding vector_cosine_ops);'
    );
    console.log('Tạo chỉ mục HNSW thành công.');

    console.log('Quá trình thiết lập pgvector hoàn tất thành công tốt đẹp!');
  } catch (error) {
    console.error('Lỗi trong quá trình thiết lập pgvector:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
