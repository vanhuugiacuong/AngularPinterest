import { describe, expect, it } from 'vitest';
import { PinCardActionsService } from './pin-card-actions';

/**
 * bumpCount and likeCount are what the three hand-written copies each got
 * partly wrong: every page holds its pin objects in a different shape, and a
 * copy that handled one shape silently did nothing for the other two — the
 * count on those pages never moved. These exercise all three through the real
 * methods, with no DI: bumpCount is private, so it is reached the way the
 * service itself reaches it.
 */
function bump(pin: unknown, delta: number, userId = 'me'): void {
  (
    PinCardActionsService.prototype as unknown as {
      bumpCount(pin: unknown, delta: number, userId: string): void;
    }
  ).bumpCount.call({}, pin, delta, userId);
}

const likeCount = (pin: unknown): number =>
  PinCardActionsService.prototype.likeCount.call({}, pin);

describe('PinCardActionsService count shapes', () => {
  it('feed shape: likes is a plain number', () => {
    const pin = { id: 'p1', likes: 4 };
    bump(pin, 1);
    expect(pin.likes).toBe(5);
    expect(likeCount(pin)).toBe(5);
    bump(pin, -1);
    expect(pin.likes).toBe(4);
  });

  it('search shape: the count lives under _count.likes', () => {
    const pin = { id: 'p2', _count: { likes: 2 } };
    bump(pin, 1);
    expect(pin._count.likes).toBe(3);
    expect(likeCount(pin)).toBe(3);
  });

  it('pin-detail shape: likes is the array of who liked it', () => {
    const pin: { id: string; likes: { userId: string; pinId: string }[] } = {
      id: 'p3',
      likes: [{ userId: 'someone', pinId: 'p3' }],
    };
    bump(pin, 1);
    expect(likeCount(pin)).toBe(2);
    expect(pin.likes.some((l) => l.userId === 'me')).toBe(true);

    // Unliking removes this viewer's entry and nobody else's.
    bump(pin, -1);
    expect(likeCount(pin)).toBe(1);
    expect(pin.likes[0].userId).toBe('someone');
  });

  it('never drops a count below zero', () => {
    const numberPin = { id: 'p4', likes: 0 };
    bump(numberPin, -1);
    expect(numberPin.likes).toBe(0);

    const countPin = { id: 'p5', _count: { likes: 0 } };
    bump(countPin, -1);
    expect(countPin._count.likes).toBe(0);
  });

  it('reports zero rather than throwing for a pin with no count at all', () => {
    expect(likeCount({ id: 'p6' })).toBe(0);
    expect(likeCount(null)).toBe(0);
    expect(() => bump({ id: 'p7' }, 1)).not.toThrow();
  });
});
