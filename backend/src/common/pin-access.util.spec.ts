import {
  downscaledPinPreviewPath,
  lockedPinPreviewPath,
  resolveViewablePinImageUrl,
} from './pin-access.util';

describe('resolveViewablePinImageUrl', () => {
  const fixedPricePin = {
    id: 'pin-1',
    userId: 'seller-1',
    imageUrl: 'https://cdn.example.com/pin-1.jpg',
    protectedImageUrl: 'https://cdn.example.com/pin-1_protected.jpg',
    isForSale: true,
  };

  const auctionPin = {
    id: 'pin-2',
    userId: 'seller-2',
    imageUrl: 'https://cdn.example.com/pin-2.jpg',
    protectedImageUrl: 'https://cdn.example.com/pin-2_protected.jpg',
    isForSale: false,
  };

  it('gives the owner the clear image regardless of commerce type', () => {
    const url = resolveViewablePinImageUrl(fixedPricePin, {
      viewerId: 'seller-1',
      hasAuction: false,
      hasPaidPurchase: false,
    });
    expect(url).toBe(fixedPricePin.imageUrl);
  });

  it('gives a buyer who already paid the clear image', () => {
    const url = resolveViewablePinImageUrl(fixedPricePin, {
      viewerId: 'buyer-1',
      hasAuction: false,
      hasPaidPurchase: true,
    });
    expect(url).toBe(fixedPricePin.imageUrl);
  });

  describe('FIXED_PRICE (no auction)', () => {
    it('gives a browsing, not-yet-paid viewer the downscaled preview — never the watermarked/full-res one, never the heavy blur', () => {
      const url = resolveViewablePinImageUrl(fixedPricePin, {
        viewerId: 'browser-1',
        hasAuction: false,
        hasPaidPurchase: false,
      });
      expect(url).toBe(downscaledPinPreviewPath(fixedPricePin.id));
      expect(url).not.toBe(fixedPricePin.protectedImageUrl);
      expect(url).not.toBe(fixedPricePin.imageUrl);
      expect(url).not.toBe(lockedPinPreviewPath(fixedPricePin.id));
    });

    it('gives an anonymous browser the downscaled preview too', () => {
      const url = resolveViewablePinImageUrl(fixedPricePin, {
        hasAuction: false,
        hasPaidPurchase: false,
      });
      expect(url).toBe(downscaledPinPreviewPath(fixedPricePin.id));
    });
  });

  describe('AUCTION — status gates the tier, not the viewer', () => {
    it('ACTIVE: gives a browsing viewer the full watermarked preview when one exists', () => {
      const url = resolveViewablePinImageUrl(auctionPin, {
        viewerId: 'bidder-1',
        hasAuction: true,
        auctionStatus: 'ACTIVE',
        hasPaidPurchase: false,
      });
      expect(url).toBe(auctionPin.protectedImageUrl);
    });

    it('ACTIVE: falls back to the locked preview when no watermarked preview has been generated yet', () => {
      const url = resolveViewablePinImageUrl(
        { ...auctionPin, protectedImageUrl: null },
        { viewerId: 'bidder-1', hasAuction: true, auctionStatus: 'ACTIVE', hasPaidPurchase: false },
      );
      expect(url).toBe(lockedPinPreviewPath(auctionPin.id));
    });

    it('SCHEDULED: always the fully-blurred locked preview, even though a watermarked one exists', () => {
      const url = resolveViewablePinImageUrl(auctionPin, {
        viewerId: 'browser-1',
        hasAuction: true,
        auctionStatus: 'SCHEDULED',
        hasPaidPurchase: false,
      });
      expect(url).toBe(lockedPinPreviewPath(auctionPin.id));
      expect(url).not.toBe(auctionPin.protectedImageUrl);
    });

    it('ENDED, not the winner: always the fully-blurred locked preview', () => {
      const url = resolveViewablePinImageUrl(auctionPin, {
        viewerId: 'losing-bidder',
        hasAuction: true,
        auctionStatus: 'ENDED',
        hasPaidPurchase: false,
      });
      expect(url).toBe(lockedPinPreviewPath(auctionPin.id));
    });

    it('ENDED, the winner who paid: the real image (hasPaidPurchase short-circuits before status is even checked)', () => {
      const url = resolveViewablePinImageUrl(auctionPin, {
        viewerId: 'winner-1',
        hasAuction: true,
        auctionStatus: 'ENDED',
        hasPaidPurchase: true,
      });
      expect(url).toBe(auctionPin.imageUrl);
    });

    it('missing auctionStatus (caller could not determine it) errs strict: fully-blurred, not the watermarked preview', () => {
      const url = resolveViewablePinImageUrl(auctionPin, {
        viewerId: 'browser-1',
        hasAuction: true,
        hasPaidPurchase: false,
      });
      expect(url).toBe(lockedPinPreviewPath(auctionPin.id));
    });
  });

  it('is unrestricted for a pin that is not for sale and has no auction', () => {
    const url = resolveViewablePinImageUrl(
      { ...fixedPricePin, isForSale: false },
      { viewerId: 'browser-1', hasAuction: false, hasPaidPurchase: false },
    );
    expect(url).toBe(fixedPricePin.imageUrl);
  });
});
