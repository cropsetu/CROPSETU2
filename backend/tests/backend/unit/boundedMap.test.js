/**
 * BoundedMap — unit tests for the LRU + TTL bounds that keep in-memory
 * stores from leaking under sustained load.
 */
import { jest } from '@jest/globals';
import { BoundedMap } from '../../../src/utils/boundedMap.js';

describe('BoundedMap', () => {
  it('stores and retrieves values like a Map', () => {
    const m = new BoundedMap({ maxSize: 10 });
    m.set('a', 1).set('b', 2);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
    expect(m.get('missing')).toBeUndefined();
    expect(m.has('a')).toBe(true);
    expect(m.has('missing')).toBe(false);
  });

  it('enforces maxSize by evicting the least-recently-used key', () => {
    const m = new BoundedMap({ maxSize: 3 });
    m.set('a', 1).set('b', 2).set('c', 3);
    m.get('a'); // touch 'a' so 'b' is now the LRU
    m.set('d', 4); // over cap → evict LRU ('b')
    expect(m.size).toBe(3);
    expect(m.has('b')).toBe(false);
    expect(m.get('a')).toBe(1);
    expect(m.get('c')).toBe(3);
    expect(m.get('d')).toBe(4);
  });

  it('stays bounded under a flood of unique keys', () => {
    const m = new BoundedMap({ maxSize: 100 });
    for (let i = 0; i < 10_000; i++) m.set(`key-${i}`, i);
    expect(m.size).toBeLessThanOrEqual(100);
    // Most-recent insertions survive; oldest are gone.
    expect(m.get('key-9999')).toBe(9999);
    expect(m.get('key-0')).toBeUndefined();
  });

  it('expires entries after ttlMs', () => {
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const m = new BoundedMap({ maxSize: 10, ttlMs: 1000 });
      m.set('a', 1);
      now += 500;
      expect(m.get('a')).toBe(1); // still fresh
      now += 600; // total 1100ms > ttl
      expect(m.get('a')).toBeUndefined(); // expired
      expect(m.size).toBe(0); // dropped on access
    } finally {
      spy.mockRestore();
    }
  });

  it('sweep() drops only expired entries', () => {
    let now = 0;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const m = new BoundedMap({ maxSize: 10, ttlMs: 1000 });
      m.set('old', 1);
      now += 700;
      m.set('new', 2);
      now += 400; // 'old' is 1100ms (expired), 'new' is 400ms (fresh)
      expect(m.sweep()).toBe(1);
      expect(m.has('old')).toBe(false);
      expect(m.has('new')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an invalid maxSize', () => {
    expect(() => new BoundedMap({ maxSize: 0 })).toThrow();
    expect(() => new BoundedMap({ maxSize: -1 })).toThrow();
  });
});
