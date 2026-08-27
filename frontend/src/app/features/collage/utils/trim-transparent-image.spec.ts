import { describe, expect, it } from 'vitest';
import { findAlphaBounds, remapCropAfterTrim } from './trim-transparent-image';

describe('findAlphaBounds', () => {
  it('returns a padded box around visible pixels and ignores faint alpha noise', () => {
    const width = 8;
    const height = 6;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels[(0 * width + 0) * 4 + 3] = 4;
    pixels[(2 * width + 3) * 4 + 3] = 255;
    pixels[(3 * width + 4) * 4 + 3] = 255;

    expect(findAlphaBounds(pixels, width, height, 8, 1)).toEqual({
      x: 2,
      y: 1,
      width: 4,
      height: 4,
    });
  });

  it('returns null for a fully transparent image', () => {
    expect(findAlphaBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull();
  });

  it('preserves an existing crop when transparent padding is removed', () => {
    expect(
      remapCropAfterTrim(
        { cropX: 0.25, cropY: 0.2, cropWidth: 0.5, cropHeight: 0.6 },
        100,
        100,
        { x: 20, y: 10, width: 60, height: 80 },
      ),
    ).toEqual({ cropX: 5 / 60, cropY: 0.125, cropWidth: 50 / 60, cropHeight: 0.75 });
  });
});
