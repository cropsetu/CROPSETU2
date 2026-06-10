/**
 * Soft-delete audit trail — every archive/restore of a resource must be
 * queryable in the AuditLog with the actor and a timestamp (RESOURCE_ARCHIVE /
 * RESOURCE_RESTORE). Covers the end-to-end route wiring and the shared
 * softDelete utility (incl. the restore path, which has no endpoint yet).
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestMachinery,
  cleanupTestData, prisma,
} from '../../fixtures/setup.js';
import { archiveResource, restoreResource } from '../../../src/services/softDelete.service.js';

let app;
let owner;

beforeAll(async () => {
  app = await getApp();
  owner = await createTestUser({ name: 'Listing Owner' });
});

afterAll(async () => {
  await cleanupTestData();
});

describe('Archive audit trail (end-to-end)', () => {
  test('archiving a machinery listing records a queryable RESOURCE_ARCHIVE event', async () => {
    const listing = await createTestMachinery(owner.user.id);

    const res = await request(app)
      .delete(`/api/v1/rent/machinery/${listing.id}`)
      .set(owner.headers);
    expect(res.status).toBe(200);

    // The event is queryable: action + entity + entityId, with actor + timestamp.
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'RESOURCE_ARCHIVE', entity: 'MachineryListing', entityId: listing.id },
    });
    expect(entry).toBeTruthy();
    expect(entry.userId).toBe(owner.user.id);   // who archived it
    expect(entry.createdAt).toBeInstanceOf(Date); // when
  });

  test('the listing is actually archived (status flipped to INACTIVE)', async () => {
    const listing = await createTestMachinery(owner.user.id);
    await request(app).delete(`/api/v1/rent/machinery/${listing.id}`).set(owner.headers);

    const row = await prisma.machineryListing.findUnique({ where: { id: listing.id } });
    expect(row.status).toBe('INACTIVE');
  });
});

describe('Archive + restore via the shared utility', () => {
  // No restore endpoint exists yet; exercise the utility directly to prove the
  // RESOURCE_RESTORE half of the trail is recorded when restore is wired up.
  test('restoreResource records a queryable RESOURCE_RESTORE event with the actor', async () => {
    const listing = await createTestMachinery(owner.user.id);
    const fakeReq = { user: { id: owner.user.id }, ip: '127.0.0.1', id: 'test-request-id' };

    await archiveResource(fakeReq, 'MachineryListing', listing.id);
    const restored = await restoreResource(fakeReq, 'MachineryListing', listing.id);
    expect(restored.status).toBe('ACTIVE'); // restore flipped it back

    const events = await prisma.auditLog.findMany({
      where: { entity: 'MachineryListing', entityId: listing.id, action: { in: ['RESOURCE_ARCHIVE', 'RESOURCE_RESTORE'] } },
      orderBy: { createdAt: 'asc' },
    });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('RESOURCE_ARCHIVE');
    expect(actions).toContain('RESOURCE_RESTORE');
    expect(events.every((e) => e.userId === owner.user.id)).toBe(true);
  });
});
