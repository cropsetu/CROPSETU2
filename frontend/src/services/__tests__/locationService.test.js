/**
 * locationService — the resolution ladder, the shared cache and the in-flight
 * de-duplication.
 *
 * These are the parts that used to be duplicated between LocationContext and
 * weatherApi, and the parts whose failure modes are invisible in the UI: a
 * stampede of GPS reads at launch, or a cached fix that is silently ignored,
 * both just look like "the app is a bit slow".
 *
 * The module keeps state at module scope (one fix per process, by design), so
 * every test re-imports it through jest.isolateModules for a clean slate.
 */

const FIX = (lat, lon) => ({ coords: { latitude: lat, longitude: lon } });

let mockLocation;
let mockCache;

function load() {
  let mod;
  jest.isolateModules(() => {
    mockLocation = {
      Accuracy: { Balanced: 3, Lowest: 1 },
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
      getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
      getCurrentPositionAsync: jest.fn().mockResolvedValue(FIX(19.1, 74.7)),
      reverseGeocodeAsync: jest.fn().mockResolvedValue([{ city: 'Nashik' }]),
    };
    mockCache = { store: null };

    jest.doMock('expo-location', () => mockLocation);
    jest.doMock('../../utils/secureCache', () => ({
      getSecureJSON: jest.fn(async () => mockCache.store),
      setSecureJSON: jest.fn(async (_k, v) => { mockCache.store = v; }),
    }));

    mod = require('../locationService');
  });
  return mod;
}

afterEach(() => { jest.resetModules(); });

describe('resolution ladder', () => {
  it('serves a fresh persisted fix without waking the GPS', async () => {
    const svc = load();
    mockCache.store = { lat: 19.1, lon: 74.7, city: 'Nashik', savedAt: Date.now() };

    const rec = await svc.resolveLocation();

    expect(rec).toMatchObject({ lat: 19.1, lon: 74.7, city: 'Nashik' });
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockLocation.getLastKnownPositionAsync).not.toHaveBeenCalled();
    // The cheap path must not even ask for permission — that is what makes a
    // warm start instant rather than merely fast.
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reads the device when the persisted fix is past its TTL', async () => {
    const svc = load();
    mockCache.store = {
      lat: 19.1, lon: 74.7, city: 'Nashik',
      savedAt: Date.now() - (svc.LOCATION_TTL_MS + 1_000),
    };

    await svc.resolveLocation();

    expect(mockLocation.getLastKnownPositionAsync).toHaveBeenCalled();
  });

  it('prefers the OS last-known fix over waking the GPS hardware', async () => {
    const svc = load();
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(FIX(18.5, 73.8));

    const rec = await svc.resolveLocation();

    expect(rec).toMatchObject({ lat: 18.5, lon: 73.8 });
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('drops to a coarse fix when the balanced one fails, rather than hanging', async () => {
    const svc = load();
    mockLocation.getCurrentPositionAsync
      .mockRejectedValueOnce(new Error('gps-timeout'))
      .mockResolvedValueOnce(FIX(21.0, 75.5));

    const rec = await svc.resolveLocation();

    expect(rec).toMatchObject({ lat: 21.0, lon: 75.5 });
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenNthCalledWith(
      2, { accuracy: mockLocation.Accuracy.Lowest },
    );
  });

  it('forces a device read when the caller explicitly refreshes', async () => {
    const svc = load();
    mockCache.store = { lat: 19.1, lon: 74.7, city: 'Nashik', savedAt: Date.now() };

    await svc.resolveLocation({ force: true });

    expect(mockLocation.getLastKnownPositionAsync).toHaveBeenCalled();
  });
});

describe('in-flight de-duplication', () => {
  it('collapses concurrent callers onto a single fix', async () => {
    const svc = load();
    // The ten screens that mount at launch must not each start their own read.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => svc.resolveLocation()),
    );

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toMatchObject({ lat: 19.1, lon: 74.7 });
  });

  it('allows a later call once the in-flight fix has settled', async () => {
    const svc = load();
    await svc.resolveLocation();
    await svc.resolveLocation({ force: true });

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(2);
  });
});

describe('permission', () => {
  it('reports denial as denial, not as a fix', async () => {
    const svc = load();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(svc.resolveLocation()).rejects.toThrow(/permission denied/i);
    expect(svc.getPermission()).toBe(svc.PERMISSION.DENIED);
  });

  it('recovers when permission is granted after a first denial', async () => {
    const svc = load();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(svc.resolveLocation()).rejects.toThrow();

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const rec = await svc.resolveLocation();

    expect(rec).toMatchObject({ lat: 19.1, lon: 74.7 });
    expect(svc.getPermission()).toBe(svc.PERMISSION.GRANTED);
  });
});

describe('sharing', () => {
  it('notifies subscribers so one screen\'s fix updates the others', async () => {
    const svc = load();
    const seen = [];
    svc.subscribe((snap) => seen.push(snap.location));

    await svc.resolveLocation();

    expect(seen.at(-1)).toMatchObject({ lat: 19.1, lon: 74.7 });
  });

  it('persists the fix so the next cold start does not pay for it again', async () => {
    const svc = load();
    await svc.resolveLocation();

    expect(mockCache.store).toMatchObject({ lat: 19.1, lon: 74.7 });
  });

  it('peeks at a stale fix, so a cold start can paint before it refreshes', async () => {
    const svc = load();
    mockCache.store = { lat: 19.1, lon: 74.7, city: 'Nashik', savedAt: 0 };

    const rec = await svc.peekLocationAsync();

    // Deliberately age-agnostic: an old fix is still the right weather cache key.
    expect(rec).toMatchObject({ lat: 19.1, lon: 74.7 });
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});
