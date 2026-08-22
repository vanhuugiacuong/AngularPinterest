/** Crop-region math shared by the pin-detail "Tìm kiếm hình ảnh" tool.
 * Deliberately standalone (no imports from the collage/image-editor
 * features) so pin-detail doesn't end up coupled to unrelated editor code —
 * the coordinate math is the same idea, re-derived here on purpose. */

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fraction (0-1) rect relative to the *visible* image content — i.e.
 * relative to the rect returned by computeContainedRect, not the element's
 * own CSS box. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Given an element's CSS box (containerWidth/Height) and an image rendered
 * inside it with `object-fit: contain`, returns the sub-rect (in the same
 * px units, relative to the container's top-left) that the image content
 * actually occupies — excluding any letterbox gutters. */
export function computeContainedRect(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): PixelRect {
  if (!containerWidth || !containerHeight || !naturalWidth || !naturalHeight) {
    return { x: 0, y: 0, width: containerWidth || 0, height: containerHeight || 0 };
  }
  const containerRatio = containerWidth / containerHeight;
  const imageRatio = naturalWidth / naturalHeight;

  if (imageRatio > containerRatio) {
    // Image is relatively wider than the box — full width, letterboxed top/bottom.
    const width = containerWidth;
    const height = width / imageRatio;
    return { x: 0, y: (containerHeight - height) / 2, width, height };
  }
  // Image is relatively taller than the box — full height, letterboxed left/right.
  const height = containerHeight;
  const width = height * imageRatio;
  return { x: (containerWidth - width) / 2, y: 0, width, height };
}

/** Keeps a normalized selection rect fully inside [0,1] on both axes (i.e.
 * fully inside the real image, never in a letterbox gutter) and above a
 * minimum size so it can never collapse to a degenerate crop. */
export function clampNormalizedRect(rect: NormalizedRect, minSize = 0.05): NormalizedRect {
  const width = Math.min(1, Math.max(minSize, rect.width));
  const height = Math.min(1, Math.max(minSize, rect.height));
  const x = Math.min(Math.max(0, rect.x), 1 - width);
  const y = Math.min(Math.max(0, rect.y), 1 - height);
  return { x, y, width, height };
}

/** Draws the given natural-pixel crop of `source` (sized sourceWidth x
 * sourceHeight) to an offscreen canvas and exports it as a Blob. `crop` is
 * normalized (0-1) relative to the source's own full extent — the caller is
 * responsible for resolving it out of any on-screen letterbox first. */
export async function cropSourceToBlob(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop: NormalizedRect,
  mimeType = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  const sx = Math.round(crop.x * sourceWidth);
  const sy = Math.round(crop.y * sourceHeight);
  const sw = Math.max(1, Math.round(crop.width * sourceWidth));
  const sh = Math.max(1, Math.round(crop.height * sourceHeight));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo canvas để cắt ảnh.');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Không thể xuất vùng ảnh đã cắt.'))),
      mimeType,
      quality,
    );
  });
}

/** Loads `primaryUrl` as an ImageBitmap for canvas drawing, going through a
 * same-origin Blob first so the resulting canvas is never tainted regardless
 * of the CDN's CORS headers. If the CDN doesn't allow a cross-origin fetch
 * to read the response body at all, falls back to `fallbackUrl` (expected to
 * be a same-origin backend proxy). Never disables browser security — both
 * paths only ever read bytes the app is actually allowed to read. */
export async function loadCanvasSafeBitmap(
  primaryUrl: string,
  fallbackUrl: string,
): Promise<ImageBitmap> {
  try {
    return await fetchAsBitmap(primaryUrl);
  } catch {
    return await fetchAsBitmap(fallbackUrl);
  }
}

async function fetchAsBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Không thể tải ảnh gốc (HTTP ${response.status}).`);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}
