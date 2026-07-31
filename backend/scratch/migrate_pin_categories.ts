import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function classifyCategory(title: string, description?: string): string {
  const text = `${title} ${description || ''}`.toLowerCase();

  // 1. Meme / Animals / Pet Memes
  const memeKeywords = ['meme', 'chế', 'hài hước', 'funny', 'chó', 'cún', 'dog', 'puppy', 'mèo', 'cat', 'kitten', 'boss mèo', 'pet', 'thú cưng', 'ngáo', 'corgi', 'husky', 'pug', 'sóc', 'heo con', 'hamster', 'alpaca', 'lạc đà'];
  if (memeKeywords.some(kw => text.includes(kw))) return 'meme';

  // 2. K-Pop / Idol / Stage
  const kpopKeywords = ['kpop', 'k-pop', 'idol', 'stage', 'sân khấu', 'biểu diễn', 'vũ đạo', 'concert', 'lightstick', 'album', 'blackpink', 'bts', 'twice', 'nữ thần', 'nam thần', 'visual', 'seoul', 'k-fashion'];
  if (kpopKeywords.some(kw => text.includes(kw))) return 'kpop';

  // 3. Drawing / Art / Sketch
  const drawingKeywords = ['vẽ', 'drawing', 'art', 'sketch', 'ký họa', 'phác thảo', 'tranh', 'sơn dầu', 'acrylic', 'vải canvas', 'canvas', 'chì', 'than chì', 'charcoal', 'màu nước', 'cọ vẽ', 'bảng vẽ', 'hội họa', 'tác phẩm', 'studio', 'nét vẽ'];
  if (drawingKeywords.some(kw => text.includes(kw))) return 'drawing';

  // 4. Anime / Manga / Cyberpunk
  const animeKeywords = ['anime', 'manga', 'tokyo', 'cyberpunk', 'synthwave', 'hacker', 'led rgb', 'game', 'gaming', 'wacom', 'hộp băng', 'tay cầm', 'hạ độ', 'phim hoạt hình', 'nhân vật hoạt hình'];
  if (animeKeywords.some(kw => text.includes(kw))) return 'anime';

  // 5. Nature / Landscape
  const natureKeywords = ['thiên nhiên', 'nature', 'phong cảnh', 'landscape', 'bầu trời', 'hoàng hôn', 'sunset', 'biển', 'beach', 'rừng', 'forest', 'cây', 'tree', 'lá phong', 'hoa', 'flower'];
  if (natureKeywords.some(kw => text.includes(kw))) return 'nature';

  // 6. Food / Cooking
  const foodKeywords = ['ramen', 'món ăn', 'nấu ăn', 'food', 'cooking', 'ẩm thực', 'ăn uống', 'quán ăn', 'bánh', 'cà phê', 'coffee'];
  if (foodKeywords.some(kw => text.includes(kw))) return 'food';

  // 7. Fashion
  const fashionKeywords = ['thời trang', 'fashion', 'outfit', 'streetwear', 'trang phục', 'makeup', 'lookbook', 'phong cách', 'áo'];
  if (fashionKeywords.some(kw => text.includes(kw))) return 'fashion';

  return 'other';
}

async function run() {
  console.log('Bắt đầu cập nhật toàn bộ chủ đề cho các ghim hiện có trong database...');
  const pins = await prisma.pin.findMany();
  console.log(`Đã tìm thấy ${pins.length} ghim cần kiểm tra.`);

  let updatedCount = 0;
  for (const pin of pins) {
    const newCategory = classifyCategory(pin.title, pin.description || '');
    if (pin.category !== newCategory) {
      await prisma.pin.update({
        where: { id: pin.id },
        data: { category: newCategory }
      });
      console.log(`Cập nhật ghim "${pin.title}": ${pin.category} -> ${newCategory}`);
      updatedCount++;
    }
  }

  console.log(`Hoàn thành! Đã cập nhật chủ đề cho ${updatedCount} ghim.`);
  await prisma.$disconnect();
  pool.end();
}

run().catch(console.error);
