import { AuctionStatus, PrismaClient } from '@prisma/client';

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

/** Same-origin path to the server-rendered, watermarked, resolution-reduced
 * (under half the original's dimensions) stand-in for a FIXED_PRICE pin's
 * unpaid viewers — see PinsService.getDownscaledPinPreview. Recognizable
 * enough to shop by, useless as a right-click "Save image as" theft since
 * it is neither full-resolution nor the real file. Computed on demand, not
 * stored, so unlike protectedImageUrl there is no "not generated yet" race —
 * it never falls back to anything else. */
export function downscaledPinPreviewPath(pinId: string): string {
  return `/api/pins/${pinId}/downscaled-preview`;
}

/** Auction statuses that still show a recognizable preview to a browsing,
 * not-yet-winning viewer. SCHEDULED (hasn't started) and ENDED (you didn't
 * win) both fall back to the fully-blurred stand-in instead — only a live
 * ACTIVE auction needs bidders to actually see what they're bidding on. */
function isBiddableAuctionStatus(status: AuctionStatus | undefined): boolean {
  return status === 'ACTIVE';
}

/** Picks which image URL one specific viewer should receive for one pin.
 * No membership-plan check anywhere below: "allowed to browse the
 * marketplace" and "allowed to view a for-sale/auction listing's picture"
 * are the same thing for every viewer here, paid or not — plan only ever
 * gated the separate, unrelated question of whether the *detail page* loads
 * at all (see PinsService.getPinById / AuctionsService.getAuction's 403s),
 * which this function has no part in.
 *
 * The owner and a PAID buyer always get the real, clear original. For
 * everyone else, the two commerce types diverge on purpose:
 *
 *  - FIXED_PRICE: the resolution-reduced, watermarked stand-in
 *    (downscaledPinPreviewPath) — recognizable enough to shop by, computed
 *    fresh on every request so there is no "not ready yet" fallback to
 *    reason about.
 *  - AUCTION, status ACTIVE: the full-resolution watermarked preview
 *    (protectedImageUrl) if one has been generated yet, otherwise the
 *    fully-blurred stand-in as a brief, self-healing fallback (watermark
 *    generation can fail transiently — see PinPreviewProtectionService).
 *    Bidders need to see the real subject to bid on it.
 *  - AUCTION, status SCHEDULED or ENDED: always the fully-blurred stand-in.
 *    Nothing to bid on yet, or you didn't win — no reason to keep showing
 *    the picture clearly either way. */
export function resolveViewablePinImageUrl(
  pin: RestrictablePinImage,
  opts: {
    viewerId?: string;
    hasAuction: boolean;
    auctionStatus?: AuctionStatus;
    hasPaidPurchase: boolean;
  },
): string {
  if (opts.viewerId && opts.viewerId === pin.userId) return pin.imageUrl;
  if (!isPinCommerceRestricted(pin.isForSale, opts.hasAuction)) return pin.imageUrl;
  if (opts.hasPaidPurchase) return pin.imageUrl;

  if (opts.hasAuction) {
    if (!isBiddableAuctionStatus(opts.auctionStatus)) return lockedPinPreviewPath(pin.id);
    return pin.protectedImageUrl ?? lockedPinPreviewPath(pin.id);
  }
  return downscaledPinPreviewPath(pin.id);
}

type PinAccessClient = Pick<PrismaClient, 'auction' | 'imagePurchase'>;

/** Batches the lookups resolveViewablePinImageUrl needs (which pins have a
 * live auction and its status, which of those the viewer already paid for)
 * across a whole page of pins in at most 2 queries instead of N+1, then
 * swaps imageUrl in place for every pin whose viewer isn't entitled to the
 * real one. Mutates and returns the same array for convenience at call
 * sites - safe because callers always pass a freshly-fetched, request-
 * scoped array. */
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
      select: { pinId: true, status: true },
    }),
    viewerId
      ? prisma.imagePurchase.findMany({
          where: { pinId: { in: ids }, buyerId: viewerId, status: 'PAID' },
          select: { pinId: true },
        })
      : Promise.resolve([]),
  ]);
  const auctionStatusByPinId = new Map(auctionRows.map((a) => [a.pinId, a.status]));
  const purchasedIds = new Set(purchaseRows.map((p) => p.pinId));

  for (const pin of pins) {
    pin.imageUrl = resolveViewablePinImageUrl(pin, {
      viewerId,
      hasAuction: auctionStatusByPinId.has(pin.id),
      auctionStatus: auctionStatusByPinId.get(pin.id),
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
  auctionStatus?: AuctionStatus,
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
    auctionStatus,
    hasPaidPurchase,
  });
}
