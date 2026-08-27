import { describe, expect, it } from 'vitest';
import { MARQUEE_PX_PER_SEC, advanceMarqueePosition } from './interest-marquee';

const FRAME = 1 / 60;

describe('advanceMarqueePosition', () => {
  it('advances by sub-pixel amounts that accumulate across frames', () => {
    // The bug this replaces: each frame moves ~0.43px, so a loop that read the
    // offset back from a rounding scrollLeft got 0 every time and never moved.
    let position = 0;
    for (let frame = 0; frame < 60; frame++) {
      const next = advanceMarqueePosition(position, FRAME, 5000);
      expect(next).not.toBeNull();
      position = next!;
    }
    expect(position).toBeCloseTo(MARQUEE_PX_PER_SEC, 5);
    expect(advanceMarqueePosition(0, FRAME, 5000)).toBeGreaterThan(0);
  });

  it('wraps at the halfway point instead of running off the end', () => {
    const half = 100;
    expect(advanceMarqueePosition(99.9, FRAME, half)).toBeCloseTo(99.9 + MARQUEE_PX_PER_SEC * FRAME - half, 5);
    expect(advanceMarqueePosition(50, FRAME, half)).toBeGreaterThan(50);
  });

  it('skips a frame that carries a hidden tab worth of time', () => {
    expect(advanceMarqueePosition(0, 4.2, 5000)).toBeNull();
  });

  it('skips the first frame, which has no previous timestamp to subtract', () => {
    expect(advanceMarqueePosition(0, 0, 5000)).toBeNull();
  });

  it('skips while the track has no measurable width', () => {
    expect(advanceMarqueePosition(0, FRAME, 0)).toBeNull();
  });
});
