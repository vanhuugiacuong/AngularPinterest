/** Speed of the "Xu hướng nổi bật" strip, in CSS pixels per second. */
export const MARQUEE_PX_PER_SEC = 26;

/** Frames longer than this are discarded rather than applied. A background tab
 * stops firing requestAnimationFrame, so the first frame after returning to it
 * carries the whole hidden duration and would jump the strip forward by it. */
const MAX_FRAME_SECONDS = 0.1;

/**
 * Next scroll offset for the strip, or null if this frame should be skipped.
 *
 * Pulled out of the component so the arithmetic is testable without a browser:
 * the loop that used to hold it inline read the current offset back out of
 * `el.scrollLeft` each frame, and at this speed a frame advances ~0.43px — under
 * the 1px that a rounding scrollLeft getter preserves, so every increment was
 * rounded away and the strip never moved. The position now lives in a float the
 * component owns and scrollLeft is only ever written, never read back.
 *
 * @param position current offset held by the caller, in pixels
 * @param deltaSeconds time since the previous frame
 * @param halfWidth half the track width; the pin list is rendered twice, so
 *   passing the halfway point looks identical to being at the start
 */
export function advanceMarqueePosition(
  position: number,
  deltaSeconds: number,
  halfWidth: number,
): number | null {
  if (!(deltaSeconds > 0) || deltaSeconds > MAX_FRAME_SECONDS) return null;
  if (!(halfWidth > 0)) return null;

  const next = position + MARQUEE_PX_PER_SEC * deltaSeconds;
  return next >= halfWidth ? next - halfWidth : next;
}
