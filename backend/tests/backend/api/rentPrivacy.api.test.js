/**
 * Rent — privacy, phone ownership and booking money.
 *
 * These pin the rules that are easy to regress by adding one field to a select:
 * a listing's exact coordinates and its owner's phone number must not appear in
 * any public response, a lister may only publish their OWN number, and a
 * booking's price comes from the date range rather than from the client.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import {
  getApp, createTestUser, createTestMachinery, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/rent';
const PUNE = { lat: 18.5204, lng: 73.8567 };

let app;
let owner;
let renter;

async function makeLabour(providerId, overrides = {}) {
  return prisma.labourListing.create({
    data: {
      providerId,
      name: 'Harvest crew',
      skills: ['harvesting'],
      pricePerDay: 1800,
      groupSize: 6,
      location: 'Baramati',
      district: 'Pune',
      state: 'Maharashtra',
      status: 'ACTIVE',
      lat: PUNE.lat, lng: PUNE.lng,
      images: [],
      videos: [],
      languages: ['Marathi'],
      ...overrides,
    },
  });
}

beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await cleanupTestData(); await prisma.$disconnect(); });

beforeEach(async () => {
  await cleanupTestData();
  owner  = await createTestUser({ name: 'Owner' });
  renter = await createTestUser({ name: 'Renter' });
});

describe('coordinates and phone are not public', () => {
  it('keeps them out of the machinery list and detail', async () => {
    const listing = await createTestMachinery(owner.user.id, {
      lat: PUNE.lat, lng: PUNE.lng, ownerPhone: owner.user.phone,
    });

    const list = await request(app).get(`${API}/machinery`);
    expect(list.body.data[0].lat).toBeUndefined();
    expect(list.body.data[0].lng).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(owner.user.phone);

    const detail = await request(app).get(`${API}/machinery/${listing.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.lat).toBeUndefined();
    expect(detail.body.data.ownerPhone).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain(owner.user.phone);
    expect(detail.body.data.contactAvailable).toBe(true);
  });

  it('keeps them out of the labour list and detail', async () => {
    const l = await makeLabour(owner.user.id, { phone: owner.user.phone });

    const list = await request(app).get(`${API}/labour`);
    expect(list.body.data[0].lat).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(owner.user.phone);

    const detail = await request(app).get(`${API}/labour/${l.id}`);
    expect(detail.body.data.phone).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain(owner.user.phone);
  });

  it('does not release the number to a merely signed-in caller on detail', async () => {
    const listing = await createTestMachinery(owner.user.id, { ownerPhone: owner.user.phone });

    // This used to be the whole gate: any OTP account could walk the catalogue
    // and collect every owner's number, with no cap and no record.
    const detail = await request(app).get(`${API}/machinery/${listing.id}`).set(renter.headers);
    expect(JSON.stringify(detail.body)).not.toContain(owner.user.phone);
  });
});

describe('contact reveal', () => {
  it('requires authentication', async () => {
    const listing = await createTestMachinery(owner.user.id);
    expect((await request(app).get(`${API}/machinery/${listing.id}/contact`)).status).toBe(401);
  });

  it('returns the number to a signed-in renter and audits it', async () => {
    const listing = await createTestMachinery(owner.user.id, { ownerPhone: owner.user.phone });

    const res = await request(app).get(`${API}/machinery/${listing.id}/contact`).set(renter.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(owner.user.phone);
    expect(res.body.data.phoneLabel).toMatch(/^\+91 /);
    expect(res.body.data.hasBooking).toBe(false);

    await new Promise((r) => setTimeout(r, 120));
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'RENT_CONTACT_REVEAL', entityId: listing.id },
    });
    expect(audit).toBeTruthy();
    // The number must not be in the audit trail.
    expect(JSON.stringify(audit)).not.toContain(owner.user.phone);
  });

  it('works for labour too', async () => {
    const l = await makeLabour(owner.user.id, { phone: owner.user.phone });
    const res = await request(app).get(`${API}/labour/${l.id}/contact`).set(renter.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(owner.user.phone);
  });
});

describe('a lister may only publish their own number', () => {
  it('ignores someone else\'s number on create', async () => {
    const victim = '9876500011';

    const res = await request(app).post(`${API}/machinery`).set(owner.headers).send({
      name: 'Tractor', category: 'tractor', pricePerDay: 2000,
      location: 'Baramati', district: 'Pune',
      ownerPhone: victim, // "make this stranger's phone ring all season"
    });

    expect(res.status).toBe(201);
    const row = await prisma.machineryListing.findUnique({ where: { id: res.body.data.id } });
    expect(row.ownerPhone).toBe(owner.user.phone);
    expect(row.ownerPhone).not.toBe(victim);
  });

  it('ignores it on update as well', async () => {
    const listing = await createTestMachinery(owner.user.id, { ownerPhone: owner.user.phone });

    await request(app).put(`${API}/machinery/${listing.id}`).set(owner.headers)
      .send({ ownerPhone: '9876500022' });

    const row = await prisma.machineryListing.findUnique({ where: { id: listing.id } });
    expect(row.ownerPhone).toBe(owner.user.phone);
  });

  it('applies the same rule to a labour listing', async () => {
    const res = await request(app).post(`${API}/labour`).set(owner.headers).send({
      name: 'Crew', skills: ['weeding'], pricePerDay: 900,
      location: 'Baramati', district: 'Pune', phone: '9876500033',
    });

    const row = await prisma.labourListing.findUnique({ where: { id: res.body.data.id } });
    expect(row.phone).toBe(owner.user.phone);
  });
});

describe('stored XSS on the edit path', () => {
  it('strips HTML from an updated field, not just a created one', async () => {
    const listing = await createTestMachinery(owner.user.id);

    await request(app).put(`${API}/machinery/${listing.id}`).set(owner.headers)
      .send({ description: '<script>alert(1)</script>Good condition', name: '<b>Tractor</b>' });

    const row = await prisma.machineryListing.findUnique({ where: { id: listing.id } });
    expect(row.description).not.toContain('<script>');
    expect(row.description).toContain('Good condition');
    expect(row.name).not.toContain('<b>');
  });
});

describe('booking price', () => {
  it('derives the day count from the dates and ignores the client\'s', async () => {
    const listing = await createTestMachinery(owner.user.id, { pricePerDay: 1000 });
    const start = new Date(); start.setDate(start.getDate() + 10);
    const end   = new Date(start); end.setDate(end.getDate() + 9); // 10 inclusive days

    const res = await request(app).post(`${API}/bookings`).set(renter.headers).send({
      machineryListingId: listing.id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      days: 1,
      totalAmount: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.days).toBe(10);
    expect(res.body.data.totalAmount).toBe(10_000);
  });

  it('multiplies a labour booking by the worker count, server-side', async () => {
    const l = await makeLabour(owner.user.id, { pricePerDay: 500 });
    const start = new Date(); start.setDate(start.getDate() + 40);
    const end   = new Date(start); end.setDate(end.getDate() + 1); // 2 days

    const res = await request(app).post(`${API}/bookings`).set(renter.headers).send({
      labourListingId: l.id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      workerCount: 3,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(2 * 3 * 500);
  });

  it('refuses a booking for both a machine and a crew at once', async () => {
    const listing = await createTestMachinery(owner.user.id);
    const l = await makeLabour(owner.user.id);
    const start = new Date(); start.setDate(start.getDate() + 60);

    const res = await request(app).post(`${API}/bookings`).set(renter.headers).send({
      machineryListingId: listing.id, labourListingId: l.id,
      startDate: start.toISOString(), endDate: start.toISOString(),
    });

    expect(res.status).toBe(400);
  });

  it('refuses an absurdly long booking', async () => {
    const listing = await createTestMachinery(owner.user.id);
    const start = new Date(); start.setDate(start.getDate() + 5);
    const end   = new Date(start); end.setFullYear(end.getFullYear() + 3);

    const res = await request(app).post(`${API}/bookings`).set(renter.headers).send({
      machineryListingId: listing.id,
      startDate: start.toISOString(), endDate: end.toISOString(),
    });

    expect(res.status).toBe(400);
  });
});

describe('booking counterparty privacy', () => {
  async function book() {
    const listing = await createTestMachinery(owner.user.id, {
      pricePerDay: 1000, ownerPhone: owner.user.phone,
    });
    const start = new Date(); start.setDate(start.getDate() + 15);
    const end   = new Date(start); end.setDate(end.getDate() + 2);
    const res = await request(app).post(`${API}/bookings`).set(renter.headers).send({
      machineryListingId: listing.id,
      startDate: start.toISOString(), endDate: end.toISOString(),
    });
    return { listing, bookingId: res.body.data.id };
  }

  it('withholds both numbers while the request is still PENDING', async () => {
    const { bookingId } = await book();

    const ownerView = await request(app).get(`${API}/bookings/received`).set(owner.headers);
    expect(ownerView.body.data[0].user.phone).toBeUndefined();
    expect(JSON.stringify(ownerView.body)).not.toContain(renter.user.phone);
    expect(ownerView.body.data[0].contactsReleased).toBe(false);

    const renterView = await request(app).get(`${API}/bookings/${bookingId}`).set(renter.headers);
    expect(JSON.stringify(renterView.body)).not.toContain(owner.user.phone);
  });

  it('releases them once the owner confirms', async () => {
    const { bookingId } = await book();
    await request(app).put(`${API}/bookings/${bookingId}/approve`).set(owner.headers);

    const ownerView = await request(app).get(`${API}/bookings/received`).set(owner.headers);
    expect(ownerView.body.data[0].contactsReleased).toBe(true);
    expect(ownerView.body.data[0].user.phone).toBe(renter.user.phone);

    const renterView = await request(app).get(`${API}/bookings`).set(renter.headers);
    expect(renterView.body.data[0].machineryListing.ownerPhone).toBe(owner.user.phone);
  });

  it('still refuses a stranger', async () => {
    const { bookingId } = await book();
    const nosy = await createTestUser({ name: 'Nosy' });
    expect((await request(app).get(`${API}/bookings/${bookingId}`).set(nosy.headers)).status).toBe(403);
  });
});

describe('availability', () => {
  it('bounds the result and ignores a junk month window', async () => {
    const listing = await createTestMachinery(owner.user.id);

    const res = await request(app).get(`${API}/machinery/${listing.id}/availability`)
      .query({ year: 'abc', month: '99' });

    // An unparseable window used to build `new Date(NaN, …)` and silently match
    // nothing; it now falls back to "future bookings".
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
