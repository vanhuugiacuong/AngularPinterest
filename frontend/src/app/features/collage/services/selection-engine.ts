import { InjectionToken } from '@angular/core';

/** RGBA pixel data at whatever resolution the engine actually operates on —
 * NOT necessarily the source photo's native resolution (see
 * RegionGrowingSelectionEngine, which works on a downscaled copy for speed
 * and lets the caller map the result back up). */
export interface SelectionEngineImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A single stroke's seed area, rasterized to a 0/255 mask at the same
 * width/height as the SelectionEngineImage it will be grown against. */
export interface SelectionSeed {
  mask: Uint8Array;
}

/** Abstraction over "how do we turn a rough brush seed into a real object
 * selection". The local, dependency-free implementation today is
 * RegionGrowingSelectionEngine (color + edge aware flood growth); this
 * interface exists so a future AI/ML segmentation backend can be swapped in
 * — through the same DI token — without touching the editor UI at all. */
export interface SelectionEngine {
  /** Grows the seed outward (color/edge aware) and unions the result into
   * currentMask. Does not mutate currentMask; returns a new mask. */
  addRegion(
    seed: SelectionSeed,
    image: SelectionEngineImage,
    currentMask: Uint8Array,
  ): Promise<Uint8Array>;

  /** Grows the seed the same way, then removes whatever it found from
   * currentMask. Does not mutate currentMask; returns a new mask. */
  subtractRegion(
    seed: SelectionSeed,
    image: SelectionEngineImage,
    currentMask: Uint8Array,
  ): Promise<Uint8Array>;
}

export const SELECTION_ENGINE = new InjectionToken<SelectionEngine>('SELECTION_ENGINE');

/** A mask paired with the resolution it was computed at — every
 * SmartCutEngine method takes/returns this instead of a bare Uint8Array so
 * callers never have to track width/height out of band. */
export interface SelectionMask {
  data: Uint8Array;
  width: number;
  height: number;
}

/** All coordinates on these hints are in the SAME pixel space as the
 * SelectionEngineImage they're passed alongside (whatever resolution the
 * caller happens to be operating at — working resolution during
 * interactive editing, full original resolution during edge refinement).
 * It's the caller's job to convert screen/canvas coordinates into that
 * space first (see coordinate-transformer.ts) — hints are never expressed
 * in screen space. */
export interface PointHint {
  type: 'point';
  x: number;
  y: number;
}

export interface BrushHint {
  type: 'brush';
  points: { x: number; y: number }[];
  radius: number;
}

export interface BoxHint {
  type: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SelectionHint = PointHint | BrushHint | BoxHint;

/** The higher-level "figure out what object the user means" abstraction —
 * distinct from SelectionEngine's addRegion/subtractRegion (which are
 * incremental edits against an already-established mask). detectTarget is
 * the entry point for a fresh click/brush/box hint with NO prior selection;
 * refineMask is a separate, one-shot pass meant to run once at
 * apply/preview time against a crop of the ORIGINAL (not working)
 * resolution image, snapping a coarse mask's boundary onto nearby strong
 * edges. Keeping this as its own interface — rather than folding it into
 * SelectionEngine — is what lets a future AI segmentation backend (SAM,
 * MobileSAM, a hosted model, ...) be wired in through the same DI token
 * without the interactive Add/Subtract editing path needing to change at
 * all: today's local RegionGrowingSelectionEngine implements both. */
export interface SmartCutEngine {
  detectTarget(image: SelectionEngineImage, hint: SelectionHint): Promise<SelectionMask>;
  refineMask(image: SelectionEngineImage, mask: SelectionMask): Promise<SelectionMask>;
}

export const SMART_CUT_ENGINE = new InjectionToken<SmartCutEngine>('SMART_CUT_ENGINE');

/** Converts a resolution-agnostic SelectionHint into a concrete 0/255 seed
 * mask at the given width/height. Hint coordinates are expected to already
 * be in that same pixel space (see SelectionHint's doc comment above).
 * Lives alongside the hint types themselves (rather than inside any one
 * engine implementation) since it's pure coordinate rasterization, not
 * detection logic — every SmartCutEngine implementation, local or AI-backed,
 * can reuse it to turn a UI-authored hint into a seed mask. */
export function rasterizeHint(hint: SelectionHint, width: number, height: number): Uint8Array {
  switch (hint.type) {
    case 'point':
      return rasterizePointHint(hint, width, height);
    case 'brush':
      return rasterizeBrushHint(hint, width, height);
    case 'box':
      return rasterizeBoxHint(hint, width, height);
  }
}

function rasterizePointHint(hint: PointHint, width: number, height: number): Uint8Array {
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  return rasterizeBrushHint({ type: 'brush', points: [{ x: hint.x, y: hint.y }], radius }, width, height);
}

function rasterizeBrushHint(hint: BrushHint, width: number, height: number): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const result = new Uint8Array(width * height);
  if (!ctx || !hint.points.length) return result;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = hint.radius * 2;

  let previous: { x: number; y: number } | null = null;
  for (const point of hint.points) {
    if (previous) {
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, hint.radius, 0, Math.PI * 2);
    ctx.fill();
    previous = point;
  }

  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 0; i < result.length; i++) result[i] = data[i * 4 + 3] > 0 ? 255 : 0;
  return result;
}

function rasterizeBoxHint(hint: BoxHint, width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height);
  const minX = Math.max(0, Math.round(hint.x));
  const minY = Math.max(0, Math.round(hint.y));
  const maxX = Math.min(width, Math.round(hint.x + hint.width));
  const maxY = Math.min(height, Math.round(hint.y + hint.height));
  for (let y = minY; y < maxY; y++) {
    const row = y * width;
    for (let x = minX; x < maxX; x++) result[row + x] = 255;
  }
  return result;
}
