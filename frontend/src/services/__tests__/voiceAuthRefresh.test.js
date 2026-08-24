/**
 * Native voice upload must recover from an expired token (claude.md §46).
 *
 * Android's New Architecture drops file:// URIs from FormData, so voice cannot
 * go through axios on native and uses FileSystem.uploadAsync instead. Leaving
 * the axios pipeline also leaves behind its response interceptor — the thing
 * that refreshes an expired access token and replays the request.
 *
 * Access tokens live fifteen minutes. A farmer who opened the app, talked for
 * thirty seconds and hit an expired token got a bare 401: the recording was
 * discarded and they had to say it all again, while every other screen in the
 * app refreshed silently. On a voice-first product built for users who may not
 * read, that is the worst request in the app to make someone repeat.
 */
import { jest } from '@jest/globals';

const mockUploadAsync = jest.fn();
const mockGetAccessToken = jest.fn();
const mockForceRefresh = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...a) => mockUploadAsync(...a),
  FileSystemUploadType: { MULTIPART: 'multipart' },
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));
jest.mock('@krushisarva/shared/services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
  aiApi: { post: jest.fn(), get: jest.fn() },
  getAccessToken: (...a) => mockGetAccessToken(...a),
  forceRefreshAccessToken: (...a) => mockForceRefresh(...a),
}));
jest.mock('@krushisarva/shared/utils/mediaCompressor', () => ({ compressImage: jest.fn() }));
jest.mock('@krushisarva/shared/constants/config', () => ({ API_BASE_URL: 'https://api.test/api/v1' }));

const { sendVoiceMessage, sendVoiceChatMessage } = require('../aiApi');

const ok = (body) => ({ status: 200, body: JSON.stringify({ data: body }) });
const unauthorised = { status: 401, body: JSON.stringify({ error: { message: 'Token expired' } }) };
const authHeader = (call) => call[2].headers.Authorization;
const idemOf = (call) => call[2].headers['Idempotency-Key'];

beforeEach(() => {
  jest.clearAllMocks();
  // Not web: the native branch is the one under test.
  global.document = undefined;
});

describe('native voice upload — 401 recovery', () => {
  it('refreshes and replays instead of losing the recording', async () => {
    mockGetAccessToken.mockResolvedValue('stale-token');
    mockForceRefresh.mockResolvedValue('fresh-token');
    mockUploadAsync
      .mockResolvedValueOnce(unauthorised)
      .mockResolvedValueOnce(ok({ transcription: 'mera tamatar', reply: 'ok' }));

    const out = await sendVoiceMessage('file:///voice.m4a', null, {}, 'hi');

    expect(out.transcription).toBe('mera tamatar');
    expect(mockUploadAsync).toHaveBeenCalledTimes(2);
    expect(authHeader(mockUploadAsync.mock.calls[0])).toBe('Bearer stale-token');
    expect(authHeader(mockUploadAsync.mock.calls[1])).toBe('Bearer fresh-token');
  });

  it('replays under the SAME Idempotency-Key', async () => {
    // One logical voice turn. A fresh key would be the writeQueue bug again: a
    // turn that reached the server and charged a credit would charge a second.
    mockGetAccessToken.mockResolvedValue('stale-token');
    mockForceRefresh.mockResolvedValue('fresh-token');
    mockUploadAsync.mockResolvedValueOnce(unauthorised).mockResolvedValueOnce(ok({}));

    await sendVoiceMessage('file:///voice.m4a');

    const [first, second] = mockUploadAsync.mock.calls;
    expect(idemOf(first)).toBeTruthy();
    expect(idemOf(second)).toBe(idemOf(first));
  });

  it('gives up when the session is genuinely gone', async () => {
    // forceRefreshAccessToken resolves null when the refresh token is dead.
    // Retrying past that just delays the login prompt.
    mockGetAccessToken.mockResolvedValue('stale-token');
    mockForceRefresh.mockResolvedValue(null);
    mockUploadAsync.mockResolvedValue(unauthorised);

    await expect(sendVoiceMessage('file:///voice.m4a')).rejects.toMatchObject({ status: 401 });
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-401 failure', async () => {
    // 402 credit-exhausted is a real answer, not a stale token. Retrying it
    // would spend the farmer's time to be told the same thing.
    mockGetAccessToken.mockResolvedValue('t');
    mockUploadAsync.mockResolvedValue({
      status: 402, body: JSON.stringify({ error: { message: 'Out of AI credits' } }),
    });

    await expect(sendVoiceMessage('file:///voice.m4a')).rejects.toThrow('Out of AI credits');
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    expect(mockForceRefresh).not.toHaveBeenCalled();
  });

  it('preserves the axios error shape the screens map messages from', async () => {
    // humanReadableVoiceError reads err.response.data.error.message. Without
    // this shape the server's specific line is unreachable on native and the
    // generic fallback shows instead.
    mockGetAccessToken.mockResolvedValue('t');
    mockUploadAsync.mockResolvedValue({
      status: 429, body: JSON.stringify({ error: { message: 'Too many voice messages' } }),
    });

    await expect(sendVoiceMessage('file:///voice.m4a')).rejects.toMatchObject({
      status: 429,
      response: { status: 429, data: { error: { message: 'Too many voice messages' } } },
    });
  });

  it('covers the TTS voice-chat path too, not just plain voice', async () => {
    mockGetAccessToken.mockResolvedValue('stale-token');
    mockForceRefresh.mockResolvedValue('fresh-token');
    mockUploadAsync
      .mockResolvedValueOnce(unauthorised)
      .mockResolvedValueOnce(ok({ transcription: 'namaste', audio: 'base64' }));

    const out = await sendVoiceChatMessage('file:///voice.m4a', 'hi-IN', null, {}, true);

    expect(out.audio).toBe('base64');
    expect(mockUploadAsync).toHaveBeenCalledTimes(2);
    expect(authHeader(mockUploadAsync.mock.calls[1])).toBe('Bearer fresh-token');
  });

  it('sends tts and language through on the replay, not just on the first try', async () => {
    // The replay must be the same request. Rebuilding it wrong would return a
    // transcription with no audio and the screen would sit silent.
    mockGetAccessToken.mockResolvedValue('stale');
    mockForceRefresh.mockResolvedValue('fresh');
    mockUploadAsync.mockResolvedValueOnce(unauthorised).mockResolvedValueOnce(ok({}));

    await sendVoiceChatMessage('file:///v.m4a', 'mr-IN', 'conv_1', { crop: 'onion' }, true);

    const p = mockUploadAsync.mock.calls[1][2].parameters;
    expect(p).toMatchObject({ language: 'mr-IN', conversationId: 'conv_1', tts: 'true' });
    expect(JSON.parse(p.farmProfile)).toEqual({ crop: 'onion' });
  });
});
