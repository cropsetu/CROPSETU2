/**
 * Unit test for parseInfoMemory (config/redis.js) — the pure parser that turns
 * Redis `INFO memory` output into the gauge fields exposed on /readyz.
 */
import { jest } from '@jest/globals';

// config/redis.js imports config/env.js at load; provide the vars env.js requires.
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/x';
process.env.JWT_SECRET = 'a'.repeat(32);

const { parseInfoMemory } = await import('../../../src/config/redis.js');

const SAMPLE = [
  '# Memory',
  'used_memory:1048576',
  'used_memory_human:1.00M',
  'used_memory_rss:2097152',
  'maxmemory:4194304',
  'maxmemory_human:4.00M',
  'maxmemory_policy:allkeys-lru',
  'mem_fragmentation_ratio:2.00',
  '',
].join('\r\n');

describe('parseInfoMemory', () => {
  test('extracts the memory gauge fields', () => {
    const m = parseInfoMemory(SAMPLE);
    expect(m.used_memory).toBe(1048576);
    expect(m.used_memory_rss).toBe(2097152);
    expect(m.maxmemory).toBe(4194304);
    expect(m.frag_ratio).toBe(2.0);
  });

  test('handles missing fields and non-string input without throwing', () => {
    const empty = parseInfoMemory('# Memory\r\n');
    expect(empty.used_memory).toBeNull();
    expect(empty.maxmemory).toBeNull();
    expect(parseInfoMemory(null).used_memory).toBeNull();
    expect(parseInfoMemory(undefined).maxmemory).toBeNull();
  });
});
