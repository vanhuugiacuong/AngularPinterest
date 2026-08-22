import { Injectable, Logger } from '@nestjs/common';

// GIPHY's own published public beta test key — meant to be free for anyone
// to try without signing up. As of this writing GIPHY has revoked it
// (returns "BANNED"), so this only works once a real GIPHY_API_KEY is set
// in the environment. Kept as the documented fallback rather than silently
// failing with no key at all.
const PUBLIC_FALLBACK_KEY = 'dc6zaTOxFJmzC';

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
}

@Injectable()
export class GifService {
  private readonly logger = new Logger(GifService.name);

  private get apiKey(): string {
    return process.env.GIPHY_API_KEY || PUBLIC_FALLBACK_KEY;
  }

  async search(query: string, limit = 24): Promise<GifResult[]> {
    const trimmed = (query || '').trim();
    if (!trimmed) return this.trending(limit);
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${this.apiKey}&q=${encodeURIComponent(trimmed)}&limit=${limit}&rating=g`;
    return this.fetchGifs(url);
  }

  async trending(limit = 24): Promise<GifResult[]> {
    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${this.apiKey}&limit=${limit}&rating=g`;
    return this.fetchGifs(url);
  }

  private async fetchGifs(url: string): Promise<GifResult[]> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`GIPHY request failed with status ${response.status}`);
        return [];
      }
      const data = await response.json();
      const items = Array.isArray(data?.data) ? data.data : [];
      return items.map((gif: any) => ({
        id: gif.id,
        title: gif.title || '',
        previewUrl: gif.images?.fixed_width_small?.url || gif.images?.preview_gif?.url || gif.images?.fixed_width?.url,
        url: gif.images?.fixed_width?.url || gif.images?.original?.url,
      }));
    } catch (error) {
      this.logger.warn(`GIPHY request errored: ${(error as Error).message}`);
      return [];
    }
  }
}
