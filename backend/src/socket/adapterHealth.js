/**
 * Is cross-instance socket delivery working right now?
 *
 * Its own module because `server.js` sets it and `app.js` (/readyz) reads it,
 * and server.js imports app.js — importing back the other way would be a cycle.
 *
 * This state is worth surfacing because its failure is INVISIBLE from the
 * outside: with the Redis adapter down, every socket still connects, every
 * message still sends, and the sender still sees their own message. It is only
 * the recipients on OTHER replicas who get nothing. Chat looks fine to whoever
 * is testing it and is broken for half the users.
 *
 * `false` covers both shapes of that: the adapter never attached at boot (Redis
 * unreachable, in-memory fallback) and it attached and later dropped.
 */
let healthy = false;

export function setSocketAdapterHealthy(value) {
  healthy = !!value;
}

export function isSocketAdapterHealthy() {
  return healthy;
}

/**
 * Readiness label. Deliberately NOT a reason to fail readiness: pulling every
 * replica out of the load balancer because Redis blipped would turn a degraded
 * chat into a total outage. Report it, alert on it, keep serving.
 */
export function socketAdapterStatus() {
  return healthy ? 'ok' : 'degraded';
}
