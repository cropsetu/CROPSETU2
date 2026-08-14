import { describe, it, expect } from '@jest/globals';
import {
  parseAgeMonths, parseWeightKg, parseMilkLpd,
  buildSearchText, searchGroups, normalizeText, normalizedColumns,
} from '../../../src/utils/animalNormalize.js';
import { imageVariant, thumbnailsFor } from '../../../src/utils/imageVariants.js';
import { coarseDistanceKm } from '../../../src/services/animalListing.service.js';

describe('parseAgeMonths', () => {
  it('reads explicit years and months', () => {
    expect(parseAgeMonths('3 years')).toBe(36);
    expect(parseAgeMonths('18 months')).toBe(18);
    expect(parseAgeMonths('2.5 yr')).toBe(30);
  });

  it('reads Marathi and Hindi units', () => {
    expect(parseAgeMonths('4 वर्ष')).toBe(48);
    expect(parseAgeMonths('8 महिने')).toBe(8);
  });

  it('treats a small bare number as years and a large one as months', () => {
    // No animal in this marketplace is 31+ years old, so 3 means 3 years…
    expect(parseAgeMonths('3')).toBe(36);
    // …and 40 can only sensibly be months.
    expect(parseAgeMonths('40')).toBe(40);
  });

  it('returns null rather than throwing on junk', () => {
    expect(parseAgeMonths('young')).toBeNull();
    expect(parseAgeMonths('')).toBeNull();
    expect(parseAgeMonths(null)).toBeNull();
    expect(parseAgeMonths(undefined)).toBeNull();
  });

  it('rejects implausible values instead of poisoning a range filter', () => {
    expect(parseAgeMonths('9999 years')).toBeNull();
  });
});

describe('parseWeightKg', () => {
  it('reads kilograms with or without a unit', () => {
    expect(parseWeightKg('450 kg')).toBe(450);
    expect(parseWeightKg('450')).toBe(450);
    expect(parseWeightKg('380.5 किलो')).toBe(380.5);
  });

  it('converts quintals, the unit many markets actually quote', () => {
    expect(parseWeightKg('4.5 quintal')).toBe(450);
    expect(parseWeightKg('5 क्विंटल')).toBe(500);
  });

  it('rejects impossible weights and junk', () => {
    expect(parseWeightKg('99999 kg')).toBeNull();
    expect(parseWeightKg('heavy')).toBeNull();
    expect(parseWeightKg('0 kg')).toBeNull();
  });
});

describe('parseMilkLpd', () => {
  it('reads the display string the form produces', () => {
    expect(parseMilkLpd('12 Litre/Day')).toBe(12);
    expect(parseMilkLpd('7.5')).toBe(7.5);
  });

  it('rejects out-of-range and unparseable values', () => {
    expect(parseMilkLpd('500 Litre/Day')).toBeNull();
    expect(parseMilkLpd('good yield')).toBeNull();
    expect(parseMilkLpd(null)).toBeNull();
  });
});

describe('normalizeText', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeText('  Gir   Cow, (Female)  ')).toBe('gir cow female');
  });

  it('leaves Devanagari intact', () => {
    expect(normalizeText('  म्हैस  ')).toBe('म्हैस');
  });
});

describe('buildSearchText', () => {
  const listing = {
    animal: 'Buffalo', breed: 'Murrah',
    sellerLocation: 'Baramati, Pune', tags: ['Vaccinated'],
    description: 'High yield, gentle temperament',
  };

  it('carries the animal\'s Marathi and Hindi names so either language matches', () => {
    const text = buildSearchText(listing);
    expect(text).toContain('buffalo');
    expect(text).toContain('म्हैस');
    expect(text).toContain('भैंस');
  });

  it('includes breed, location, tags and the description head', () => {
    const text = buildSearchText(listing);
    expect(text).toContain('murrah');
    expect(text).toContain('baramati');
    expect(text).toContain('vaccinated');
    expect(text).toContain('yield');
  });

  it('de-duplicates tokens and bounds its length', () => {
    const text = buildSearchText({ ...listing, description: 'cow '.repeat(500) });
    expect(text.length).toBeLessThanOrEqual(1000);
    const words = text.split(' ');
    expect(new Set(words).size).toBe(words.length);
  });

  it('never throws on an empty or malformed listing', () => {
    expect(buildSearchText({})).toBe('');
    expect(buildSearchText({ tags: null, animal: undefined })).toBe('');
  });
});

describe('searchGroups', () => {
  it('expands a single-word animal query into every alias', () => {
    const groups = searchGroups('म्हैस');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain('buffalo');
    expect(groups[0]).toContain('म्हैस');
  });

  it('ANDs the words of a multi-word query, expanding only the animal word', () => {
    const groups = searchGroups('jersey cow');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(['jersey']);
    expect(groups[1]).toContain('गाय');
  });

  it('caps the number of groups so a long query cannot build a huge WHERE', () => {
    expect(searchGroups('one two three four five six seven eight')).toHaveLength(5);
  });

  it('returns nothing for a blank query', () => {
    expect(searchGroups('')).toEqual([]);
    expect(searchGroups('   ')).toEqual([]);
    expect(searchGroups(null)).toEqual([]);
  });
});

describe('normalizedColumns', () => {
  it('derives every column a listing write needs in one call', () => {
    const cols = normalizedColumns({
      animal: 'Cow', breed: 'Gir', age: '5 years', weight: '400 kg',
      milkYield: '15 Litre/Day', sellerLocation: 'Satara', tags: [],
    });
    expect(cols).toMatchObject({ ageMonths: 60, weightKg: 400, milkYieldLpd: 15 });
    expect(cols.searchText).toContain('गाय');
  });
});

describe('imageVariant', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1699/farmeasy/animals/x.jpg';

  it('inserts a width-limited, format-auto transform', () => {
    expect(imageVariant(url, 320)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto:eco,w_320,c_limit/v1699/farmeasy/animals/x.jpg',
    );
  });

  it('does not stack a second transform onto an already-derived URL', () => {
    const once = imageVariant(url, 320);
    expect(imageVariant(once, 320)).toBe(once);
  });

  it('passes non-Cloudinary URLs through untouched', () => {
    expect(imageVariant('https://example.com/a.jpg', 320)).toBe('https://example.com/a.jpg');
    expect(imageVariant(null, 320)).toBeNull();
  });

  it('filters junk out of an images array instead of emitting nulls', () => {
    expect(thumbnailsFor([url, null, 42, 'not-a-url'])).toHaveLength(1);
    expect(thumbnailsFor(null)).toEqual([]);
  });
});

describe('coarseDistanceKm', () => {
  it('rounds to whole kilometres so a seller cannot be triangulated', () => {
    expect(coarseDistanceKm(12.34)).toBe(12);
    expect(coarseDistanceKm(12.61)).toBe(13);
  });

  it('floors at 1 km rather than revealing "you are 80 m away"', () => {
    expect(coarseDistanceKm(0.08)).toBe(1);
    expect(coarseDistanceKm(0)).toBe(1);
  });

  it('passes through the no-distance case', () => {
    expect(coarseDistanceKm(null)).toBeNull();
    expect(coarseDistanceKm(NaN)).toBeNull();
  });
});
