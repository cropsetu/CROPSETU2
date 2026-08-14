/**
 * Feature-flag gate middleware — the kill switch for expensive routes.
 *
 * `requireFeature('ai_scan')` short-circuits with 503 when an admin has turned
 * that flag off in Ops → Feature Flags, and passes the admin's `disabledReason`
 * through so the client can explain itself instead of showing a generic error.
 *
 * Placed BEFORE the credit reserve on every AI route, so a disabled feature costs
 * the farmer nothing — no hold is taken and no refund is needed.
 *
 * Fails OPEN by construction: getFlag() returns enabled:true when the DB is
 * unreachable, so a database blip can never disable the product on its own. The
 * flag is read from a process-local cache invalidated across instances via Redis
 * pub/sub, so an admin toggle takes effect fleet-wide in milliseconds.
 */
import { getFlag } from '../services/featureFlag.service.js';
import { sendError } from '../utils/response.js';

const DEFAULT_MESSAGE = 'This feature is temporarily unavailable. Please try again later.';

export function requireFeature(featureKey, fallbackMessage = DEFAULT_MESSAGE) {
  return async (req, res, next) => {
    const { enabled, reason } = await getFlag(featureKey);
    if (enabled) return next();
    // 503 (not 403): this is a temporary operator-initiated pause, and clients
    // should treat it as retryable rather than as a permission problem.
    // The marker rides in `details` — sendError's 5th arg reads only requestId.
    return sendError(res, reason || fallbackMessage, 503, { featureKey, featureDisabled: true });
  };
}

export default requireFeature;
