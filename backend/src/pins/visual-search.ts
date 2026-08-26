/**
 * Shared logic for the "search by image" (reverse image search) pipeline.
 *
 * Kept in its own module (no Nest dependencies) so the one-off classification
 * backfill script in scratch/ can import the exact same taxonomy and maths that
 * the request path uses — the two must never drift.
 *
 * Pipeline (see PinsService.searchByImage):
 *   1. classify the query image into a visual category (CLIP zero-shot)
 *   2. embed the query image (CLIP image embedding)
 *   3. filter the seed data to that category, rank by cosine similarity
 *   4. blend in a small popularity signal so results aren't monotonous
 *   5. if the category pool is too small, log it — never backfill with other
 *      categories (that is the bug this whole feature exists to prevent)
 */

/** Visual categories a query image / pin can be sorted into. */
export type VisualCategory =
  | 'dog'
  | 'cat'
  | 'animal'
  | 'person'
  | 'food'
  | 'scenery'
  | 'anime'
  | 'product';

/**
 * CLIP text prompts, several per category for robustness. Classification takes
 * the category of the single highest-scoring prompt across this whole list.
 * The fine-grained animal prompts exist so a monkey / tiger / bird lands on
 * `animal` and never leaks into a `dog` or `cat` result set.
 */
export const VISUAL_CATEGORY_PROMPTS: { category: VisualCategory; prompt: string }[] = [
  { category: 'dog', prompt: 'a photograph of a dog or a puppy' },
  { category: 'dog', prompt: 'a close-up photograph of a pet dog' },

  { category: 'cat', prompt: 'a photograph of a domestic house cat or a kitten' },
  { category: 'cat', prompt: 'a close-up photograph of a pet cat' },

  { category: 'animal', prompt: 'a photograph of a tiger, lion, leopard, or cheetah' },
  { category: 'animal', prompt: 'a photograph of a monkey, ape, koala, panda, sloth, or squirrel' },
  { category: 'animal', prompt: 'a photograph of a bird, duck, goose, owl, or parrot' },
  { category: 'animal', prompt: 'a photograph of a pig, goat, sheep, cow, horse, alpaca, llama, or rabbit' },
  { category: 'animal', prompt: 'a photograph of a fish, frog, snake, turtle, lizard, or insect' },

  { category: 'person', prompt: 'a realistic photograph of a real person, a group of people, or a portrait' },
  { category: 'person', prompt: 'a photograph of a fashion model, an athlete, or a musician performing' },
  { category: 'person', prompt: 'a candid photo of people, a selfie, or a headshot' },

  { category: 'food', prompt: 'a photograph of food, a cooked meal, a burger, pizza, or a dessert' },
  { category: 'food', prompt: 'a close-up food photograph of a dish on a plate or board' },
  { category: 'food', prompt: 'a photograph of a drink, coffee, a smoothie, or a cocktail' },

  { category: 'scenery', prompt: 'a landscape photograph of nature, mountains, sky, sea, desert, or forest' },
  { category: 'scenery', prompt: 'a photograph of a building, architecture, a city skyline, or a street' },
  { category: 'scenery', prompt: 'a travel photograph of a place or a scenic view' },

  { category: 'anime', prompt: 'an anime or manga drawing of a character, digitally illustrated, not a photo' },
  { category: 'anime', prompt: 'a hand-drawn illustration, a cartoon, a comic panel, or concept art' },
  { category: 'anime', prompt: 'a pencil sketch or a painted artwork' },
  { category: 'anime', prompt: 'a colourful stylised digital illustration or fan art' },

  { category: 'product', prompt: 'a photograph of a car, a motorcycle, or a vehicle' },
  { category: 'product', prompt: 'a product photo of a gadget, a phone, a computer, headphones, or electronics' },
  { category: 'product', prompt: 'a product photo of furniture, shoes, a bag, a watch, or clothing' },
  { category: 'product', prompt: 'a photograph of a musical instrument or audio equipment' },
];

/** The distinct categories, in a stable order. */
export const VISUAL_CATEGORIES: VisualCategory[] = [...new Set(
  VISUAL_CATEGORY_PROMPTS.map((p) => p.category),
)] as VisualCategory[];

/**
 * When the winning category beats the runner-up category by less than this
 * cosine margin the classification is "low confidence": still usable (we keep
 * the top category so results stay single-category), but worth logging. Crop
 * search treats a low-confidence crop as "no clear object" → colour/texture rank.
 */
export const LOW_CONFIDENCE_MARGIN = 0.022;

/**
 * If the best category prompt scores below this absolute cosine value, the image
 * (or crop) doesn't clearly depict any known category — e.g. a tiny patch of
 * texture or colour. Callers that want a "match by colour/texture" fallback
 * (crop search) treat this as not-confident.
 */
export const MIN_CONFIDENT_SCORE = 0.22;

/**
 * Max per-channel pixel stddev (0-255) below which a crop is treated as a
 * near-solid colour patch: CLIP is blind to hue there, so crop search ranks by
 * average colour regardless of what category the (weak) CLIP signal suggests.
 */
export const FLAT_REGION_STD = 26;

/**
 * If fewer than this many embedded pins carry the query's category, the result
 * set will be thin. We log a warning and return what we have — we do NOT pad it
 * with other categories.
 */
export const MIN_CATEGORY_POOL = 8;

/** Dot product. CLIP embeddings are L2-normalised, so this equals cosine similarity. */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export interface Classification {
  category: VisualCategory;
  /** cosine margin between the winning category and the next-best category. */
  margin: number;
  /** best cosine score for the winning category. */
  score: number;
  /** margin too small to be sure which category, but the top one is still used. */
  lowConfidence: boolean;
  /**
   * The image clearly depicts this category: decent margin AND decent absolute
   * score. When false, a crop-search caller should skip category filtering and
   * fall back to pure colour/texture similarity.
   */
  confident: boolean;
  /** best score per category, highest first — handy for logging / debugging. */
  perCategory: { category: VisualCategory; score: number }[];
}

/**
 * Classify an image embedding into a VisualCategory by comparing it against
 * every prompt vector and taking the category of the best match.
 */
export function classifyEmbedding(
  embedding: number[],
  promptVectors: { category: VisualCategory; vector: number[] }[],
): Classification {
  const best = new Map<VisualCategory, number>();
  for (const pv of promptVectors) {
    const s = cosineSim(embedding, pv.vector);
    if (s > (best.get(pv.category) ?? -Infinity)) best.set(pv.category, s);
  }

  const perCategory = [...best.entries()]
    .map(([category, score]) => ({ category, score }))
    .sort((a, b) => b.score - a.score);

  const top = perCategory[0];
  const runnerUp = perCategory[1];
  const margin = runnerUp ? top.score - runnerUp.score : top.score;
  const lowConfidence = margin < LOW_CONFIDENCE_MARGIN;

  return {
    category: top.category,
    margin,
    score: top.score,
    lowConfidence,
    confident: !lowConfidence && top.score >= MIN_CONFIDENT_SCORE,
    perCategory,
  };
}
