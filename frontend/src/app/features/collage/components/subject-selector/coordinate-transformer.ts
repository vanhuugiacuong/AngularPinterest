export interface CanvasPoint {
  x: number;
  y: number;
}

/** Maps a screen-space point (event.clientX/clientY) down to backing-pixel
 * coordinates on a canvas that's displayed with object-fit: contain — the
 * one conversion every brush/paint/selection interaction in this editor
 * depends on to stay correct regardless of how the canvas is CURRENTLY
 * being displayed on screen.
 *
 * getBoundingClientRect() always returns the element's actual on-screen box
 * — whatever produced that box (plain CSS width/height, a `transform:
 * scale()` zoom, a translate() pan, a responsive resize) is irrelevant here,
 * because this function only ever reads the final rendered rect and the
 * canvas's own backing width/height. That's what makes it zoom/pan-safe
 * "for free": as long as the caller applies zoom/pan via CSS transforms on
 * an ancestor (rather than mutating canvasWidth/canvasHeight), this math
 * doesn't need to know zoom/pan happened at all.
 *
 * Within that box, object-fit: contain letterboxes the content whenever the
 * box's aspect ratio doesn't match the canvas's own width/height ratio —
 * this reproduces contain's own fit math to find the actual rendered
 * content rectangle first, so a point in the letterbox bars clamps to the
 * nearest edge instead of mapping onto the wrong part of the image. */
export function screenPointToCanvasPixel(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint | null {
  if (!canvasRect.width || !canvasRect.height || !canvasWidth || !canvasHeight) return null;

  const boxAspect = canvasRect.width / canvasRect.height;
  const contentAspect = canvasWidth / canvasHeight;
  let contentWidth = canvasRect.width;
  let contentHeight = canvasRect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (contentAspect > boxAspect) {
    contentHeight = canvasRect.width / contentAspect;
    offsetY = (canvasRect.height - contentHeight) / 2;
  } else {
    contentWidth = canvasRect.height * contentAspect;
    offsetX = (canvasRect.width - contentWidth) / 2;
  }

  const nx = Math.max(0, Math.min(1, (clientX - canvasRect.left - offsetX) / contentWidth));
  const ny = Math.max(0, Math.min(1, (clientY - canvasRect.top - offsetY) / contentHeight));
  return { x: nx * canvasWidth, y: ny * canvasHeight };
}

/** Named alias of screenPointToCanvasPixel — Screen Space → Canvas/Working
 * Image Space. Kept as a separate export (rather than renaming the
 * original, which every existing call site already uses) so the four
 * coordinate systems this editor deals with — Screen, Canvas, Working
 * Image, Original Image — each have an unambiguously-named conversion
 * function, matching how the rest of the Smart Cut pipeline talks about
 * them. */
export const screenToImage = screenPointToCanvasPixel;

/** Canvas/Working Image Space → screen space — the inverse of
 * screenToImage, for the rare case something needs to place a screen-space
 * overlay at a working-space point (e.g. a debug marker). Not currently
 * used by the editor's hot paths (which only ever need screen → image), but
 * kept alongside its inverse so the coordinate-space boundary stays
 * explicit and testable on both sides. */
export function imageToScreen(
  point: CanvasPoint,
  canvasRect: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint | null {
  if (!canvasRect.width || !canvasRect.height || !canvasWidth || !canvasHeight) return null;

  const boxAspect = canvasRect.width / canvasRect.height;
  const contentAspect = canvasWidth / canvasHeight;
  let contentWidth = canvasRect.width;
  let contentHeight = canvasRect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (contentAspect > boxAspect) {
    contentHeight = canvasRect.width / contentAspect;
    offsetY = (canvasRect.height - contentHeight) / 2;
  } else {
    contentWidth = canvasRect.height * contentAspect;
    offsetX = (canvasRect.width - contentWidth) / 2;
  }

  return {
    x: canvasRect.left + offsetX + (point.x / canvasWidth) * contentWidth,
    y: canvasRect.top + offsetY + (point.y / canvasHeight) * contentHeight,
  };
}

/** Working Image Space → Original Image Space — a plain per-axis scale.
 * Working resolution exists purely so detection/segmentation algorithms run
 * fast; every pixel coordinate it produces (seed points, mask bounds, ...)
 * has to be mapped back through this before it means anything against the
 * actual source photo. */
export function workingToOriginal(
  point: CanvasPoint,
  workingWidth: number,
  workingHeight: number,
  originalWidth: number,
  originalHeight: number,
): CanvasPoint {
  return {
    x: (point.x / workingWidth) * originalWidth,
    y: (point.y / workingHeight) * originalHeight,
  };
}

/** Original Image Space → Working Image Space — the inverse of
 * workingToOriginal, for converting a point already known in original-image
 * pixels (e.g. from a hint built in screen space and passed through
 * screenToImage against the full-resolution canvas) down to working space. */
export function originalToWorking(
  point: CanvasPoint,
  originalWidth: number,
  originalHeight: number,
  workingWidth: number,
  workingHeight: number,
): CanvasPoint {
  return {
    x: (point.x / originalWidth) * workingWidth,
    y: (point.y / originalHeight) * workingHeight,
  };
}
