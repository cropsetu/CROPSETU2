/**
 * Voice-stream cancellation registry.
 *
 * The /ai/voice streaming pipeline runs in the BACKGROUND after the HTTP response
 * is sent, pushing audio chunks over Socket.IO. When the user leaves the voice
 * screen (back / tab switch / end call) the client emits `voice:cancel`; the
 * socket handler flips the flag here, and the pipeline (which checks it between
 * SSE frames and before each TTS/emit) aborts promptly — so it stops generating,
 * stops synthesising, stops emitting, and refunds the credit hold.
 *
 * Key = `${userId}:${streamId}`. Entries are removed when the pipeline finishes
 * (its finally block), so the map stays bounded.
 */
const registry = new Map(); // key -> { cancelled: boolean }

export function registerVoiceStream(key) {
  const state = { cancelled: false };
  registry.set(key, state);
  return state;
}

export function cancelVoiceStream(key) {
  const state = registry.get(key);
  if (state) state.cancelled = true;
  return !!state;
}

export function unregisterVoiceStream(key) {
  registry.delete(key);
}
