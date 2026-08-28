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
 * Three outcomes for a commerce-restricted pin (isForSale or a live
 * auction), and no plan check anywhere in the decision:
 *
 *  - clear original — the owner, or a viewer who has actually PAID (bought
 *    it outright, or won and paid for the auction).
 *  - watermarked preview — anyone else, as long as one has been generated.
 *    Still fully recognizable (a small "NovaFrame · author" text stamp, see
 *    WatermarkRenderService.applyMandatoryWatermark) — a marketplace listing
 *    a browser can't recognize is useless as a listing, and hiding what's
 *    for sale doesn't sell it. The watermark is what stops a right-click
 *    "Save image as" from handing out a clean, sellable copy for free; it is
 *    not meant to make the subject unrecognizable.
 *  - fully-blurred server-rendered stand-in — only when no watermarked
 *    preview exists YET (generation can fail transiently — network hiccup,
 *    Sharp error, upload retry — see PinPreviewProtectionService, which
 *    retries on the next write to this pin's commerce state). This is the
 *    ONLY tier that ever looks like "you can't tell what this is"; it is a
 *    brief, self-healing fallback, not the normal browsing experience.
 *
 * Membership plan does not appear anywhere above: "allowed to browse the
 * marketplace" and "allowed to view a for-sale/auction listing's picture"
 * are the same thing for every viewer here, paid or not — plan only ever
 * gated the separate, unrelated question of whether the *detail page* loads
 * at all (see PinsService.getPinById / AuctionsService.getAuction's 403s),
 * which this function has no part in. */
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
  return pin.protectedImageUrl ?? lockedPinPreviewPath(pin.id);
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
