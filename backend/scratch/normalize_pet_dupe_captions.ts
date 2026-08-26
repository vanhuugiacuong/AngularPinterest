/**
 * Some pet photos used by the visual-search seed also exist as older seed pins
 * under other mock accounts, with unrelated captions ("Đường đèo uốn lượn",
 * "Chuột Hamster", "Chim công"...). Visual search de-dupes by image URL and can
 * surface whichever row it hits first, so the wrong caption sometimes shows.
 *
 * This copies the clean caption/description/category from each sample-user-id-pets
 * pin onto every other mock-account row that shares the same image URL, plus a
 * few extra mislabels found by eye. Mock accounts only. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const MOCK = ['mock-user-id-12345','sample-user-id-1','sample-user-id-2','sample-user-id-3','sample-user-id-4','sample-user-id-5','sample-user-id-6','sample-user-id-7','sample-user-id-8','sample-user-id-pets'];
const PETS = 'sample-user-id-pets';

// Extra dog/cat photos (mock accounts) whose captions name the wrong animal and
// which are not covered by a sample-user-id-pets row. Verified by eye.
const EXTRA: { match: string; title: string; description: string }[] = [
  { match: 'photo-1596492784531-6e6eb5ea9993', title: 'Chó Samoyed ngồi giữa kim tuyến',
    description: 'Ngồi im giữa đống kim tuyến sinh nhật, chờ ai đó nhớ ra là tới phần cắt bánh.' },
  { match: 'photo-1472491235688-bdc81a63246e', title: 'Mèo mắt xanh ngước nhìn đòi ăn',
    description: 'Ngước đôi mắt xanh lên nhìn, kiểu này là tới giờ cơm mà chưa ai để ý.' },
];

async function run() {
  const petPins = await prisma.pin.findMany({
    where: { userId: PETS },
    select: { imageUrl: true, title: true, description: true, category: true },
  });
  console.log(`Chuẩn hoá caption theo ${petPins.length} ghim của ${PETS}...`);

  let propagated = 0;
  for (const p of petPins) {
    const res = await prisma.pin.updateMany({
      where: {
        imageUrl: p.imageUrl,
        userId: { in: MOCK.filter(id => id !== PETS) },
      },
      data: { title: p.title, description: p.description ?? undefined, category: p.category },
    });
    if (res.count) { propagated += res.count; console.log(`  ${p.imageUrl.split('/').pop()?.slice(0, 40)} -> ${res.count} bản trùng`); }
  }

  let extra = 0;
  for (const e of EXTRA) {
    const res = await prisma.pin.updateMany({
      where: { userId: { in: MOCK }, imageUrl: { contains: e.match } },
      data: { title: e.title, description: e.description, category: 'animals' },
    });
    if (res.count) { extra += res.count; console.log(`  [extra] ${e.match} -> ${res.count} ("${e.title}")`); }
  }

  console.log(`Xong. Đồng bộ ${propagated} bản trùng + ${extra} ghim mislabel khác.`);
  await prisma.$disconnect();
  await pool.end();
}
run().catch((e) => { console.error(e); process.exit(1); });
