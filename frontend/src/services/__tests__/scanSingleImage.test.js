/**
 * A crop scan sends exactly ONE image.
 *
 * The diagnosis pipeline has been single-image since the backend half of the
 * multi-image feature was removed: FastAPI validates `images[:1]`
 * (routes/scan.py) and the Celery task materialises only "the FIRST valid
 * image" (jobs/tasks.py). The client kept advertising five, so four could be
 * compressed, base64-inflated ~1.37x, held in memory on a 2 GB Android, pushed
 * over a 3G link and parsed by Express — then thrown away.
 *
 * These tests pin the contract in both directions: exactly one image reaches
 * the wire even when several URIs are handed in, and the body stays an ARRAY of
 * one, which is the shape FastAPI reads.
 */
import { jest } from '@jest/globals';

// `__DEV__` is injected by the React Native runtime, not by jest. Pin it false
// so the module's dev-only console.warn branches behave as they do in a release
// build (and do not spray the test output).
global.__DEV__ = false;

jest.mock('@krushisarva/shared/services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
  aiApi: { post: jest.fn(), get: jest.fn() },
  getAccessToken: jest.fn(),
}));

jest.mock('@krushisarva/shared/utils/mediaCompressor', () => ({
  __esModule: true,
  compressImage: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

// Cuts the expo-constants → expo/virtual/env chain, which ships untranspiled
// ESM that jest-expo does not transform for this path.
jest.mock('@krushisarva/shared/constants/config', () => ({
  __esModule: true,
  API_BASE_URL: 'http://test.local/api/v1',
  STORAGE_KEYS: {},
}));

const api = require('@krushisarva/shared/services/api').default;
const { compressImage } = require('@krushisarva/shared/utils/mediaCompressor');
const { scanCropImage } = require('../aiApi');

/** The scan submit call, whatever else the function did. */
function submitBody() {
  const call = api.post.mock.calls.find(([url]) => url === '/ai/scan/submit');
  return call?.[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  compressImage.mockImplementation((uri) =>
    Promise.resolve({ uri, base64: `b64-of-${uri}` }),
  );
  // A terminal response so the function returns without entering the poll loop.
  api.post.mockResolvedValue({
    data: { data: { status: 'done', disease: 'Leaf rust', jobId: null } },
  });
});

describe('scanCropImage — one image on the wire', () => {
  test('a single URI sends one image', async () => {
    await scanCropImage(['file://leaf.jpg'], {}, ['image/jpeg']);

    expect(submitBody().images).toHaveLength(1);
    expect(compressImage).toHaveBeenCalledTimes(1);
  });

  test('five URIs still send one — and only one is ever compressed', async () => {
    const uris = ['a', 'b', 'c', 'd', 'e'].map((n) => `file://${n}.jpg`);
    await scanCropImage(uris, {}, uris.map(() => 'image/jpeg'));

    expect(submitBody().images).toHaveLength(1);
    // The point of the change: the discarded four never cost anything. If this
    // regresses, the app is paying to encode images the server will drop.
    expect(compressImage).toHaveBeenCalledTimes(1);
    expect(compressImage).toHaveBeenCalledWith('file://a.jpg', expect.anything());
  });

  test('the first URI is the one sent', async () => {
    await scanCropImage(['file://first.jpg', 'file://second.jpg']);
    expect(submitBody().images[0].data).toBe('b64-of-file://first.jpg');
  });

  test('a bare string URI still works', async () => {
    await scanCropImage('file://solo.jpg');
    expect(submitBody().images).toHaveLength(1);
  });

  test('the body stays an array — the shape FastAPI reads', async () => {
    await scanCropImage(['file://leaf.jpg']);
    const body = submitBody();

    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images[0]).toEqual(
      expect.objectContaining({ data: expect.any(String), mime_type: 'image/jpeg' }),
    );
  });

  test('mime type is carried through and normalised', async () => {
    await scanCropImage(['file://leaf.heic'], {}, ['image/heic']);
    expect(submitBody().images[0].mime_type).toBeTruthy();
  });
});

describe('scanCropImage — failure modes', () => {
  test('no image is a caller error', async () => {
    await expect(scanCropImage([])).rejects.toThrow(/image is required/i);
    expect(api.post).not.toHaveBeenCalled();
  });

  test('an unencodable image fails loudly instead of posting an empty scan', async () => {
    compressImage.mockRejectedValue(new Error('ImageManipulator exploded'));
    const FileSystem = require('expo-file-system/legacy');
    FileSystem.readAsStringAsync.mockRejectedValue(new Error('unreadable'));

    await expect(scanCropImage(['file://broken.jpg'])).rejects.toThrow(/could not encode/i);
    expect(api.post).not.toHaveBeenCalled();
  });
});
