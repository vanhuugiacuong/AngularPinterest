import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const clipServiceUrl = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';

if (!connectionString) {
  console.error('DATABASE_URL is not defined in environment variables.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function getImageEmbedding(imageUrl: string): Promise<number[] | null> {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Download image from CDN
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('Content-Type') || 'image/png';

      // 2. Upload to CLIP microservice
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
      formData.append('file', blob, 'image.png');

      const clipResponse = await fetch(`${clipServiceUrl}/embed/image`, {
        method: 'POST',
        body: formData,
      });

      if (!clipResponse.ok) {
        throw new Error(`CLIP service error: ${clipResponse.statusText}`);
      }

      const result = await clipResponse.json();
      return result.embedding;
    } catch (error: any) {
      console.warn(`[Attempt ${attempt}/${maxRetries}] Failed to embed ${imageUrl}:`, error.message || error);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // wait 2s before retry
      }
    }
  }
  return null;
}

async function run() {
  console.log('Bắt đầu quét và sinh vector embedding cho các ghim cũ...');
  
  // Query all pins that do not have an embedding
  const pins: any[] = await prisma.$queryRaw`
    SELECT id, "imageUrl", title FROM "Pin" WHERE embedding IS NULL
  `;

  console.log(`Tìm thấy ${pins.length} ghim chưa có vector embedding.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    console.log(`[${i + 1}/${pins.length}] Đang xử lý: "${pin.title}" (ID: ${pin.id})...`);

    const embedding = await getImageEmbedding(pin.imageUrl);
    if (embedding) {
      try {
        await prisma.$executeRawUnsafe(
          'UPDATE "Pin" SET "embedding" = $1::vector WHERE id = $2',
          JSON.stringify(embedding),
          pin.id
        );
        console.log(` -> Thành công!`);
        successCount++;
      } catch (dbErr) {
        console.error(` -> Lỗi lưu database cho ghim ${pin.id}:`, dbErr);
        failCount++;
      }
    } else {
      console.error(` -> Thất bại khi trích xuất vector.`);
      failCount++;
    }
  }

  console.log(`========================================`);
  console.log(`Hoàn thành quá trình đồng bộ vector!`);
  console.log(`Thành công: ${successCount}`);
  console.log(`Thất bại: ${failCount}`);

  await prisma.$disconnect();
  await pool.end();
}

run().catch(console.error);
