import {
  isPinImageSizeAllowed,
  MAX_PIN_IMAGE_UPLOAD_BYTES,
} from './upload-limits';

describe('pin image upload limit', () => {
  it('accepts an image exactly at 1 GB', () => {
    expect(isPinImageSizeAllowed(MAX_PIN_IMAGE_UPLOAD_BYTES)).toBe(true);
  });

  it('rejects an image larger than 1 GB', () => {
    expect(isPinImageSizeAllowed(MAX_PIN_IMAGE_UPLOAD_BYTES + 1)).toBe(false);
  });
});
