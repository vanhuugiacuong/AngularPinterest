import { PrismaClient } from '@prisma/client';

/** A pin is "commerce-restricted" once it's listed for a fixed price or has
 * a non-cancelled auction — only the owner or a PAID buyer should ever see
 * its real, unwatermarked preview image. Mirrors the exact condition
 * PinDownloadService.download already uses for the download endpoint (see
 * that file's comment on why isForSale alone isn't enough). */
export function isPinCommerceRestricted(isForSale: boolean, hasAuction: boolean): boolean {
  return isForSale || hasAuction;
}

export interface RestrictablePinImage {
  id: string;
  userId: string;
  imageUrl: string;
  protectedImageUrl?: string | null;
  isForSale: boolean;
}

/** Same-origin path to the server-rendered blurred stand-in for a locked pin.
 * A relative path on purpose: it is served by our own API, and the frontend
 * prefixes it for local dev (see PinService.request's normalizeImageUrls). */
export function lockedPinPreviewPath(pinId: string): string {
  return `/api/pins/${pinId}/locked-preview`;
}

/** Picks which image URL one specific viewer should receive for one pin.
 * Exactly two outcomes for a commerce-restricted pin (isForSale or a live
 * auction): the real, clear original for the owner or a viewer who has
 * actually PAID (bought it outright, or won and paid for the auction) — and
 * the fully-blurred server-rendered stand-in for absolutely everyone else,
 * with no middle ground.
 *
 * There used to be a middle tier here: a viewer whose PLAN merely entitled
 * them to "browse" (Plus for fixed-price, Pro for auctions) got a lightly
 * watermarked preview instead of the blur, on the reasoning that being
 * plan-entitled to look wasn't the same risk as a stranger with no plan at
 * all. Product direction is that it is: "entitled to browse" and "entitled
 * to the downloadable original" are not the same thing for a commerce pin,
 * and a watermark is not a real barrier — right-click "Save image as" on
 * that preview handed a Pro/Plus viewer who never actually paid essentially
 * the full picture. Only actually owning or having paid for a pin unlocks
 * anything but the blur now; there is nothing left for a viewer's plan to
 * distinguish, so it was removed from this function and its two callers
 * below, along with the now-unused viewerPlanAllowsPinPreview() gate. */
export function resolveViewablePinImageUrl(
  pin: RestrictablePinImage,
  opts: {
    viewerId?: string;
    hasAuction: boolean;
    hasPaidPurchase: boolean;
  },
): string {
  if (opts.viewerId && opts.viewerId === pin.userId) return pin.imageUrl;
  if (!isPinCommerceRestricted(pin.isForSale, opts.hasAuction)) return pin.imageUrl;
  if (opts.hasPaidPurchase) return pin.imageUrl;
  return lockedPinPreviewPath(pin.id);
}

type PinAccessClient = Pick<PrismaClient, 'auction' | 'imagePurchase'>;

/** Batches the two lookups resolveViewablePinImageUrl needs (which pins
 * have a live auction, which of those the viewer already paid for) across
 * a whole page of pins in at most 2 queries instead of N+1, then swaps
 * imageUrl in place for every pin whose viewer isn't entitled to the real
 * one. Mutates and returns the same array for convenience at call sites -
 * safe because callers always pass a freshly-fetched, request-scoped array. */
export async function applyPinImageProtection<T extends RestrictablePinImage>(
  prisma: PinAccessClient,
  pins: T[],
  viewerId: string | undefined,
): Promise<T[]> {
  if (pins.length === 0) return pins;
  const ids = pins.map((p) => p.id);

  const [auctionRows, purchaseRows] = await Promise.all([
    prisma.auction.findMany({
      where: { pinId: { in: ids }, status: { not: 'CANCELLED' } },
      select: { pinId: true },
    }),
    viewerId
      ? prisma.imagePurchase.findMany({
          where: { pinId: { in: ids }, buyerId: viewerId, status: 'PAID' },
          select: { pinId: true },
        })
      : Promise.resolve([]),
  ]);
  const auctionedIds = new Set(auctionRows.map((a) => a.pinId));
  const purchasedIds = new Set(purchaseRows.map((p) => p.pinId));

  for (const pin of pins) {
    pin.imageUrl = resolveViewablePinImageUrl(pin, {
      viewerId,
      hasAuction: auctionedIds.has(pin.id),
      hasPaidPurchase: purchasedIds.has(pin.id),
    });
  }
  return pins;
}

/** Single-pin version of applyPinImageProtection, for endpoints that
 * already fetched one pin plus its own auction/purchase state (e.g.
 * getPinById, which already knows `hasAuction` from its own query). Kept
 * separate rather than wrapping the batched version in a 1-element array
 * at every call site. */
export async function resolveSinglePinImageUrl<T extends RestrictablePinImage>(
  prisma: Pick<PrismaClient, 'imagePurchase'>,
  pin: T,
  viewerId: string | undefined,
  hasAuction: boolean,
): Promise<string> {
  if (viewerId === pin.userId) return pin.imageUrl;
  if (!isPinCommerceRestricted(pin.isForSale, hasAuction)) return pin.imageUrl;
  const hasPaidPurchase = viewerId
    ? Boolean(
        await prisma.imagePurchase.findUnique({
          where: { pinId_buyerId: { pinId: pin.id, buyerId: viewerId } },
          select: { status: true },
        }).then((row) => row?.status === 'PAID'),
      )
    : false;
  return resolveViewablePinImageUrl(pin, {
    viewerId,
    hasAuction,
    hasPaidPurchase,
  });
}
