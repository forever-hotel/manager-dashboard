import {
  CheckoutOffer,
  referenceDiscount,
  ReferencePromotionConsumer
} from '../../test/fixtures/hw-promotion-contract';

const offer: CheckoutOffer = {
  id: '67f4568c-89ab-4c12-b321-123456789012',
  version: 0,
  status: 'ACTIVE',
  deletedAt: null,
  validFrom: '2026-10-01T00:00:00+05:30',
  validUntil: '2026-11-01T00:00:00+05:30',
  roomTypeIds: ['suite'],
  discountType: 'PERCENTAGE',
  discountValue: 25,
  currentRedemptions: 0,
  maxRedemptions: 1
};
describe('DDP-040 proposed HW consumer contract (test oracle, not actual HW)', () => {
  const now = new Date('2026-10-16T00:00:00Z');

  it('AC1: limits discounts to eligible room types and inclusive-start/exclusive-end redemption dates', () => {
    expect(referenceDiscount(offer, 'suite', 10000, now)).toBe(2500);
    expect(referenceDiscount(offer, 'other', 10000, now)).toBeNull();
    expect(referenceDiscount(offer, 'suite', 10000, new Date(offer.validFrom))).toBe(2500);
    expect(referenceDiscount(offer, 'suite', 10000, new Date(offer.validUntil))).toBeNull();
    expect(
      referenceDiscount({ ...offer, discountType: 'FIXED_AMOUNT', discountValue: 20000 }, 'suite', 10000, now)
    ).toBe(10000);
    expect(referenceDiscount({ ...offer, discountValue: 33 }, 'suite', 101, now)).toBe(33); // Proposed floor-to-cent rounding.
  });
  it.each([
    { status: 'INACTIVE' as const },
    { deletedAt: now.toISOString() },
    { currentRedemptions: 1 },
    { validUntil: now.toISOString() }
  ])('AC2: refuses inactive/deleted/expired/exhausted offers: %j', patch => {
    expect(referenceDiscount({ ...offer, ...patch }, 'suite', 10000, now)).toBeNull();
  });
  it('AC3: duplicate/out-of-order delivery cannot resurrect a withdrawn offer', () => {
    const consumer = new ReferencePromotionConsumer();
    const withdrawn = { ...offer, version: 1, status: 'INACTIVE' as const };

    consumer.apply('latest', withdrawn);
    consumer.apply('latest', withdrawn);
    consumer.apply('older', offer);
    expect(consumer.offers.get(offer.id)).toEqual(withdrawn);
    expect(() => consumer.apply('latest', offer)).toThrow('Conflicting event identity');
  });
});
