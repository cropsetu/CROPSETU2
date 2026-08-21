/**
 * Buy-box read amplification (claude.md §24).
 *
 * A product page renders every pack size a product is sold in, and each of those
 * is a variant with its own set of competing Kendra offers. Ranking them one at
 * a time cost one full offer query per variant — each joining seller and
 * sellerProfile — so the price of rendering one screen scaled with how many ways
 * a seed is packaged. That is a catalogue decision, not a traffic one.
 *
 * Acceptance: N variants cost ONE offer query, every requested variant gets an
 * entry, and the ranking is unchanged — the scoring still has to happen per
 * variant, because price and SLA are min-max normalised WITHIN a variant's own
 * offer set. A ₹200 offer is cheap among 5 kg bags and expensive among 1 kg ones.
 */
import { jest } from '@jest/globals';

const findMany = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { sellerListing: { findMany }, productVariant: { findMany: jest.fn() } },
}));
jest.unstable_mockModule('../../../src/services/settings.service.js', () => ({
  getSetting: jest.fn(async () => null),
}));

const { rankOffersForVariants, rankOffersForVariant } =
  await import('../../../src/services/buyBox.service.js');

/** A listing with no seller metrics — the bootstrap path. */
const listing = (id, variantId, price, sla = 2) => ({
  id, variantId,
  sellingPrice: price,
  dispatchSlaDays: sla,
  createdAt: new Date('2026-01-01'),
  seller: { id: `s-${id}`, name: `Seller ${id}`, sellerProfile: null },
});

beforeEach(() => findMany.mockReset());

describe('rankOffersForVariants', () => {
  it('reads every variant in ONE query', async () => {
    findMany.mockResolvedValue([
      listing('l1', 'v1', 100), listing('l2', 'v1', 120),
      listing('l3', 'v2', 300), listing('l4', 'v3', 50),
    ]);

    await rankOffersForVariants(['v1', 'v2', 'v3'], {});

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.variantId).toEqual({ in: ['v1', 'v2', 'v3'] });
  });

  it('groups the offers back onto the variant they belong to', async () => {
    findMany.mockResolvedValue([
      listing('l1', 'v1', 100), listing('l2', 'v1', 120), listing('l3', 'v2', 300),
    ]);

    const out = await rankOffersForVariants(['v1', 'v2'], {});

    expect(out.get('v1').offers.map((o) => o.id).sort()).toEqual(['l1', 'l2']);
    expect(out.get('v2').offers.map((o) => o.id)).toEqual(['l3']);
  });

  it('normalises price WITHIN each variant, not across the product', async () => {
    // 300 is the only offer on v2, so it wins v2 outright. If the scoring had
    // been merged across variants it would have been scored as "expensive"
    // against v1's 100 and could have lost to nothing.
    findMany.mockResolvedValue([
      listing('cheap', 'v1', 100), listing('dear', 'v1', 900), listing('only', 'v2', 300),
    ]);

    const out = await rankOffersForVariants(['v1', 'v2'], {});

    expect(out.get('v1').winner.id).toBe('cheap');
    expect(out.get('v2').winner.id).toBe('only');
    // The lone offer on v2 gets the top normalised price score, because within
    // its own set it is both the cheapest and the dearest.
    expect(out.get('v2').winner.scoreParts.price).toBe(1);
  });

  it('gives a variant with no eligible offer an entry, not a missing key', async () => {
    // Callers index by id. A missing key reads as an error; an empty offer list
    // reads as "nobody near you sells this pack size", which is the truth.
    findMany.mockResolvedValue([listing('l1', 'v1', 100)]);

    const out = await rankOffersForVariants(['v1', 'v2'], {});

    expect(out.has('v2')).toBe(true);
    expect(out.get('v2')).toMatchObject({ winner: null, offers: [] });
  });

  it('deduplicates the requested ids and asks for each once', async () => {
    findMany.mockResolvedValue([]);
    await rankOffersForVariants(['v1', 'v1', 'v2', null, undefined], {});
    expect(findMany.mock.calls[0][0].where.variantId).toEqual({ in: ['v1', 'v2'] });
  });

  it('does not query at all for an empty list', async () => {
    expect((await rankOffersForVariants([], {})).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('still filters to ACTIVE, in-stock offers', async () => {
    findMany.mockResolvedValue([]);
    await rankOffersForVariants(['v1'], {});
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('ACTIVE');
    expect(where.stockQty).toEqual({ gt: 0 });
  });
});

describe('rankOffersForVariant — the single-variant API is unchanged', () => {
  it('returns the same shape callers already relied on', async () => {
    findMany.mockResolvedValue([listing('l1', 'v1', 100), listing('l2', 'v1', 200)]);

    const r = await rankOffersForVariant('v1', {});

    expect(r.winner.id).toBe('l1');
    expect(r.offers).toHaveLength(2);
    expect(r.weights).toBeDefined();
  });

  it('delegates to the batch, so there is one scoring implementation', async () => {
    findMany.mockResolvedValue([listing('l1', 'v1', 100)]);
    await rankOffersForVariant('v1', {});
    expect(findMany.mock.calls[0][0].where.variantId).toEqual({ in: ['v1'] });
  });
});
