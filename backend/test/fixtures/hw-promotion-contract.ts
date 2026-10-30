// TEST-ONLY review oracle. This is not the HW checkout implementation.
// HW must adopt and verify its own persistence/idempotency/atomic redemption.
export interface CheckoutOffer {
  id: string;
  version: number;
  status: 'ACTIVE' | 'INACTIVE';
  deletedAt: string | null;
  validFrom: string;
  validUntil: string;
  roomTypeIds: string[];
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  currentRedemptions: number;
  maxRedemptions: number;
}

export function referenceDiscount(offer: CheckoutOffer, room: string, subtotalMinor: number, now: Date): number | null {
  if (
    offer.status !== 'ACTIVE' ||
    offer.deletedAt !== null ||
    now.getTime() < Date.parse(offer.validFrom) ||
    now.getTime() >= Date.parse(offer.validUntil) ||
    !offer.roomTypeIds.includes(room) ||
    offer.currentRedemptions >= offer.maxRedemptions
  )
    return null;
  const total = BigInt(subtotalMinor);
  const discount =
    offer.discountType === 'PERCENTAGE' ? (total * BigInt(offer.discountValue)) / 100n : BigInt(offer.discountValue);

  return Number(discount > total ? total : discount);
}

export class ReferencePromotionConsumer {
  readonly offers = new Map<string, CheckoutOffer>();
  private readonly receipts = new Map<string, string>();

  apply(eventId: string, offer: CheckoutOffer) {
    const body = JSON.stringify(offer);
    const prior = this.receipts.get(eventId);

    if (prior !== undefined) {
      if (prior !== body) throw new Error('Conflicting event identity');
      return;
    }
    this.receipts.set(eventId, body);
    if ((this.offers.get(offer.id)?.version ?? -1) < offer.version) this.offers.set(offer.id, offer);
  }
}
