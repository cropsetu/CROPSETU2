/**
 * Tests for cache-key schema versioning (constants/cacheVersion.js + the key
 * builders in utils/listingCache.js and config/redis.js).
 *
 * Acceptance (CACHE versioning ticket): a version bump misses all old keys
 * cleanly. We prove the key builders embed the schema version and that two schema
 * versions produce DISJOINT key spaces — so after a bump, no new read can land on
 * an old (differently-shaped) payload.
 */
import { jest } from '@jest/globals';

// config/redis.js imports config/env.js at load; provide the vars env.js requires.
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/x';
process.env.JWT_SECRET = 'a'.repeat(32);

const { CACHE_SCHEMA_VERSION } = await import('../../../src/constants/cacheVersion.js');
const { VER_KEY, DATA_KEY } = await import('../../../src/utils/listingCache.js');
const { cacheKey } = await import('../../../src/config/redis.js');

describe('CACHE_SCHEMA_VERSION', () => {
  test('is a positive integer (bumped monotonically)', () => {
    expect(Number.isInteger(CACHE_SCHEMA_VERSION)).toBe(true);
    expect(CACHE_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

describe('listing key builders embed the schema version', () => {
  test('keys include the current schema tag', () => {
    expect(DATA_KEY('agristore:products', 0, 'abc')).toBe(`cache:agristore:products:s${CACHE_SCHEMA_VERSION}:v0:abc`);
    expect(VER_KEY('agristore:products')).toBe(`cache:agristore:products:s${CACHE_SCHEMA_VERSION}:ver`);
  });

  test('a schema bump yields a DISJOINT key space — every old key is missed', () => {
    const ns = 'agristore:products';
    // Same logical entries under two schema versions.
    const v1Keys = [0, 1, 2].map((v) => DATA_KEY(ns, v, 'hash', 1));
    const v2Keys = [0, 1, 2].map((v) => DATA_KEY(ns, v, 'hash', 2));

    // No overlap at all — a reader on schema 2 can never hit a schema-1 payload.
    const overlap = v1Keys.filter((k) => v2Keys.includes(k));
    expect(overlap).toHaveLength(0);

    // The version counter key is also schema-scoped, so the runtime counter resets
    // cleanly across a schema bump rather than being read from the old epoch.
    expect(VER_KEY(ns, 1)).not.toBe(VER_KEY(ns, 2));
  });

  test('within one schema, the runtime counter still partitions keys (write invalidation intact)', () => {
    expect(DATA_KEY('ns', 5, 'h')).not.toBe(DATA_KEY('ns', 6, 'h'));
  });
});

describe('generic cacheKey builder (config/redis.js)', () => {
  test('prefixes with the schema version', () => {
    expect(cacheKey('weather:pune')).toBe(`cache:s${CACHE_SCHEMA_VERSION}:weather:pune`);
  });

  test('a schema bump misses old generic keys', () => {
    expect(cacheKey('k', 1)).not.toBe(cacheKey('k', 2));
    expect(cacheKey('k', 1).startsWith('cache:s1:')).toBe(true);
    expect(cacheKey('k', 2).startsWith('cache:s2:')).toBe(true);
  });
});
