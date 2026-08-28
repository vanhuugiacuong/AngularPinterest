export interface AlphaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrimmedTransparentImage extends AlphaBounds {
  blob: Blob;
  originalWidth: number;
  originalHeight: number;
  changed: boolean;
}

export interface NormalizedCrop {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

/** Finds the visible subject rather than treating barely-present transparent
 * pixels as artwork. A small threshold drops model noise; padding preserves
 * anti-aliased hair and edges around the subject. */
export function findAlphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
  padding = 2,
): AlphaBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((rgba[rowOffset + x * 4 + 3] ?? 0) <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Re-expresses an existing normalized crop after transparent outer pixels are
 * removed, preserving the same visible region for restored legacy drafts. */
export function remapCropAfterTrim(
  crop: NormalizedCrop,
  originalWidth: number,
  originalHeight: number,
  trimmed: AlphaBounds,
): NormalizedCrop {
  const left = Math.max(0, Math.min(trimmed.width, crop.cropX * originalWidth - trimmed.x));
  const top = Math.max(0, Math.min(trimmed.height, crop.cropY * originalHeight - trimmed.y));
  const right = Math.max(
    0,
    Math.min(trimmed.width, (crop.cropX + crop.cropWidth) * originalWidth - trimmed.x),
  );
  const bottom = Math.max(
    0,
    Math.min(trimmed.height, (crop.cropY + crop.cropHeight) * originalHeight - trimmed.y),
  );
  if (right <= left || bottom <= top) {
    return { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 };
  }
  return {
    cropX: left / trimmed.width,
    cropY: top / trimmed.height,
    cropWidth: (right - left) / trimmed.width,
    cropHeight: (bottom - top) / trimmed.height,
  };
}

export async function trimTransparentImage(blob: Blob): Promise<TrimmedTransparentImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
    context.drawImage(bitmap, 0, 0);

    const bounds = findAlphaBounds(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
    if (
      !bounds ||
      (bounds.x === 0 &&
        bounds.y === 0 &&
        bounds.width === canvas.width &&
        bounds.height === canvas.height)
    ) {
      return {
        blob,
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        originalWidth: canvas.width,
        originalHeight: canvas.height,
        changed: false,
      };
    }

    const output = document.createElement('canvas');
    output.width = bounds.width;
    output.height = bounds.height;
    const outputContext = output.getContext('2d', { alpha: true });
    if (!outputContext) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
    outputContext.drawImage(
      bitmap,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );
    const trimmedBlob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Không thể thu gọn ảnh PNG.'))),
        'image/png',
        1,
      );
    });
    return {
      ...bounds,
      blob: trimmedBlob,
      originalWidth: canvas.width,
      originalHeight: canvas.height,
      changed: true,
    };
  } finally {
    bitmap.close();
  }
}
