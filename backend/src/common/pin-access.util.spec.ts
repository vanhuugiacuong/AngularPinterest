import { lockedPinPreviewPath, resolveViewablePinImageUrl } from './pin-access.util';

describe('resolveViewablePinImageUrl', () => {
  const pin = {
    id: 'pin-1',
    userId: 'seller-1',
    imageUrl: 'https://cdn.example.com/pin-1.jpg',
    protectedImageUrl: 'https://cdn.example.com/pin-1_protected.jpg',
    isForSale: true,
  };

  it('gives the owner the clear image regardless of plan', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'seller-1',
      hasAuction: false,
      hasPaidPurchase: false,
      viewerPlan: 'FREE',
    });
    expect(url).toBe(pin.imageUrl);
  });

  it('gives a buyer who already paid the clear image', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'buyer-1',
      hasAuction: false,
      hasPaidPurchase: true,
      viewerPlan: 'FREE',
    });
    expect(url).toBe(pin.imageUrl);
  });

  it('gives a Plus/Pro viewer who has not bought yet the watermarked preview', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'browser-1',
      hasAuction: false,
      hasPaidPurchase: false,
      viewerPlan: 'PLUS',
    });
    expect(url).toBe(pin.protectedImageUrl);
  });

  it('never hands a FREE-plan viewer the watermarked preview for a fixed-price pin, even when one exists — the fully blurred locked preview only', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'browser-1',
      hasAuction: false,
      hasPaidPurchase: false,
      viewerPlan: 'FREE',
    });
    expect(url).toBe(lockedPinPreviewPath(pin.id));
    expect(url).not.toBe(pin.protectedImageUrl);
  });

  it('never hands a Plus (non-Pro) viewer the watermarked preview for an auction pin', () => {
    const url = resolveViewablePinImageUrl(pin, {
      viewerId: 'browser-1',
      hasAuction: true,
      hasPaidPurchase: false,
      viewerPlan: 'PLUS',
    });
    expect(url).toBe(lockedPinPreviewPath(pin.id));
  });

  it('falls back to the locked preview path even when protectedImageUrl has not been generated yet', () => {
    const url = resolveViewablePinImageUrl(
      { ...pin, protectedImageUrl: null },
      { viewerId: 'browser-1', hasAuction: false, hasPaidPurchase: false, viewerPlan: 'FREE' },
    );
    expect(url).toBe(lockedPinPreviewPath(pin.id));
  });

  it('gives an anonymous viewer (no plan at all) the locked preview, not the watermarked one', () => {
    const url = resolveViewablePinImageUrl(pin, {
      hasAuction: false,
      hasPaidPurchase: false,
    });
    expect(url).toBe(lockedPinPreviewPath(pin.id));
  });

  it('is unrestricted for a pin that is not for sale and has no auction', () => {
    const url = resolveViewablePinImageUrl(
      { ...pin, isForSale: false },
      { viewerId: 'browser-1', hasAuction: false, hasPaidPurchase: false, viewerPlan: 'FREE' },
    );
    expect(url).toBe(pin.imageUrl);
  });
});
