/**
 * Sets up and backfills the Pin."visualCategory" column used by "search by image".
 *
 * "visualCategory" is the visual category of the pin's IMAGE (dog / cat / animal /
 * person / food / scenery / anime / product), decided by CLIP zero-shot
 * classification of the stored embedding. It is managed outside Prisma, exactly
 * like the "embedding" column.
 *
 * Run whenever new embedded pins have been added (e.g. after a seed script):
 *   npx ts-node --transpile-only scratch/classify_visual_categories.ts
 *   npx ts-node --transpile-only scratch/classify_visual_categories.ts --all   # re-classify everything
 *
 * Needs the CLIP service (CLIP_SERVICE_URL, default http://localhost:8001).
 */
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { VISUAL_CATEGORY_PROMPTS, classifyEmbedding, VisualCategory } from '../src/pins/visual-search';

dotenv.config();

const CLIP = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';
const REDO_ALL = process.argv.includes('--all');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function embedText(q: string): Promise<number[]> {
  const r = await fetch(`${CLIP}/embed/text?query=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`clip /embed/text ${r.status}`);
  return (await r.json()).embedding;
}

function parseVector(text: string): number[] {
  // pgvector ::text form is "[0.1,0.2,...]"
  return text.replace(/^\[|\]$/g, '').split(',').map(Number);
}

async function run() {
  console.log('1. Đảm bảo cột "visualCategory" tồn tại...');
  await pool.query('ALTER TABLE "Pin" ADD COLUMN IF NOT EXISTS "visualCategory" TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS "Pin_visualCategory_idx" ON "Pin" ("visualCategory")');

  console.log('2. Lấy vector cho các prompt phân loại...');
  const promptVectors = await Promise.all(
    VISUAL_CATEGORY_PROMPTS.map(async (p) => ({ category: p.category, vector: await embedText(p.prompt) })),
  );

  const where = REDO_ALL
    ? 'embedding IS NOT NULL'
    : 'embedding IS NOT NULL AND "visualCategory" IS NULL';
  const { rows } = await pool.query(
    `SELECT id, title, (embedding::text) AS emb FROM "Pin" WHERE ${where}`,
  );
  console.log(`3. Phân loại ${rows.length} ghim...`);

  const tally: Record<string, number> = {};
  let done = 0;
  for (const row of rows) {
    let embedding: number[];
    try {
      embedding = parseVector(row.emb);
    } catch {
      console.warn(`  bỏ qua ${row.id}: không đọc được embedding`);
      continue;
    }
    const { category, lowConfidence, margin } = classifyEmbedding(embedding, promptVectors);
    await pool.query('UPDATE "Pin" SET "visualCategory" = $1 WHERE id = $2', [category, row.id]);
    tally[category] = (tally[category] || 0) + 1;
    done++;
    if (lowConfidence) {
      console.log(`  ~ "${row.title}" -> ${category} (margin ${margin.toFixed(3)}, thấp)`);
    }
  }

  console.log(`\nĐã phân loại ${done} ghim. Phân bố:`);
  for (const c of Object.keys(tally).sort((a, b) => tally[b] - tally[a])) {
    console.log(`  ${c.padEnd(9)} ${tally[c]}`);
  }

  // Show total pool sizes (what "search by image" filters against)
  const { rows: pool2 } = await pool.query(
    `SELECT "visualCategory" AS c, COUNT(*)::int AS n
     FROM "Pin" WHERE embedding IS NOT NULL AND "visualCategory" IS NOT NULL
     GROUP BY "visualCategory" ORDER BY n DESC`,
  );
  console.log('\nTổng số ảnh đã có vector theo từng category (dùng để so khớp):');
  for (const r of pool2) console.log(`  ${String(r.c).padEnd(9)} ${r.n}`);

  await pool.end();
}
run().catch((e) => { console.error(e); process.exit(1); });
