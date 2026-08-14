/**
 * The on-device preferences behind "Change location" and recent searches.
 * These run against the in-memory AsyncStorage mock (see jest.config.js).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getManualLocation, setManualLocation,
  getRecentSearches, pushRecentSearch, clearRecentSearches,
  relativeTime,
} from '../animalPrefs';

beforeEach(async () => { await AsyncStorage.clear(); });

describe('manual location', () => {
  it('round-trips a hand-picked place', async () => {
    await setManualLocation({ label: 'Baramati, Pune' });
    const loc = await getManualLocation();
    expect(loc.label).toBe('Baramati, Pune');
    expect(typeof loc.savedAt).toBe('number');
  });

  it('returns null when nothing has been chosen', async () => {
    expect(await getManualLocation()).toBeNull();
  });

  it('forgets the place when cleared', async () => {
    await setManualLocation({ label: '413102', pincode: '413102' });
    await setManualLocation(null);
    expect(await getManualLocation()).toBeNull();
  });

  it('survives a corrupted stored value instead of throwing', async () => {
    // A half-written value must not crash the marketplace on launch.
    await AsyncStorage.setItem('@animals:manualLocation', '{not json');
    expect(await getManualLocation()).toBeNull();
  });
});

describe('recent searches', () => {
  it('keeps the newest first', async () => {
    await pushRecentSearch('murrah');
    await pushRecentSearch('gir');
    expect(await getRecentSearches()).toEqual(['gir', 'murrah']);
  });

  it('moves a repeated search to the front rather than duplicating it', async () => {
    await pushRecentSearch('murrah');
    await pushRecentSearch('gir');
    await pushRecentSearch('MURRAH'); // case-insensitive
    expect(await getRecentSearches()).toEqual(['MURRAH', 'gir']);
  });

  it('caps the list so it cannot grow without bound', async () => {
    for (let i = 0; i < 20; i++) await pushRecentSearch(`breed${i}`);
    const list = await getRecentSearches();
    expect(list).toHaveLength(6);
    expect(list[0]).toBe('breed19');
  });

  it('ignores one-character noise', async () => {
    await pushRecentSearch('g');
    await pushRecentSearch('  ');
    expect(await getRecentSearches()).toEqual([]);
  });

  it('clears on request', async () => {
    await pushRecentSearch('gir');
    await clearRecentSearches();
    expect(await getRecentSearches()).toEqual([]);
  });
});

describe('relativeTime', () => {
  it('describes how stale the cached listings are', () => {
    expect(relativeTime(Date.now() - 5_000)).toBe('just now');
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5 min ago');
    expect(relativeTime(Date.now() - 3 * 3_600_000)).toBe('3 hr ago');
    expect(relativeTime(Date.now() - 2 * 86_400_000)).toBe('2 d ago');
  });

  it('renders nothing when there is no timestamp', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime(0)).toBe('');
  });
});
