import * as dotenv from 'dotenv';
dotenv.config();
import { VISUAL_CATEGORY_PROMPTS, classifyEmbedding, VisualCategory } from '../src/pins/visual-search';

const CLIP = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';

async function eImg(url: string): Promise<number[] | null> {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(b)], { type: r.headers.get('content-type') || 'image/jpeg' }), 'q.jpg');
    const c = await fetch(`${CLIP}/embed/image`, { method: 'POST', body: fd });
    return c.ok ? (await c.json()).embedding : null;
  } catch { return null; }
}
async function eTxt(q: string) { return (await (await fetch(`${CLIP}/embed/text?query=${encodeURIComponent(q)}`)).json()).embedding; }

const CASES: { want: VisualCategory; url: string }[] = [
  { want: 'dog', url: 'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { want: 'dog', url: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=600' },
  { want: 'cat', url: 'https://images.pexels.com/photos/13081375/pexels-photo-13081375.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { want: 'cat', url: 'https://images.unsplash.com/photo-1495360010541-f48722b34f7d?w=600' },
  { want: 'animal', url: 'https://images.unsplash.com/photo-1508817628294-5a453fa0b8fb?w=600' }, // tiger
  { want: 'animal', url: 'https://images.unsplash.com/photo-1540573133985-87b6da6d54a9?w=600' }, // monkey
  { want: 'animal', url: 'https://images.unsplash.com/photo-1472491235688-bdc81a63246e?w=600' }, // (blue-eyed cat, mislabeled goose in seed) -> should be cat actually
  { want: 'person', url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=600' }, // man portrait
  { want: 'person', url: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=600' },
  { want: 'food', url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600' },
  { want: 'food', url: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600' },
  { want: 'scenery', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600' },
  { want: 'scenery', url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=600' }, // city
  { want: 'anime', url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600' }, // anime figure
  { want: 'anime', url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600' }, // illustration
  { want: 'product', url: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600' }, // car
  { want: 'product', url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600' }, // headphones
];

async function run() {
  const pv = await Promise.all(VISUAL_CATEGORY_PROMPTS.map(async (p) => ({ category: p.category, vector: await eTxt(p.prompt) })));
  let ok = 0, total = 0;
  for (const c of CASES) {
    const iv = await eImg(c.url);
    if (!iv) { console.log(`DEAD  ${c.url}`); continue; }
    total++;
    const r = classifyEmbedding(iv, pv);
    const hit = r.category === c.want;
    if (hit) ok++;
    console.log(
      `${hit ? 'OK  ' : 'MISS'} want=${c.want.padEnd(8)} got=${r.category.padEnd(8)} margin=${r.margin.toFixed(3)}${r.lowConfidence ? ' (low)' : ''}  ` +
      r.perCategory.slice(0, 3).map((p) => `${p.category}:${p.score.toFixed(3)}`).join('  '),
    );
  }
  console.log(`\n${ok}/${total} correct`);
}
run().catch((e) => { console.error(e); process.exit(1); });
