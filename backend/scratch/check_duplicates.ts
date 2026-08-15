import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  try {
    const duplicates: any[] = await prisma.$queryRaw`
      SELECT "imageUrl", title, COUNT(*)::int AS cnt 
      FROM "Pin" 
      GROUP BY "imageUrl", title 
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
    `;
    console.log(`Tìm thấy ${duplicates.length} hình ảnh bị trùng lặp bản ghi trong DB:`);
    for (let i = 0; i < Math.min(5, duplicates.length); i++) {
      console.log(` - URL: ${duplicates[i].imageUrl} | Tiêu đề: "${duplicates[i].title}" | Lặp lại: ${duplicates[i].cnt} lần`);
    }
  } catch (error) {
    console.error('Error checking duplicates:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

run();
