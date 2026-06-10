/**
 * Per-user Socket.IO connection cap (SCALE-5 / socket lifecycle).
 *
 * Nothing currently limits how many simultaneous sockets one authenticated user
 * can open. A buggy client stuck in a reconnect loop — or a malicious one holding
 * a valid token — can open connections without bound, and each one is a live
 * WS/TCP handle plus room memberships and broadcast targets. Left unchecked that
 * exhausts file descriptors and memory on the instance.
 *
 * This registry tracks the live socket ids per user and refuses new connections
 * once a user is at the cap. It is the bookkeeping half; the socket handler calls
 * `tryAdd` on connect and `remove` on disconnect so counts track the real
 * lifecycle. The backing map is self-bounding: a user's entry is deleted the
 * moment their last socket disconnects, so idle users leave nothing behind.
 *
 * Per-instance by design. In a multi-instance deployment each process enforces
 * its own cap (so the per-process handle count is bounded — the actual resource
 * concern); a fleet-wide cap would need Redis and the socket lifecycle synced
 * across instances (pairs with SCALE-5).
 */
export class ConnectionRegistry {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxPerUser=10] max concurrent sockets per user.
   */
  constructor({ maxPerUser = 10 } = {}) {
    if (!Number.isInteger(maxPerUser) || maxPerUser < 1) {
      throw new Error('ConnectionRegistry: maxPerUser must be a positive integer');
    }
    this.maxPerUser = maxPerUser;
    this._byUser = new Map(); // userId -> Set<socketId>
  }

  /**
   * Register a socket for a user.
   * @returns {boolean} true if accepted, false if the user is at the cap (and the
   *                    socket was NOT added — the caller should disconnect it).
   */
  tryAdd(userId, socketId) {
    const set = this._byUser.get(userId);
    if (!set) {
      this._byUser.set(userId, new Set([socketId]));
      return true;
    }
    if (set.has(socketId)) return true;          // idempotent
    if (set.size >= this.maxPerUser) return false; // at cap → refuse
    set.add(socketId);
    return true;
  }

  /** Deregister a socket; drops the user's entry when their last socket leaves. */
  remove(userId, socketId) {
    const set = this._byUser.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this._byUser.delete(userId); // keep the map bounded
  }

  /** Live socket count for a user. */
  countFor(userId) {
    return this._byUser.get(userId)?.size || 0;
  }

  /** Number of users with at least one live socket. */
  get users() {
    return this._byUser.size;
  }

  /** Total sockets tracked across all users (for metrics). */
  get size() {
    let n = 0;
    for (const set of this._byUser.values()) n += set.size;
    return n;
  }
}

export default ConnectionRegistry;
