/**
 * Moderation queue (FRAUD-5 → REV-5) — services/moderation.service.js.
 * prisma is module-mocked; verifies enqueue (idempotent upsert), queue listing,
 * and resolve (clear/remove) behaviour.
 */
import { jest } from '@jest/globals';

const upsert = jest.fn().mockResolvedValue({});
const findMany = jest.fn().mockResolvedValue([]);
const findUnique = jest.fn();
const update = jest.fn();

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { contentFlag: { upsert, findMany, findUnique, update } },
}));

const { enqueueFlag, listFlags, resolveFlag } = await import('../../../src/services/moderation.service.js');

beforeEach(() => {
  upsert.mockClear().mockResolvedValue({});
  findMany.mockClear().mockResolvedValue([]);
  findUnique.mockReset();
  update.mockReset().mockResolvedValue({});
});

describe('enqueueFlag', () => {
  test('upserts one flag per (entityType, entityId)', async () => {
    const ok = await enqueueFlag({ entityType: 'Review', entityId: 'r1', authorId: 'u1', reasons: ['burst'], score: 2 });
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType_entityId: { entityType: 'Review', entityId: 'r1' } },
      create: expect.objectContaining({ entityType: 'Review', entityId: 'r1', reasons: ['burst'], score: 2 }),
    }));
  });

  test('never throws — a DB failure returns false', async () => {
    upsert.mockRejectedValue(new Error('db down'));
    expect(await enqueueFlag({ entityType: 'Product', entityId: 'p1', reasons: [], score: 0 })).toBe(false);
  });
});

describe('listFlags', () => {
  test('defaults to PENDING, newest first, capped limit', async () => {
    await listFlags();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    }));
  });

  test('filters by entityType when given', async () => {
    await listFlags({ status: 'APPROVED', entityType: 'Product', limit: 1000 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'APPROVED', entityType: 'Product' });
    expect(arg.take).toBeLessThanOrEqual(200); // limit is capped
  });
});

describe('resolveFlag', () => {
  test('rejects an invalid resolution status', async () => {
    await expect(resolveFlag({ id: 'f1', status: 'PENDING' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('returns null when the flag does not exist', async () => {
    findUnique.mockResolvedValue(null);
    expect(await resolveFlag({ id: 'missing', status: 'APPROVED' })).toBeNull();
  });

  test('APPROVED → records reviewer, timestamp, note', async () => {
    findUnique.mockResolvedValue({ id: 'f1', status: 'PENDING' });
    await resolveFlag({ id: 'f1', status: 'REJECTED', reviewedById: 'admin1', note: 'fake' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'f1' },
      data: expect.objectContaining({ status: 'REJECTED', reviewedById: 'admin1', resolution: 'fake' }),
    }));
  });
});
