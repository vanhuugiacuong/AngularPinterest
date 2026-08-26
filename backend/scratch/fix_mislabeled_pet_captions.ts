/**
 * A handful of seed pins owned by the mock meme/food accounts point at dog or
 * cat photos but carry nonsense captions ("Meerkat...", "Llama...", "Vịt...").
 * They surface in "search by image" results (correctly — the image really is a
 * dog/cat), but the wrong captions break the consistent voice of the result set.
 *
 * This fixes the caption/title on those specific image URLs, scoped to the mock
 * seed accounts only. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const MOCK_USER_IDS = [
  'mock-user-id-12345',
  'sample-user-id-1', 'sample-user-id-2', 'sample-user-id-3', 'sample-user-id-4',
  'sample-user-id-5', 'sample-user-id-6', 'sample-user-id-7', 'sample-user-id-8',
];

// imageUrl fragment -> corrected { title, description }. Content verified by eye.
const FIXES: { match: string; title: string; description: string; category: string }[] = [
  { match: 'photo-1503256207526-0d5d80fa2f47', category: 'animals',
    title: 'Chó Border Collie hóng chuyện khắp xóm',
    description: 'Đứng ngoài cửa nghe ngóng xem hôm nay khu phố có drama gì mới.' },
  { match: 'photo-1504208434309-cb69f4fe52b0', category: 'animals',
    title: 'Chó Samoyed ngắm hồ nước một mình',
    description: 'Ra bờ hồ nằm ngắm cảnh, ra vẻ trầm tư như nhân vật chính phim điện ảnh.' },
  { match: 'photo-1527362950785-f487a7c1fe48', category: 'animals',
    title: 'Bế bé Samoyed to đùng trên tay',
    description: 'To lớn thế này rồi vẫn thích được bế, ai bế nổi thì bế.' },
  { match: 'photo-1535930891776-0c2dfb7fda1a', category: 'animals',
    title: 'Cún đeo kính giả vờ đọc tạp chí',
    description: 'Đeo kính vào cho ra dáng trí thức, thật ra đang ngửi mùi trang giấy.' },
  { match: 'photo-1583337130417-3346a1be7dee', category: 'animals',
    title: 'Bulldog con mặc áo hoodie vàng',
    description: 'Mẹ mặc áo ấm cho rồi quay lưng dỗi vì kiểu áo không hợp gu.' },
  { match: 'photo-1520315342629-6ea920342047', category: 'animals',
    title: 'Mèo trắng ngồi làm mẫu ảnh',
    description: 'Ngồi im một góc phông trắng, biết thừa mình lên hình là đẹp.' },
  { match: 'photo-1513245543132-31f507417b26', category: 'animals',
    title: 'Mèo mặt xị ngồi cạnh cửa kính',
    description: 'Cả buổi sáng ngồi nhìn ra phố với gương mặt không hài lòng chuyện gì đó.' },
];

async function run() {
  for (const f of FIXES) {
    const res = await prisma.pin.updateMany({
      where: {
        userId: { in: MOCK_USER_IDS },
        imageUrl: { contains: f.match },
      },
      data: { title: f.title, description: f.description, category: f.category },
    });
    console.log(`${f.match}  ->  ${res.count} ghim đã sửa  ("${f.title}")`);
  }
  await prisma.$disconnect();
  await pool.end();
}
run().catch((e) => { console.error(e); process.exit(1); });
