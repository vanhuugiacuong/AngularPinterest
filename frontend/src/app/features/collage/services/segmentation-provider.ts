import { InjectionToken } from '@angular/core';
import { SegmentationResult } from '../collage.types';

export type SegmentationProgress = (progress: number) => void;

export interface SegmentationPoint {
  x: number;
  y: number;
}

/** A single tap gives one keypoint; dragging a rough stroke over the object
 * gives a scribble (an ordered path of points) — both are hints the
 * segmentation model uses to figure out which object the user means. */
export type SegmentationHint = SegmentationPoint | SegmentationPoint[];

/** Extra spatial context beyond the raw hint, used to sanity-check the
 * model's answer against what the user actually indicated — the model
 * itself has no notion of "the user only circled a small area, so a
 * mask covering most of the photo is probably wrong". */
export interface SegmentationOptions {
  /** (lasso polygon area) / (full image area), 0-1. Lets the provider
   * reject a returned mask that's wildly larger than what the user circled
   * — see InteractiveSegmentationService's oversize guard. Omit if the
   * hint wasn't built from a closed lasso (e.g. a plain tap). */
  lassoAreaRatio?: number;
  /** The raw lasso outline itself, normalized (0-1) to the image. Lets the
   * provider confine its answer to the lasso's own footprint plus a margin
   * for natural protrusions (hair, a limb, a handle) — rather than the
   * unbounded confidence map the model returns on its own, which has no
   * notion of "don't include that OTHER object sitting right next to this
   * one". See InteractiveSegmentationService.constrainToLassoVicinity.
   * Omit for a plain tap (no polygon to constrain against). */
  lassoPolygon?: SegmentationPoint[];
}

export interface SegmentationProvider {
  selectObject(
    source: Blob,
    hint: SegmentationHint,
    onProgress?: SegmentationProgress,
    options?: SegmentationOptions,
  ): Promise<SegmentationResult>;
}

export const SEGMENTATION_PROVIDER = new InjectionToken<SegmentationProvider>(
  'SEGMENTATION_PROVIDER',
);

/** Thrown by a provider (instead of just returning a huge/wrong mask) when
 * it can tell its own answer is implausible relative to what the user
 * indicated — e.g. a lasso that circled a small area but got back a mask
 * covering most of the photo. The editor shows this as "Không thể xác định
 * chính xác vật thể — hãy khoanh lại rõ hơn" rather than silently accepting
 * a bad cutout. Part of the SegmentationProvider contract (not any one
 * implementation) so callers can catch it regardless of which provider is
 * wired in. */
export class UncertainSegmentationError extends Error {
  constructor(message = 'Không thể xác định chính xác vật thể trong vùng vừa khoanh.') {
    super(message);
    this.name = 'UncertainSegmentationError';
  }
}
