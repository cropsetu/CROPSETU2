/**
 * IP → geolocation resolver (FRAUD-4 support) — services/geoIp.service.js.
 *
 * isPublicIp is pure and tested directly. resolveIpGeo is verified to fail safe:
 * private IPs and (in this environment, where geoip-lite is not installed) public
 * IPs both resolve to null without throwing — the feature is inert until the
 * offline geo database is installed.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../src/config/redis.js', () => ({ default: { status: 'end' } })); // not ready → no cache

const { isPublicIp, resolveIpGeo, _resetGeoLibForTests } = await import('../../../src/services/geoIp.service.js');

describe('isPublicIp', () => {
  test.each([
    ['8.8.8.8', true],
    ['172.32.0.1', true],                 // just outside the 172.16/12 private block
    ['2001:4860:4860::8888', true],
    ['::ffff:8.8.8.8', true],             // IPv4-mapped public
  ])('%s → public', (ip, expected) => {
    expect(isPublicIp(ip)).toBe(expected);
  });

  test.each([
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['192.168.1.1'],
    ['172.16.5.5'],
    ['169.254.1.1'],
    ['100.64.0.1'],                       // CGNAT
    ['::1'],
    ['::ffff:127.0.0.1'],                 // IPv4-mapped loopback
    ['fe80::1'],
    ['fd00::1'],
    [''],
    ['not-an-ip'],
    [null],
    [undefined],
  ])('%s → not public', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});

describe('resolveIpGeo', () => {
  beforeEach(() => _resetGeoLibForTests());

  test('private IP → null (never looked up)', async () => {
    expect(await resolveIpGeo('192.168.0.10')).toBeNull();
  });

  test('public IP with no offline geo DB installed → null (inert, no throw)', async () => {
    expect(await resolveIpGeo('8.8.8.8')).toBeNull();
  });

  test('garbage input → null', async () => {
    expect(await resolveIpGeo('garbage')).toBeNull();
    expect(await resolveIpGeo(null)).toBeNull();
  });
});
