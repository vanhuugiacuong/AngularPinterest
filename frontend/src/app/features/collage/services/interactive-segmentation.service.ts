import { Injectable } from '@angular/core';
import type { InteractiveSegmenter, RegionOfInterest } from '@mediapipe/tasks-vision';
import { SegmentationResult } from '../collage.types';
import {
  SegmentationHint,
  SegmentationOptions,
  SegmentationProgress,
  SegmentationProvider,
  UncertainSegmentationError,
} from './segmentation-provider';

const INFERENCE_MAX_EDGE = 1280;
const OUTPUT_MAX_EDGE = 2560;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';
const FALLBACK_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

// Confidence level at which a pixel counts as "foreground" for CONNECTIVITY
// analysis only (see keepComponentAtSeed) — the actual exported alpha stays
// the model's raw continuous confidence (0-255), never hard-thresholded, so
// soft edges (hair, fur, motion blur) keep their anti-aliasing. This value
// only decides which pixels are solid enough to trust when tracing out
// "which blob is the seed point actually part of".
const CONNECTIVITY_THRESHOLD = 0.5;

// Oversize guard thresholds (see keepComponentAtSeed) — deliberately
// relative to what the user circled, not an absolute pixel/percentage
// value, so a large lasso around a genuinely large subject is never
// penalized (see MASK_TO_IMAGE_MIN below staying gated behind a SMALL
// lasso specifically).
const MASK_TO_IMAGE_SUSPICIOUS = 0.6; // the kept mask covers most of the photo...
const LASSO_TO_IMAGE_SMALL = 0.25; // ...while the user's lasso covered only a small part of it...
const MASK_TO_LASSO_SUSPICIOUS = 6; // ...and the mask is many times larger than that lasso.

// How far past the lasso's own bounding box (as a fraction of that box's
// width/height, per side) the model is allowed to extend the mask — enough
// room for natural protrusions (hair, an outstretched arm, a handle) that a
// loosely-drawn lasso didn't quite enclose, but not so much that a SEPARATE
// object sitting nearby (a lipstick next to a makeup brush, say) falls
// inside the allowed zone too.
const LASSO_VICINITY_MARGIN = 0.4;

interface SegmentationMask {
  width: number;
  height: number;
  values: Float32Array;
}

@Injectable({ providedIn: 'root' })
export class InteractiveSegmentationService implements SegmentationProvider {
  private segmenterPromise?: Promise<InteractiveSegmenter>;

  async selectObject(
    source: Blob,
    hint: SegmentationHint,
    onProgress: SegmentationProgress = () => undefined,
    options: SegmentationOptions = {},
  ): Promise<SegmentationResult> {
    onProgress(0.03);
    const segmenter = await this.getSegmenter();
    onProgress(0.42);

    const sourceBitmap = await createImageBitmap(source);
    try {
      const outputSize = this.fitInside(sourceBitmap.width, sourceBitmap.height, OUTPUT_MAX_EDGE);
      const inferenceSize = this.fitInside(outputSize.width, outputSize.height, INFERENCE_MAX_EDGE);
      const inputCanvas = this.createResizedCanvas(
        sourceBitmap,
        inferenceSize.width,
        inferenceSize.height,
      );
      onProgress(0.55);

      // Cho Angular một frame để vẽ loading trước khi MediaPipe bắt đầu suy luận.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const mask = this.runSegmentation(segmenter, inputCanvas, hint);
      onProgress(0.65);

      // The model returns ONE soft confidence map for the whole image — it
      // has no idea the user meant one specific object, so it can (and in
      // practice does) light up a neighboring object that touches or sits
      // very close to the seed point, or occasionally most of the frame.
      // Two real, independent post-processing passes on that raw output:
      //  1. constrainToLassoVicinity — zero out anything far outside the
      //     lasso's own footprint FIRST, so a nearby unrelated object never
      //     even reaches the connectivity step below.
      //  2. keepComponentAtSeed — of what's left, keep only the connected
      //     blob the seed point actually landed in, and refuse the result
      //     outright if it's still implausibly large for the lasso given.
      this.constrainToLassoVicinity(mask, options.lassoPolygon);
      onProgress(0.7);
      const seedPoint = this.hintToSeedPoint(hint);
      this.keepComponentAtSeed(mask, seedPoint, options.lassoAreaRatio);
      onProgress(0.82);

      const blob = await this.applyMask(sourceBitmap, outputSize.width, outputSize.height, mask);
      onProgress(1);
      return { blob, width: outputSize.width, height: outputSize.height };
    } finally {
      sourceBitmap.close();
    }
  }

  /** The pixel the user actually pointed at — for a scribble, its first
   * point (where the stroke started) is as good a "the object is here"
   * anchor as any other point on the path. Coordinates are normalized
   * (0-1), matching both the hint format and NormalizedKeypoint. */
  private hintToSeedPoint(hint: SegmentationHint): { x: number; y: number } {
    return Array.isArray(hint) ? hint[0] : hint;
  }

  private getSegmenter(): Promise<InteractiveSegmenter> {
    this.segmenterPromise ??= this.createSegmenterWithFallback().catch((error) => {
      this.segmenterPromise = undefined;
      throw error;
    });
    return this.segmenterPromise;
  }

  private async createSegmenterWithFallback(): Promise<InteractiveSegmenter> {
    const localWasmUrl = new URL('assets/mediapipe/wasm', document.baseURI).href.replace(/\/$/, '');
    try {
      return await this.createSegmenter(localWasmUrl);
    } catch (localAssetError) {
      console.warn(
        'Unable to load local MediaPipe assets, using the CDN fallback.',
        localAssetError,
      );
      return this.createSegmenter(FALLBACK_WASM_URL);
    }
  }

  private async createSegmenter(wasmBaseUrl: string): Promise<InteractiveSegmenter> {
    const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
    return InteractiveSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL },
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }

  /** A single tap resolves to a keypoint ROI; a dragged stroke resolves to a
   * scribble ROI — MediaPipe uses the scribble's whole path (not just its
   * endpoints) to infer which object the user traced over, which is more
   * robust than a keypoint for elongated or oddly-shaped subjects. */
  private runSegmentation(
    segmenter: InteractiveSegmenter,
    image: HTMLCanvasElement,
    hint: SegmentationHint,
  ): SegmentationMask {
    const roi: RegionOfInterest = Array.isArray(hint)
      ? hint.length > 1
        ? { scribble: hint }
        : { keypoint: hint[0] }
      : { keypoint: hint };
    const result = segmenter.segment(image, roi);
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error('Mô hình không trả về vùng vật thể.');
      return {
        width: mask.width,
        height: mask.height,
        values: mask.getAsFloat32Array().slice(),
      };
    } finally {
      result.close();
    }
  }

  /** Mutates `mask.values` in place: zeroes out every pixel outside the
   * lasso's own bounding box, padded by LASSO_VICINITY_MARGIN per side.
   * This is the fix for the case connectivity-filtering alone can't catch —
   * two objects placed close enough together (or touching) that the
   * model's confidence map merges them into a SINGLE connected blob, with
   * no disconnection for keepComponentAtSeed to exploit. A padded bounding
   * box is a coarse approximation of "near the lasso" (not a precise
   * distance-from-polygon field — that would cost a real distance
   * transform for comparatively little benefit here), but it's cheap
   * (one pass over the mask) and directly encodes the spec's actual rule:
   * lasso = intent, AI mask = final boundary, but the boundary shouldn't
   * wander into what's clearly a different object sitting outside that
   * intent's neighborhood. No-ops when no lasso polygon was supplied
   * (a plain tap has no "vicinity" to speak of). */
  private constrainToLassoVicinity(
    mask: SegmentationMask,
    lassoPolygon?: { x: number; y: number }[],
  ): void {
    if (!lassoPolygon || lassoPolygon.length < 3) return;
    const { width, height, values } = mask;

    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const point of lassoPolygon) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const marginX = Math.max(0, maxX - minX) * LASSO_VICINITY_MARGIN;
    const marginY = Math.max(0, maxY - minY) * LASSO_VICINITY_MARGIN;

    const allowedMinX = Math.max(0, Math.round((minX - marginX) * width));
    const allowedMinY = Math.max(0, Math.round((minY - marginY) * height));
    const allowedMaxX = Math.min(width, Math.round((maxX + marginX) * width));
    const allowedMaxY = Math.min(height, Math.round((maxY + marginY) * height));

    for (let y = 0; y < height; y++) {
      const row = y * width;
      if (y < allowedMinY || y >= allowedMaxY) {
        for (let x = 0; x < width; x++) values[row + x] = 0;
        continue;
      }
      for (let x = 0; x < allowedMinX; x++) values[row + x] = 0;
      for (let x = allowedMaxX; x < width; x++) values[row + x] = 0;
    }
  }

  /** Mutates `mask.values` in place: zeroes out every pixel that isn't part
   * of the connected blob the seed point landed in (4-connected flood fill
   * over pixels at/above CONNECTIVITY_THRESHOLD confidence — the ONLY use
   * of a hard threshold anywhere in this pipeline, and only for deciding
   * connectivity, never for the exported alpha itself).
   *
   * If the seed pixel itself isn't confidently foreground (a slightly
   * off-target click near an edge), it searches outward in rings for the
   * nearest confident pixel and uses that pixel's component instead —
   * closer to "what did the user mean" than silently returning nothing.
   *
   * Then, if a lasso area ratio was supplied, rejects the result outright
   * (throws UncertainSegmentationError) when the kept component is
   * implausibly large relative to what the user actually circled — see the
   * MASK_TO_IMAGE_SUSPICIOUS/LASSO_TO_IMAGE_SMALL/MASK_TO_LASSO_SUSPICIOUS
   * constants for the exact rule. This is what stops "small lasso → the
   * model got confused and lit up half the photo" from silently producing
   * a huge, wrong cutout instead of an honest "try again". */
  private keepComponentAtSeed(
    mask: SegmentationMask,
    seedPoint: { x: number; y: number },
    lassoAreaRatio?: number,
  ): void {
    const { width, height, values } = mask;
    const size = width * height;
    const foreground = new Uint8Array(size);
    for (let i = 0; i < size; i++) foreground[i] = values[i] >= CONNECTIVITY_THRESHOLD ? 1 : 0;

    const seedX = Math.min(width - 1, Math.max(0, Math.round(seedPoint.x * width)));
    const seedY = Math.min(height - 1, Math.max(0, Math.round(seedPoint.y * height)));
    const seedIndex = this.findNearestForeground(foreground, width, height, seedX, seedY);
    if (seedIndex === -1) {
      // No confident foreground anywhere near the seed at all — nothing to
      // keep; applyMask's own "found (almost) nothing" check will catch
      // this and report it the same way a truly empty result would.
      values.fill(0);
      return;
    }

    const visited = new Uint8Array(size);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    visited[seedIndex] = 1;
    queue[tail++] = seedIndex;
    let componentSize = 0;

    while (head < tail) {
      const idx = queue[head++];
      componentSize++;
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x > 0 && !visited[idx - 1] && foreground[idx - 1]) {
        visited[idx - 1] = 1;
        queue[tail++] = idx - 1;
      }
      if (x < width - 1 && !visited[idx + 1] && foreground[idx + 1]) {
        visited[idx + 1] = 1;
        queue[tail++] = idx + 1;
      }
      if (y > 0 && !visited[idx - width] && foreground[idx - width]) {
        visited[idx - width] = 1;
        queue[tail++] = idx - width;
      }
      if (y < height - 1 && !visited[idx + width] && foreground[idx + width]) {
        visited[idx + width] = 1;
        queue[tail++] = idx + width;
      }
    }

    for (let i = 0; i < size; i++) {
      if (!visited[i]) values[i] = 0;
    }

    if (lassoAreaRatio === undefined) return;
    const maskAreaRatio = componentSize / size;
    const isSuspicious =
      maskAreaRatio > MASK_TO_IMAGE_SUSPICIOUS &&
      lassoAreaRatio < LASSO_TO_IMAGE_SMALL &&
      maskAreaRatio / Math.max(lassoAreaRatio, 0.0001) > MASK_TO_LASSO_SUSPICIOUS;
    if (isSuspicious) throw new UncertainSegmentationError();
  }

  /** Expanding 3x3, 5x5, 7x7... search rings outward from (seedX, seedY)
   * until a foreground pixel is found, capped at a modest radius so a
   * genuinely empty result still fails fast instead of scanning the whole
   * mask pixel by pixel. */
  private findNearestForeground(
    foreground: Uint8Array,
    width: number,
    height: number,
    seedX: number,
    seedY: number,
  ): number {
    const maxRadius = Math.max(4, Math.round(Math.min(width, height) * 0.05));
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const y = seedY + dy;
        if (y < 0 || y >= height) continue;
        const onVerticalEdge = Math.abs(dy) === radius;
        const step = onVerticalEdge ? 1 : radius * 2 || 1;
        for (let dx = -radius; dx <= radius; dx += step) {
          const x = seedX + dx;
          if (x < 0 || x >= width) continue;
          const idx = y * width + x;
          if (foreground[idx]) return idx;
        }
      }
    }
    return -1;
  }

  private async applyMask(
    source: ImageBitmap,
    outputWidth: number,
    outputHeight: number,
    mask: SegmentationMask,
  ): Promise<Blob> {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
    const maskContext = maskCanvas.getContext('2d');
    if (!maskContext) throw new Error('Trình duyệt không hỗ trợ xử lý mặt nạ ảnh.');

    const imageData = maskContext.createImageData(mask.width, mask.height);
    let visiblePixels = 0;
    for (let index = 0; index < mask.values.length; index++) {
      const confidence = Math.max(0, Math.min(1, mask.values[index] ?? 0));
      const alpha = Math.round(confidence * 255);
      const pixel = index * 4;
      imageData.data[pixel] = 255;
      imageData.data[pixel + 1] = 255;
      imageData.data[pixel + 2] = 255;
      imageData.data[pixel + 3] = alpha;
      if (confidence >= 0.5) visiblePixels++;
    }
    if (visiblePixels / mask.values.length < 0.001) {
      throw new Error('Không tìm thấy vật thể rõ ràng tại vị trí bạn vừa nhấn.');
    }
    maskContext.putImageData(imageData, 0, 0);

    const output = document.createElement('canvas');
    output.width = outputWidth;
    output.height = outputHeight;
    const outputContext = output.getContext('2d', { alpha: true });
    if (!outputContext) throw new Error('Trình duyệt không hỗ trợ ảnh nền trong suốt.');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(source, 0, 0, outputWidth, outputHeight);
    outputContext.globalCompositeOperation = 'destination-in';
    outputContext.drawImage(maskCanvas, 0, 0, outputWidth, outputHeight);
    outputContext.globalCompositeOperation = 'source-over';
    return this.canvasToBlob(output);
  }

  private createResizedCanvas(
    source: ImageBitmap,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý Canvas 2D.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  private fitInside(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Không thể tạo ảnh PNG.'))),
        'image/png',
        1,
      );
    });
  }
}
