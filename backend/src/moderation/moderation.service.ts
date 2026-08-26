import { BadRequestException, Injectable } from '@nestjs/common';

// Shared team Sightengine credentials (free tier, 2000 ops/month), used
// whenever a machine's own .env doesn't set these — works out of the box
// for everyone, no per-machine setup needed. Anyone can override locally
// via SIGHTENGINE_API_USER/SECRET in their own .env.
const DEFAULT_API_USER = '5640108';
const DEFAULT_API_SECRET = 'LMcMCXjKvNigTEayZRbFbCftWs3xBAQM';
const NSFW_BLOCK_THRESHOLD = 0.5;
// Sightengine's nudity model is only verified for human content (see comment
// below). When our own animal detector flags the image, apply a stricter
// threshold as a hedge against the model being less reliable off its
// training distribution — better to over-flag a borderline animal photo
// than silently rely on an unverified score.
const NSFW_BLOCK_THRESHOLD_WITH_ANIMAL = 0.3;
const NSFW_BLOCK_MESSAGE = 'Ảnh chứa nội dung khỏa thân/gợi dục không phù hợp. Vui lòng chọn ảnh khác.';

// Gore/violence/disturbing imagery (blood, missing/exposed body parts, corpses...) —
// checked via Sightengine's gore-2.0 model in the same request as nudity-2.1.
const GORE_BLOCK_THRESHOLD = 0.5;
const GORE_BLOCK_MESSAGE = 'Ảnh chứa nội dung máu me/kinh dị không phù hợp. Vui lòng chọn ảnh khác.';

// No image-moderation vendor documents reliable coverage for sexual content
// involving animals (Sightengine and AWS Rekognition's own published label
// taxonomies are explicitly human-body-part scoped). As a text-based backstop,
// block when the title/description mentions an animal AND an explicit body
// part/act together — narrower than matching either list alone, to avoid
// false-positiving on ordinary pet photos or unrelated anatomy content.
const ANIMAL_WORDS = [
  'chó', 'mèo', 'ngựa', 'lợn', 'heo', 'dê', 'cừu', 'trâu', 'bò', 'thú cưng', 'động vật', 'con vật',
  'dog', 'cat', 'horse', 'pig', 'goat', 'sheep', 'cow', 'pet', 'animal', 'beast',
];
const EXPLICIT_WORDS = [
  'bộ phận sinh dục', 'dương vật', 'âm đạo', 'khỏa thân', 'giao cấu', 'quan hệ tình dục',
  'genital', 'penis', 'vagina', 'nude', 'naked', 'sex', 'porn', 'bestiality',
];
const EXPLICIT_TEXT_BLOCK_MESSAGE = 'Nội dung mô tả có thể vi phạm quy định. Vui lòng chỉnh sửa lại tiêu đề/mô tả.';

/** Blocks NSFW/nudity/overly-suggestive images via the Sightengine
 * moderation API — a hosted service, so this works the same regardless of
 * who's running the backend or where, no local model/service needed.
 * Fails open (logs a warning, lets the image through) if the API is
 * unreachable or the free quota is exhausted, rather than blocking the
 * whole upload/send flow on a best-effort safety check. */
@Injectable()
export class ModerationService {
  private readonly apiUser = process.env.SIGHTENGINE_API_USER || DEFAULT_API_USER;
  private readonly apiSecret = process.env.SIGHTENGINE_API_SECRET || DEFAULT_API_SECRET;
  private readonly clipServiceUrl = process.env.CLIP_SERVICE_URL || 'http://localhost:8001';

  async checkImageIsSafe(buffer: Buffer, filename: string, mimetype: string): Promise<void> {
    try {
      const [scores, hasAnimal] = await Promise.all([
        this.getModerationScores(buffer, filename, mimetype),
        this.detectAnimal(buffer, filename, mimetype),
      ]);
      if (!scores) return;

      const { nudity, gore } = scores;

      if (nudity) {
        // Deliberately excludes Sightengine's "very_suggestive"/"suggestive" categories —
        // those also fire on ordinary swimwear/bikini photos with covered body parts,
        // which should be allowed. Only the categories that mean actual exposed nudity
        // or explicit sexual content block the upload.
        const threshold = hasAnimal ? NSFW_BLOCK_THRESHOLD_WITH_ANIMAL : NSFW_BLOCK_THRESHOLD;
        const isNsfw =
          nudity.sexual_activity >= threshold ||
          nudity.sexual_display >= threshold ||
          nudity.erotica >= threshold;

        if (isNsfw) {
          throw new BadRequestException(NSFW_BLOCK_MESSAGE);
        }
      }

      if (gore && gore.prob >= GORE_BLOCK_THRESHOLD) {
        throw new BadRequestException(GORE_BLOCK_MESSAGE);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Image moderation network error:', error);
    }
  }

  private async getModerationScores(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<{ nudity: Record<string, number> | null; gore: { prob: number; classes?: Record<string, number> } | null } | null> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
    formData.append('media', blob, filename);
    formData.append('models', 'nudity-2.1,gore-2.0');
    formData.append('api_user', this.apiUser);
    formData.append('api_secret', this.apiSecret);

    const response = await fetch('https://api.sightengine.com/1.0/check.json', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      console.error(`Image moderation check failed: ${response.statusText}`);
      return null;
    }

    const result = await response.json();
    if (result.status !== 'success') {
      console.error('Image moderation request unsuccessful:', result);
      return null;
    }

    return { nudity: result.nudity || null, gore: result.gore || null };
  }

  /** Best-effort zero-shot animal detection via clip-service — see
   * /detect/animal in main.py. Fails open to "no animal" (the normal,
   * already-verified threshold) if that optional local service isn't
   * running, same as getImageEmbedding() elsewhere treats it. */
  private async detectAnimal(buffer: Buffer, filename: string, mimetype: string): Promise<boolean> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
      formData.append('file', blob, filename);

      const response = await fetch(`${this.clipServiceUrl}/detect/animal`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) return false;

      const result = await response.json();
      return !!result.hasAnimal;
    } catch (error) {
      console.error('Animal detection network error:', error);
      return false;
    }
  }

  /** Text-only backstop for a category no image-moderation vendor documents
   * support for (see comment above ANIMAL_WORDS). Blocks synchronously,
   * no external call — cheap enough to run on every title/description.
   *
   * Matches whole words only (via tokenizing, not substring search) — a
   * naive `.includes('cat')` would also match inside "category", "vacation",
   * "education" and silently block completely ordinary captions. Multi-word
   * Vietnamese phrases (already naturally space-bounded) are still matched
   * as substrings of the full text. */
  checkTextIsSafe(...texts: (string | null | undefined)[]): void {
    const combined = texts.filter(Boolean).join(' ');
    if (!combined.trim()) return;

    const lower = combined.toLowerCase();
    const tokens = new Set(lower.match(/[\p{L}\p{N}]+/gu) ?? []);
    const matches = (word: string) => (word.includes(' ') ? lower.includes(word) : tokens.has(word));

    const hasAnimalWord = ANIMAL_WORDS.some(matches);
    const hasExplicitWord = EXPLICIT_WORDS.some(matches);

    if (hasAnimalWord && hasExplicitWord) {
      throw new BadRequestException(EXPLICIT_TEXT_BLOCK_MESSAGE);
    }
  }
}
