/**
 * Unit tests for keyset (cursor) pagination helpers.
 */
const { encodeCursor, decodeCursor } = await import('../../../src/utils/keyset.js');

const ROW = { id: 'abc-123', createdAt: new Date('2026-06-01T10:00:00.000Z') };

describe('encodeCursor / decodeCursor', () => {
  test('round-trips createdAt + id', () => {
    const c = encodeCursor(ROW);
    expect(typeof c).toBe('string');
    const back = decodeCursor(c);
    expect(back.id).toBe('abc-123');
    expect(back.createdAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
  });

  test('accepts a string createdAt', () => {
    const c = encodeCursor({ id: 'x', createdAt: '2026-06-01T10:00:00.000Z' });
    expect(decodeCursor(c).createdAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
  });

  test('encodeCursor returns null for incomplete rows', () => {
    expect(encodeCursor(null)).toBeNull();
    expect(encodeCursor({ id: 'x' })).toBeNull();
    expect(encodeCursor({ createdAt: new Date() })).toBeNull();
  });

  test('decodeCursor rejects malformed / non-string input', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(123)).toBeNull();
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
    expect(decodeCursor(Buffer.from('garbage-no-separator').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('not-a-date|id').toString('base64url'))).toBeNull();
  });

  test('a cursor at a tied timestamp keeps its distinct id (deterministic paging)', () => {
    const a = encodeCursor({ id: 'id-A', createdAt: ROW.createdAt });
    const b = encodeCursor({ id: 'id-B', createdAt: ROW.createdAt });
    expect(a).not.toBe(b);
    expect(decodeCursor(a).id).toBe('id-A');
    expect(decodeCursor(b).id).toBe('id-B');
  });
});
