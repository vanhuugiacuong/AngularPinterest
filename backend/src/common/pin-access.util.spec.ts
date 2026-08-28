import { lockedPinPreviewPath, resolveViewablePinImageUrl } from './pin-access.util';

describe('resolveViewablePinImageUrl', () => {
  const pin = {
    id: 'pin-1',
    userId: 'seller-1',
    imageUrl: 'https://cdn.example.com/pin-1.jpg',
    protectedImageUrl: 'https://cdn.example.com/pin-1_protected.jpg',
    isForSale: true,
  };

  it('gives the owner the clear image', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'seller-1',
      hasAuction: false,
      hasPaidPurchase: false,
    });
    expect(url).toBe(pin.imageUrl);
  });

  it('gives a buyer who already paid the clear image', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'buyer-1',
      hasAuction: false,
      hasPaidPurchase: true,
    });
    expect(url).toBe(pin.imageUrl);
  });

  it('gives a browsing (not-yet-paid) viewer only the fully blurred locked preview, never the watermarked one, even though protectedImageUrl exists', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'browser-1',
      hasAuction: false,
      hasPaidPurchase: false,
    });
    expect(url).toBe(lockedPinPreviewPath(pin.id));
    expect(url).not.toBe(pin.protectedImageUrl);
    expect(url).not.toBe(pin.imageUrl);
  });

  it('gives a browsing viewer of an auction pin only the locked preview too', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'browser-1',
      hasAuction: true,
      hasPaidPurchase: false,
    });
    expect(url).toBe(lockedPinPreviewPath(pin.id));
  });

  it('falls back to the locked preview path when protectedImageUrl has not been generated yet', () => {
    const url = resolveViewablePinImageUrl(
      { ...pin, protectedImageUrl: null },
      { viewerId: 'browser-1', hasAuction: false, hasPaidPurchase: false },
    );
    expect(url).toBe(lockedPinPreviewPath(pin.id));
  });

  it('gives an anonymous viewer the locked preview', () => {
    const url = resolveViewablePinImageUrl(pin, {
      hasAuction: false,
      hasPaidPurchase: false,
    });
    expect(url).toBe(lockedPinPreviewPath(pin.id));
  });

  it('is unrestricted for a pin that is not for sale and has no auction', () => {
    const url = resolveViewablePinImageUrl(
      { ...pin, isForSale: false },
      { viewerId: 'browser-1', hasAuction: false, hasPaidPurchase: false },
    );
    expect(url).toBe(pin.imageUrl);
  });
});
