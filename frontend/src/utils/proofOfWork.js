/**
 * Client-side proof-of-work solver for the OTP-send anti-abuse gate.
 *
 * When the server is "under suspicion" it answers /send-otp with HTTP 428 and a
 * challenge `{ challenge, difficulty, exp, sig }`. We must find a nonce such that
 * sha256(`${challenge}.${nonce}`) has `difficulty` leading zero bits, then resend
 * with the solution. This costs a human ~a second once; it makes automated bulk
 * sending expensive. The server remains authoritative (it re-verifies the work).
 */
import { sha256 } from 'js-sha256';

/** Count leading zero BITS of a hex digest (must match the backend). */
function leadingZeroBits(hex) {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble === 0) { bits += 4; continue; }
    bits += Math.clz32(nibble) - 28; // leading zeros within the 4-bit nibble
    break;
  }
  return bits;
}

/**
 * Solve a server-issued challenge. Returns the full solution object to echo back
 * (challenge + sig + nonce), or null if it gives up within the time budget.
 * Yields to the event loop between chunks so the UI stays responsive and Android
 * doesn't ANR during the hash loop.
 */
export async function solveProofOfWork(challenge, { maxMs = 20000 } = {}) {
  if (!challenge || typeof challenge.challenge !== 'string'
      || !Number.isInteger(challenge.difficulty)) {
    return null;
  }
  const { challenge: c, difficulty, exp, sig } = challenge;
  const start = Date.now();
  const CHUNK = 2000;
  let nonce = 0;

  for (;;) {
    for (let i = 0; i < CHUNK; i++, nonce++) {
      if (leadingZeroBits(sha256(`${c}.${nonce}`)) >= difficulty) {
        return { challenge: c, difficulty, exp, sig, nonce };
      }
    }
    if (Date.now() - start > maxMs) return null; // give up rather than hang
    await new Promise((r) => setTimeout(r, 0));   // yield
  }
}
