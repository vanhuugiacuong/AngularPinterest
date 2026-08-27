import { Injectable } from '@angular/core';
import {
  rasterizeHint,
  SelectionEngine,
  SelectionEngineImage,
  SelectionHint,
  SelectionMask,
  SelectionSeed,
  SmartCutEngine,
} from './selection-engine';

const COLOR_TOLERANCE = 34; // Euclidean RGB distance a neighbor may differ from the seed's average color and still join the region.
const EDGE_STOP_THRESHOLD = 70; // Sobel gradient magnitude (0-255) at which growth refuses to cross — this is what keeps the region inside the object's silhouette.

// Fail-safe thresholds (see growRegionSafe): a stroke this small growing
// into a region this large is almost certainly the background bleeding
// through rather than an intentional selection of most of the photo.
const RUNAWAY_AREA_RATIO = 0.85;
const RUNAWAY_SEED_RATIO = 0.05;
const FALLBACK_DILATE_RADIUS = 6;

// refineMask's boundary-band search: how far past the coarse mask's own
// edge the full-resolution re-growth is allowed to explore.
const REFINE_ERODE_FRACTION = 0.01;
const REFINE_BAND_PX = 6;

/** Local, dependency-free stand-in for real object segmentation. Implements
 * BOTH editor-facing abstractions:
 *  - SelectionEngine (addRegion/subtractRegion): incremental edits against
 *    an already-established mask, used by the interactive Add/Subtract
 *    brush tool on every stroke, at working (downscaled) resolution.
 *  - SmartCutEngine (detectTarget/refineMask): detectTarget turns a fresh
 *    click/brush/box hint into a first mask with no prior selection;
 *    refineMask is a separate, one-shot pass meant to run once at
 *    apply/preview time against a crop of the ORIGINAL-resolution image,
 *    snapping a coarse (nearest-neighbor-upscaled) mask's boundary onto
 *    real high-resolution edges.
 *
 * The actual growing is an edge-aware region-growing flood fill: it
 * expands outward through 4-connected neighbors whose color is close to
 * the seed's average color, refusing to cross pixels where the image's own
 * edge strength (Sobel gradient magnitude) is high. This is intentionally
 * NOT a neural segmentation model — it has no notion of "this is a person"
 * — but it's a real, working implementation of the "edge-aware region
 * growing" fallback the feature spec explicitly allows, provided through
 * both interfaces precisely so an AI-backed implementation can be swapped
 * in later (through the same DI tokens) without touching the editor. */
@Injectable({ providedIn: 'root' })
export class RegionGrowingSelectionEngine implements SelectionEngine, SmartCutEngine {
  async addRegion(
    seed: SelectionSeed,
    image: SelectionEngineImage,
    currentMask: Uint8Array,
  ): Promise<Uint8Array> {
    const grown = this.growRegionSafe(seed.mask, image);
    const result = new Uint8Array(currentMask.length);
    for (let i = 0; i < result.length; i++) {
      result[i] = currentMask[i] || grown[i] ? 255 : 0;
    }
    return result;
  }

  async subtractRegion(
    seed: SelectionSeed,
    image: SelectionEngineImage,
    currentMask: Uint8Array,
  ): Promise<Uint8Array> {
    const grown = this.growRegionSafe(seed.mask, image);
    const result = new Uint8Array(currentMask.length);
    for (let i = 0; i < result.length; i++) {
      result[i] = currentMask[i] && !grown[i] ? 255 : 0;
    }
    return result;
  }

  async detectTarget(image: SelectionEngineImage, hint: SelectionHint): Promise<SelectionMask> {
    const seedMask = rasterizeHint(hint, image.width, image.height);
    const data = this.growRegionSafe(seedMask, image);
    return { data, width: image.width, height: image.height };
  }

  /** Re-evaluates a coarse mask's boundary against the FULL-resolution
   * image it's paired with. `mask` is expected to already be at `image`'s
   * resolution (the caller nearest-neighbor-upscales a working-resolution
   * result before calling this — see subject-selector's buildRegionCutout).
   *
   * Rather than a heuristic "nudge each boundary pixel toward the nearest
   * edge", this re-runs the same region-growing algorithm at full
   * resolution, seeded from a SAFELY-ERODED interior of the coarse mask
   * (so the seed is unambiguously inside the object, not sitting on the
   * blocky staircase a nearest-neighbor upscale produces) and constrained
   * to a band around the coarse boundary (so it can't run away across the
   * whole crop and stays fast). The real high-resolution color/edge data is
   * what lets it recover fine detail the coarse working resolution missed. */
  async refineMask(image: SelectionEngineImage, mask: SelectionMask): Promise<SelectionMask> {
    const { width, height } = image;
    // Capped regardless of crop resolution — a boundary-correction band only
    // needs to cover a few pixels of real anti-aliasing/detail either way;
    // letting it scale unbounded with a large crop (a big object cut from a
    // multi-megapixel photo) would turn every erode/dilate pass into tens of
    // millions of extra pixel ops for no accuracy benefit.
    const erodeRadius = Math.min(10, Math.max(1, Math.round(Math.min(width, height) * REFINE_ERODE_FRACTION)));
    const bandRadius = erodeRadius + REFINE_BAND_PX;

    const interior = erode(mask.data, width, height, erodeRadius);
    const allowed = dilate(mask.data, width, height, bandRadius);

    const grown = this.growRegion(interior, image, COLOR_TOLERANCE, allowed);
    const result = new Uint8Array(width * height);
    for (let i = 0; i < result.length; i++) result[i] = grown[i] || interior[i] ? 255 : 0;
    return { data: result, width, height };
  }

  /** Wraps growRegion with a sanity check against runaway growth (a tiny
   * seed suddenly claiming most of the image — almost always the
   * background bleeding through because two unrelated areas happened to
   * share a similar color) and two escalating fallbacks: retry once with
   * half the color tolerance, and if that's still runaway, give up on
   * "smart" and just return the seed itself modestly dilated. This is what
   * keeps a bad stroke from ever silently selecting "the whole photo". */
  private growRegionSafe(seedMask: Uint8Array, image: SelectionEngineImage): Uint8Array {
    const total = image.width * image.height;
    let seedCount = 0;
    for (let i = 0; i < seedMask.length; i++) if (seedMask[i]) seedCount++;
    if (!seedCount) return new Uint8Array(total);

    let result = this.growRegion(seedMask, image, COLOR_TOLERANCE);
    if (this.isRunaway(result, seedCount, total)) {
      result = this.growRegion(seedMask, image, COLOR_TOLERANCE / 2);
    }
    if (this.isRunaway(result, seedCount, total)) {
      result = dilate(seedMask, image.width, image.height, FALLBACK_DILATE_RADIUS);
    }
    return result;
  }

  private isRunaway(grown: Uint8Array, seedCount: number, total: number): boolean {
    let grownCount = 0;
    for (let i = 0; i < grown.length; i++) if (grown[i]) grownCount++;
    return grownCount > total * RUNAWAY_AREA_RATIO && seedCount < total * RUNAWAY_SEED_RATIO;
  }

  /** `allowed`, when given, additionally restricts growth to pixels where
   * allowed[idx] is truthy — used by refineMask to keep full-resolution
   * re-growth confined to a band around the coarse boundary. */
  private growRegion(
    seedMask: Uint8Array,
    image: SelectionEngineImage,
    tolerance: number,
    allowed: Uint8Array | null = null,
  ): Uint8Array {
    const { width, height, data } = image;
    const size = width * height;
    const edgeMap = this.computeEdgeMap(image);

    const seedIndices: number[] = [];
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (let i = 0; i < size; i++) {
      if (!seedMask[i]) continue;
      seedIndices.push(i);
      const p = i * 4;
      rSum += data[p];
      gSum += data[p + 1];
      bSum += data[p + 2];
    }
    const result = new Uint8Array(size);
    if (!seedIndices.length) return result;

    const n = seedIndices.length;
    const seedR = rSum / n;
    const seedG = gSum / n;
    const seedB = bSum / n;

    const visited = new Uint8Array(size);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;

    for (const idx of seedIndices) {
      if (visited[idx]) continue;
      visited[idx] = 1;
      result[idx] = 255;
      queue[tail++] = idx;
    }

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx / width) | 0;

      if (
        x > 0 &&
        this.visitNeighbor(idx - 1, seedR, seedG, seedB, tolerance, data, edgeMap, visited, result, allowed)
      ) {
        queue[tail++] = idx - 1;
      }
      if (
        x < width - 1 &&
        this.visitNeighbor(idx + 1, seedR, seedG, seedB, tolerance, data, edgeMap, visited, result, allowed)
      ) {
        queue[tail++] = idx + 1;
      }
      if (
        y > 0 &&
        this.visitNeighbor(idx - width, seedR, seedG, seedB, tolerance, data, edgeMap, visited, result, allowed)
      ) {
        queue[tail++] = idx - width;
      }
      if (
        y < height - 1 &&
        this.visitNeighbor(idx + width, seedR, seedG, seedB, tolerance, data, edgeMap, visited, result, allowed)
      ) {
        queue[tail++] = idx + width;
      }
    }

    return result;
  }

  /** Marks idx visited regardless of outcome (so the caller never re-queues
   * it) and returns whether it qualified to join the region — i.e. whether
   * the caller should push it onto the BFS queue. */
  private visitNeighbor(
    idx: number,
    seedR: number,
    seedG: number,
    seedB: number,
    tolerance: number,
    data: Uint8ClampedArray,
    edgeMap: Uint8Array,
    visited: Uint8Array,
    result: Uint8Array,
    allowed: Uint8Array | null,
  ): boolean {
    if (visited[idx]) return false;
    visited[idx] = 1;
    if (allowed && !allowed[idx]) return false;
    if (edgeMap[idx] >= EDGE_STOP_THRESHOLD) return false;

    const p = idx * 4;
    const dr = data[p] - seedR;
    const dg = data[p + 1] - seedG;
    const db = data[p + 2] - seedB;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance > tolerance) return false;

    result[idx] = 255;
    return true;
  }

  /** Sobel gradient magnitude on grayscale luminance, clamped to 0-255. */
  private computeEdgeMap(image: SelectionEngineImage): Uint8Array {
    const { width, height, data } = image;
    const size = width * height;
    const gray = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const p = i * 4;
      gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
    }

    const edge = new Uint8Array(size);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const tl = gray[i - width - 1];
        const t = gray[i - width];
        const tr = gray[i - width + 1];
        const l = gray[i - 1];
        const r = gray[i + 1];
        const bl = gray[i + width - 1];
        const b = gray[i + width];
        const br = gray[i + width + 1];

        const gx = tr + 2 * r + br - tl - 2 * l - bl;
        const gy = bl + 2 * b + br - tl - 2 * t - tr;
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edge[i] = magnitude > 255 ? 255 : magnitude;
      }
    }
    return edge;
  }
}


/** `radius` iterations of a 3x3 min filter (shrinks the selected region). */
function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = mask;
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!current[idx]) continue;
        let allOn = true;
        for (let dy = -1; dy <= 1 && allOn; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            allOn = false;
            break;
          }
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || !current[ny * width + nx]) {
              allOn = false;
              break;
            }
          }
        }
        next[idx] = allOn ? 255 : 0;
      }
    }
    current = next;
  }
  return current;
}

/** `radius` iterations of a 3x3 max filter (grows the selected region). */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = mask;
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx]) {
          next[idx] = 255;
          continue;
        }
        let anyOn = false;
        for (let dy = -1; dy <= 1 && !anyOn; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (current[ny * width + nx]) {
              anyOn = true;
              break;
            }
          }
        }
        next[idx] = anyOn ? 255 : 0;
      }
    }
    current = next;
  }
  return current;
}
