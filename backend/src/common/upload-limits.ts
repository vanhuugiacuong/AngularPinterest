/** Maximum size of an image published as a Pin: 1 GiB. Keep the frontend
 * counterpart in sync so the browser can reject oversized files before any
 * network or moderation work starts. */
export const MAX_PIN_IMAGE_UPLOAD_BYTES = 1024 ** 3;
export const MAX_PIN_IMAGE_UPLOAD_LABEL = '1 GB';
export const PIN_IMAGE_TOO_LARGE_MESSAGE =
  'Ảnh vượt quá giới hạn 1 GB. Vui lòng chọn ảnh có dung lượng từ 1 GB trở xuống.';

export function isPinImageSizeAllowed(sizeInBytes: number): boolean {
  return Number.isFinite(sizeInBytes) && sizeInBytes >= 0 && sizeInBytes <= MAX_PIN_IMAGE_UPLOAD_BYTES;
}
