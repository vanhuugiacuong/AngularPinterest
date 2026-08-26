/**
 * Adds and backfills the Pin."avgColor" column (pgvector `vector(3)`, mean RGB
 * 0-255 of the pin image). Used by "search by image" to rank flat-colour crops
 * by colour proximity — CLIP alone barely distinguishes solid colours.
 *
 * Managed outside Prisma, like "embedding" / "visualCategory".
 *
 *   npx ts-node --transpile-only scratch/backfill_avg_colors.ts          # only missing
 *   npx ts-node --transpile-only scratch/backfill_avg_colors.ts --all    # recompute all
 *
 * Needs the CLIP service (CLIP_SERVICE_URL, default http://localhost:8001).
 */
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const CLIP = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';
const REDO_ALL = process.argv.includes('--all');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function avgColorOf(imageUrl: string): Promise<[number, number, number] | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(buffer)], { type: res.headers.get('Content-Type') || 'image/jpeg' }), 'i.jpg');
      const clip = await fetch(`${CLIP}/embed/image`, { method: 'POST', body: fd });
      if (!clip.ok) throw new Error(`clip ${clip.status}`);
      const json = await clip.json();
      const c = json.avg_color;
      if (!Array.isArray(c) || c.length < 3) throw new Error('no avg_color in response');
      return [c[0], c[1], c[2]];
    } catch (e: any) {
      console.warn(`  [thử ${attempt}/3] ${imageUrl}: ${e.message || e}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

async function run() {
  console.log('1. Đảm bảo cột "avgColor" tồn tại...');
  await pool.query('ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "avgColor" vector(3)');

  const where = REDO_ALL
    ? 'embedding IS NOT NULL'
    : 'embedding IS NOT NULL AND "avgColor" IS NULL';
  const { rows } = await pool.query(`SELECT id, title, "imageUrl" FROM "Pin" WHERE ${where}`);
  console.log(`2. Tính màu trung bình cho ${rows.length} ghim...`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rgb = await avgColorOf(r.imageUrl);
    if (rgb) {
      await pool.query('UPDATE "Pin" SET "avgColor" = $1::vector WHERE id = $2', [JSON.stringify(rgb), r.id]);
      ok++;
      if ((i + 1) % 25 === 0) console.log(`   ...${i + 1}/${rows.length}`);
    } else {
      fail++;
      console.warn(`   thất bại: "${r.title}"`);
    }
  }

  console.log(`\nXong. Thành công ${ok} | thất bại ${fail}`);
  await pool.end();
}
run().catch((e) => { console.error(e); process.exit(1); });
