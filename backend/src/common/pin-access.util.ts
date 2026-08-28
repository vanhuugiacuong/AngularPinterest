import { MembershipPlan, PrismaClient } from '@prisma/client';

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

/** Whether the viewer's membership plan lets them LOOK at a commerce pin at
 * all. Mirrors the gate PinsService.getPinById enforces with a 403 — auctions
 * are Pro-only, fixed-price is Plus/Pro — because a feed list cannot throw:
 * one restricted pin must not fail the whole page, so the image is swapped
 * instead of the request being refused. Keeping the rule in one function is
 * what stops the two paths drifting apart. */
export function viewerPlanAllowsPinPreview(
  plan: MembershipPlan,
  isForSale: boolean,
  hasAuction: boolean,
): boolean {
  if (hasAuction) return plan === 'PRO';
  if (isForSale) return plan === 'PLUS' || plan === 'PRO';
  return true;
}

/** Picks which image URL one specific viewer should receive for one pin.
 * Three tiers, and every one of them is load-bearing:
 *
 *  - clear original — the owner, an unrestricted pin, or a PAID buyer.
 *  - watermarked preview — the plan entitles them to browse but they have not
 *    bought it. This is the "look, with a watermark, until you buy" step.
 *  - server-blurred preview — the plan does not entitle them at all, OR the
 *    plan entitles them to browse but no watermarked preview exists yet.
 *
 * Neither non-owner, non-buyer tier ever falls back to the real `imageUrl`.
 * This used to fall back to it in the middle tier (entitled-to-browse-but-
 * not-bought) whenever no protected variant had been generated yet,
 * reasoning that a plan-entitled viewer merely "looking" wasn't a real leak
 * — but "entitled to browse" and "entitled to the full-resolution original"
 * are NOT the same thing for a commerce pin: only owning/winning it is. A
 * Pro/Plus viewer who never paid could still right-click-save the clear CDN
 * asset straight off an auction/fixed-price detail page whenever watermark
 * generation hadn't finished (network hiccup, Sharp error, upload retry —
 * see PinPreviewProtectionService). Frontend CSS blur never helps here
 * either: the browser has already downloaded whatever bytes the server
 * sent, one glance at the Network panel or a right-click away.
 *
 * So the middle tier now falls back to the SAME blurred stand-in as the
 * bottom tier when there's no watermarked preview yet, rather than to the
 * clear original — self-healing the moment PinPreviewProtectionService
 * finishes generating one on a later request. Too blurry-for-a-blink is a
 * cosmetic miss; handing out the real asset is the leak this function
 * exists to prevent.
 *
 * `viewerPlan` is optional because most callers (boards, users, notifications,
 * auctions) do not have the viewer's membership status to hand, and threading
 * MembershipsService through all of them is a change of its own. Omitting it
 * skips the middle tier, i.e. errs strict: an entitled viewer may get the
 * blurred preview where they could have had the watermarked one — the same
 * cosmetic-miss tradeoff, never a leak either way. */
export function resolveViewablePinImageUrl(
  pin: RestrictablePinImage,
  opts: {
    viewerId?: string;
    hasAuction: boolean;
    hasPaidPurchase: boolean;
    viewerPlan?: MembershipPlan;
  },
): string {
  if (opts.viewerId && opts.viewerId === pin.userId) return pin.imageUrl;
  if (!isPinCommerceRestricted(pin.isForSale, opts.hasAuction)) return pin.imageUrl;
  if (opts.hasPaidPurchase) return pin.imageUrl;
  if (
    opts.viewerPlan &&
    viewerPlanAllowsPinPreview(opts.viewerPlan, pin.isForSale, opts.hasAuction)
  ) {
    // Watermarked preview if it exists; the fully-blurred stand-in — never
    // the clear original — if it doesn't yet.
    return pin.protectedImageUrl ?? lockedPinPreviewPath(pin.id);
  }
  // Not entitled to browse this listing at all — always the fully-blurred
  // server render too, never the watermarked preview. protectedImageUrl only
  // has a small text stamp (see WatermarkRenderService.applyMandatoryWatermark)
  // meant for the middle tier ("entitled to browse, hasn't bought") — falling
  // back to it here for a viewer with NO entitlement handed them the clear
  // subject with nothing but a corner stamp hiding it, e.g. a FREE-plan
  // viewer on someone's profile page seeing a for-sale pin fully unobscured.
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
  viewerPlan?: MembershipPlan,
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
      viewerPlan,
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
  viewerPlan?: MembershipPlan,
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
    viewerPlan,
  });
}
