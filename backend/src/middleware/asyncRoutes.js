/**
 * Make Express 4 survive an async handler that rejects.
 *
 * ── The failure this closes ──────────────────────────────────────────────────
 * Express 4 predates promises. It calls a handler and, if that handler returns a
 * rejected promise, nothing catches it: the router moves on, no response is ever
 * written, and the socket stays open until the client gives up. On a phone in a
 * field that is a spinner that never resolves — not an error the app can show, a
 * retry it can offer, or a status code anything can alert on. The request simply
 * disappears.
 *
 * `process.on('unhandledRejection')` in server.js keeps the PROCESS alive, which
 * is why this has never shown up as a crash. It does not answer the request.
 *
 * Most handlers wrap themselves in try/catch. "Most" is the problem: the ones
 * that forget are invisible until a farmer hits one, and every new route is a
 * fresh chance to forget. This removes the requirement rather than policing it.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Patches `Layer.prototype.handle_request`, the single funnel every non-error
 * route handler and middleware passes through, so a returned rejected promise is
 * forwarded to `next(err)`. From there the existing global error handler in
 * app.js answers with a safe 500 and writes an ErrorLog row — the same treatment
 * a synchronous `throw` already gets.
 *
 * Handlers with their own try/catch are completely unaffected: they never reject,
 * so the added `.catch` never fires. This is a floor, not a replacement — a
 * handler that can produce a meaningful message should still catch and say so.
 *
 * ── Why patch the Layer instead of wrapping each route ───────────────────────
 * The alternative is `asyncHandler(...)` on ~400 route registrations across
 * every module. That is a large diff through payment, order and KYC paths for no
 * behaviour change, and it still relies on nobody forgetting. One patch at the
 * framework seam covers every route that exists and every route added later.
 *
 * Call `installAsyncRouteSafety()` ONCE, before any router is created.
 */
import Layer from 'express/lib/router/layer.js';
import logger from '../utils/logger.js';

let installed = false;

/**
 * Adopt a handler's returned promise so a rejection becomes `next(err)`.
 *
 * The wrapper replaces `layer.handle` in place and is applied once per layer —
 * the `__asyncSafe` marker makes repeat dispatches of the same route cheap and
 * stops the wrapper from wrapping itself.
 *
 * `fn.length` is copied onto the wrapper because Express BRANCHES ON ARITY: a
 * 4-argument function is error-handling middleware and takes a different path.
 * Lose the arity and error middleware would silently be dispatched as ordinary
 * middleware — a far worse bug than the one being fixed.
 */
function adopt(fn) {
  const wrapped = function asyncSafeHandler(req, res, next) {
    let result;
    try {
      result = fn.call(this, req, res, next);
    } catch (err) {
      // Synchronous throw: Express's own try/catch in handle_request already
      // covers this, so rethrow and leave that path exactly as it was.
      throw err;
    }

    if (result && typeof result.then === 'function') {
      result.then(undefined, (err) => {
        // The handler responded and THEN rejected — usually a failed
        // fire-and-forget after res.json(). Calling next() here would try to
        // write headers twice; record it instead.
        if (res.headersSent) {
          logger.error(
            { err, requestId: req.id, path: req.path },
            '[asyncRoutes] handler rejected after responding',
          );
          return;
        }
        next(err);
      });
    }

    return result;
  };

  // Preserve arity — Express dispatches on it (see above).
  Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true });
  wrapped.__asyncSafe = true;
  return wrapped;
}

export function installAsyncRouteSafety() {
  // Idempotent: the test suite imports app.js repeatedly, and double-patching
  // would call next(err) twice for a single rejection.
  if (installed) return false;

  const original = Layer.prototype.handle_request;

  Layer.prototype.handle_request = function handleRequestAsyncSafe(req, res, next) {
    const fn = this.handle;

    // Wrap lazily, on first dispatch, and only once. Doing it here rather than
    // at route-registration time means routes registered before this installer
    // runs are covered too — which matters, because ESM hoists every route
    // module's evaluation above the install() call in app.js.
    if (typeof fn === 'function' && !fn.__asyncSafe) {
      this.handle = adopt(fn);
    }

    // Dispatch decisions (arity check, sync try/catch) stay with Express.
    return original.call(this, req, res, next);
  };

  installed = true;
  return true;
}

export default installAsyncRouteSafety;
