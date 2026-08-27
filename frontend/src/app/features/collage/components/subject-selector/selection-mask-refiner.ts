/** Post-processing passes applied to a raw region-growing result before it
 * becomes the editor's actual selection mask. Each pass is a pure function
 * over a flat 0/255 Uint8Array — none of them know about canvases, DOM, or
 * the rest of the editor, so they're easy to reason about and to swap out
 * individually if the growing algorithm's rough edges change shape later. */

/** 4-connected flood fill labeling, shared by removeSmallIslands and
 * fillSmallHoles below. */
function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  wantValue: number,
): { labels: Int32Array; sizes: number[]; touchesBorder: boolean[] } {
  const size = width * height;
  const labels = new Int32Array(size).fill(-1);
  const sizes: number[] = [];
  const touchesBorder: boolean[] = [];
  const queue = new Int32Array(size);

  for (let start = 0; start < size; start++) {
    if (mask[start] !== wantValue || labels[start] !== -1) continue;

    const label = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let count = 0;
    let onBorder = false;

    while (head < tail) {
      const idx = queue[head++];
      count++;
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) onBorder = true;

      if (x > 0 && mask[idx - 1] === wantValue && labels[idx - 1] === -1) {
        labels[idx - 1] = label;
        queue[tail++] = idx - 1;
      }
      if (x < width - 1 && mask[idx + 1] === wantValue && labels[idx + 1] === -1) {
        labels[idx + 1] = label;
        queue[tail++] = idx + 1;
      }
      if (y > 0 && mask[idx - width] === wantValue && labels[idx - width] === -1) {
        labels[idx - width] = label;
        queue[tail++] = idx - width;
      }
      if (y < height - 1 && mask[idx + width] === wantValue && labels[idx + width] === -1) {
        labels[idx + width] = label;
        queue[tail++] = idx + width;
      }
    }

    sizes.push(count);
    touchesBorder.push(onBorder);
  }

  return { labels, sizes, touchesBorder };
}

/** Drops selected specks smaller than minSize pixels — the region-growing
 * pass can leave a scatter of tiny disconnected blobs where color/edge
 * conditions happened to line up briefly; these read as noise, not
 * intentional selection. */
export function removeSmallIslands(
  mask: Uint8Array,
  width: number,
  height: number,
  minSize: number,
): Uint8Array {
  const { labels, sizes } = connectedComponents(mask, width, height, 255);
  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const label = labels[i];
    if (label !== -1 && sizes[label] >= minSize) result[i] = 255;
  }
  return result;
}

/** Fills small unselected pockets fully enclosed by the selection (e.g. a
 * gap where a belt buckle's color/edges briefly broke the growth) — but
 * never a background component that reaches the image border, since that's
 * legitimately outside the subject, not a hole in it. */
export function fillSmallHoles(
  mask: Uint8Array,
  width: number,
  height: number,
  maxHoleSize: number,
): Uint8Array {
  const { labels, sizes, touchesBorder } = connectedComponents(mask, width, height, 0);
  const result = mask.slice();
  for (let i = 0; i < mask.length; i++) {
    const label = labels[i];
    if (label === -1) continue;
    if (!touchesBorder[label] && sizes[label] <= maxHoleSize) result[i] = 255;
  }
  return result;
}

/** One majority-vote pass over each pixel's 3x3 neighborhood — cheap
 * morphological smoothing that knocks down jagged single-pixel steps along
 * the boundary without the aggressive rounding a real open/close with a
 * large structuring element would cause. */
export function smoothEdges(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let on = 0;
      let total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          total++;
          if (mask[ny * width + nx] === 255) on++;
        }
      }
      result[idx] = on * 2 >= total ? 255 : 0;
    }
  }
  return result;
}

/** Runs the standard cleanup pipeline: drop noise, fill pinholes, smooth.
 * (Named distinctly from SmartCutEngine.refineMask — that one does full-
 * resolution edge-snapping against the original photo; this one is cheap
 * morphological tidying run at working resolution after every stroke.) */
export function cleanupMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const minIslandSize = Math.max(8, Math.round(width * height * 0.0006));
  const maxHoleSize = Math.max(8, Math.round(width * height * 0.001));
  let result = removeSmallIslands(mask, width, height, minIslandSize);
  result = fillSmallHoles(result, width, height, maxHoleSize);
  result = smoothEdges(result, width, height);
  return result;
}

/** Tight bounding box of the selected (255) pixels, or null if the mask is
 * empty. The one place bounds get computed from — never the other way
 * around (crop-first-then-detect would silently throw away context the
 * growing/refinement algorithms need). */
export function maskBounds(
  mask: Uint8Array,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX || maxY < minY ? null : { minX, minY, maxX, maxY };
}

/** Nearest-neighbor resample of a (small, working-resolution) mask into an
 * arbitrary destination rectangle at a different resolution — e.g. a crop
 * of the original photo around the selection's bounding box. Deliberately
 * NOT bilinear: smooth-interpolating a binary mask produces a blurry 0-255
 * gradient band that reads as a soft/fuzzy cutout edge regardless of how
 * sharp the actual object boundary is. Nearest-neighbor keeps the boundary
 * a crisp step, which is what the subsequent edge-snap refinement pass
 * needs to work with (a blurry input has no well-defined edge to snap). */
export function upscaleMaskNearest(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  destOffsetX: number,
  destOffsetY: number,
  destWidth: number,
  destHeight: number,
  scaleX: number,
  scaleY: number,
): Uint8Array {
  const result = new Uint8Array(destWidth * destHeight);
  for (let dy = 0; dy < destHeight; dy++) {
    const sy = Math.min(sourceHeight - 1, Math.max(0, Math.floor((destOffsetY + dy) / scaleY)));
    const sRow = sy * sourceWidth;
    const dRow = dy * destWidth;
    for (let dx = 0; dx < destWidth; dx++) {
      const sx = Math.min(sourceWidth - 1, Math.max(0, Math.floor((destOffsetX + dx) / scaleX)));
      result[dRow + dx] = source[sRow + sx];
    }
  }
  return result;
}

/** Softens the binary mask into a 0-255 alpha ramp ~1-2px wide at the given
 * resolution, for the FINAL exported cutout only — a light box blur
 * followed by re-clamping, not applied to the interactive selection mask
 * itself (which stays binary so re-editing/undo stay exact). */
export function featherMask(mask: Uint8Array, width: number, height: number, radiusPx = 1): Uint8Array {
  if (radiusPx <= 0) return mask;
  const result = new Float32Array(mask.length);
  const radius = Math.max(1, Math.round(radiusPx));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += mask[ny * width + nx];
          count++;
        }
      }
      result[y * width + x] = count > 0 ? sum / count : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(result[i])));
  return out;
}
