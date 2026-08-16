/**
 * Shop data layer — the network rules the Shop screens were missing.
 *
 * These are the behaviours that only show up on a bad connection, which is the
 * connection this app is actually used on: a stale search response overwriting a
 * newer one, an error wiping the screen, and full-resolution images being pulled
 * into 130px boxes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRequestLane, classifyError, thumbUrl, detailImageUrl,
  readCache, writeCache, inr, discountPct, retryRead,
  pushRecentSearch, readRecentSearches, clearRecentSearches,
  SHOP_ERRORS, SHOP_ACTIONS,
} from '../shopUtils';

beforeEach(async () => { await AsyncStorage.clear(); });

// ── The stale-response race ───────────────────────────────────────────────────
describe('createRequestLane', () => {
  const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  test('a SLOW EARLIER response is marked stale and never rendered', async () => {
    // The exact scenario: type "urea", then "urea 50". On a slow link the first
    // request can resolve LAST, and the old code would have rendered its results
    // on top of the newer ones.
    const lane = createRequestLane();
    const first = deferred();
    const second = deferred();

    const p1 = lane.send(() => first.promise);
    const p2 = lane.send(() => second.promise);

    second.resolve({ items: ['urea 50 result'] });
    first.resolve({ items: ['urea result'] });   // resolves LAST

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.stale).toBe(true);        // dropped
    expect(r1.data).toBeUndefined();
    expect(r2.stale).toBe(false);
    expect(r2.data.items).toEqual(['urea 50 result']);
  });

  test('aborts the superseded request instead of letting it finish', async () => {
    const lane = createRequestLane();
    let firstSignal = null;

    lane.send((signal) => { firstSignal = signal; return new Promise(() => {}); });
    expect(firstSignal.aborted).toBe(false);

    lane.send(() => Promise.resolve({ ok: true }));
    // Bandwidth on a village connection is worth more than a response nobody
    // will render.
    expect(firstSignal.aborted).toBe(true);
  });

  test('a stale FAILURE is dropped too, so it cannot raise an alert', async () => {
    const lane = createRequestLane();
    const first = deferred();

    const p1 = lane.send(() => first.promise);
    const p2 = lane.send(() => Promise.resolve({ items: [] }));

    first.reject(Object.assign(new Error('Network Error'), { message: 'Network Error' }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.stale).toBe(true);
    expect(r1.error).toBeUndefined();
    expect(r2.stale).toBe(false);
  });

  test('a current failure IS delivered, classified', async () => {
    const lane = createRequestLane();
    const { stale, error } = await lane.send(() =>
      Promise.reject(Object.assign(new Error('Network Error'), {
        message: 'Network Error',
        userMessage: 'No internet connection. Please try again.',
      })));

    expect(stale).toBe(false);
    expect(error.code).toBe(SHOP_ERRORS.OFFLINE);
    expect(error.action).toBe(SHOP_ACTIONS.RETRY);
  });
});

// ── Error classification ──────────────────────────────────────────────────────
describe('classifyError', () => {
  const withStatus = (status, data) => ({
    response: { status, data },
    userMessage: 'safe message',
  });

  test('a cancelled request is NOT an error', () => {
    expect(classifyError({ code: 'ERR_CANCELED' })).toBeNull();
    expect(classifyError({ name: 'CanceledError' })).toBeNull();
  });

  test.each([
    [401, SHOP_ERRORS.AUTH, SHOP_ACTIONS.SIGN_IN],
    [404, SHOP_ERRORS.NOT_FOUND, SHOP_ACTIONS.RETRY],
    [409, SHOP_ERRORS.CONFLICT, SHOP_ACTIONS.UPDATE_CART],
    [429, SHOP_ERRORS.RATE_LIMITED, SHOP_ACTIONS.RETRY],
    [503, SHOP_ERRORS.MAINTENANCE, SHOP_ACTIONS.RETRY],
    [500, SHOP_ERRORS.SERVER, SHOP_ACTIONS.RETRY],
  ])('%i → %s with the %s action', (status, code, action) => {
    const info = classifyError(withStatus(status));
    expect(info.code).toBe(code);
    // Every error carries the ONE thing the farmer should do next. Before this,
    // a 401 and a 500 both produced "no products".
    expect(info.action).toBe(action);
  });

  test('offline and timeout are distinguished — the recovery differs', () => {
    expect(classifyError({ message: 'Network Error' }).code).toBe(SHOP_ERRORS.OFFLINE);
    expect(classifyError({ code: 'ECONNABORTED' }).code).toBe(SHOP_ERRORS.TIMEOUT);
  });

  test('surfaces the structured issues and request id the backend attaches', () => {
    const info = classifyError(withStatus(409, {
      error: {
        message: 'blocked',
        requestId: 'req-123',
        details: {
          issues: [{ code: 'INSUFFICIENT_STOCK', message: 'Only 3 left', available: 3 }],
          reason: 'EXPIRED_STOCK',
        },
      },
    }));

    expect(info.issues[0].code).toBe('INSUFFICIENT_STOCK');
    expect(info.reason).toBe('EXPIRED_STOCK');
    expect(info.requestId).toBe('req-123');
  });

  test('never surfaces a raw server string — only the sanitised userMessage', () => {
    const info = classifyError({
      response: { status: 500, data: { error: { message: 'PrismaClientKnownRequestError: relation "orders" ...' } } },
      userMessage: 'Server error. Please try again later.',
    });
    expect(info.message).toBe('Server error. Please try again later.');
    expect(info.message).not.toMatch(/Prisma|relation/);
  });
});

// ── Images ────────────────────────────────────────────────────────────────────
describe('thumbUrl', () => {
  const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/products/urea.jpg';

  test('inserts a width-limited, auto-format transformation', () => {
    const out = thumbUrl(CLOUDINARY, 320);
    expect(out).toContain('/upload/f_auto,q_auto,c_limit,w_320/');
    expect(out).toContain('products/urea.jpg');
  });

  test('is idempotent — never transforms an already-transformed URL twice', () => {
    const once = thumbUrl(CLOUDINARY, 320);
    expect(thumbUrl(once, 320)).toBe(once);
  });

  test('leaves a non-Cloudinary URL untouched', () => {
    const external = 'https://example.com/img/urea.png';
    expect(thumbUrl(external)).toBe(external);
  });

  test('survives null / undefined without throwing', () => {
    expect(thumbUrl(null)).toBeNull();
    expect(thumbUrl(undefined)).toBeUndefined();
  });

  test('the detail gallery asks for a bigger image than a card does', () => {
    expect(detailImageUrl(CLOUDINARY)).toContain('w_900');
    expect(thumbUrl(CLOUDINARY, 320)).toContain('w_320');
  });
});

// ── Offline cache ─────────────────────────────────────────────────────────────
describe('offline cache', () => {
  test('round-trips a payload and reports its age', async () => {
    await writeCache('products:all', [{ id: 'p1' }]);
    const hit = await readCache('products:all');

    expect(hit.data).toEqual([{ id: 'p1' }]);
    // The screen SAYS how old the cached results are. Showing stale prices
    // unlabelled is worse than showing nothing.
    expect(hit.ageMs).toBeGreaterThanOrEqual(0);
    expect(hit.ageMs).toBeLessThan(5000);
  });

  test('a miss is null, not a throw', async () => {
    expect(await readCache('nothing-here')).toBeNull();
  });

  test('a corrupt entry is treated as a miss rather than crashing the shop', async () => {
    await AsyncStorage.setItem('@shop_cache:broken', '{not json');
    expect(await readCache('broken')).toBeNull();
  });

  test('entries older than the max age are ignored', async () => {
    const ancient = Date.now() - 48 * 60 * 60 * 1000;
    await AsyncStorage.setItem(
      '@shop_cache:old',
      JSON.stringify({ cachedAt: ancient, data: [{ id: 'stale' }] }),
    );
    expect(await readCache('old')).toBeNull();
  });
});

// ── Recent searches ───────────────────────────────────────────────────────────
describe('recent searches', () => {
  test('most recent first, de-duplicated case-insensitively', async () => {
    await pushRecentSearch('urea');
    await pushRecentSearch('dap');
    await pushRecentSearch('UREA');

    expect(await readRecentSearches()).toEqual(['UREA', 'dap']);
  });

  test('ignores terms too short to be a real search', async () => {
    await pushRecentSearch('u');
    await pushRecentSearch('   ');
    expect(await readRecentSearches()).toEqual([]);
  });

  test('is capped so the list stays usable', async () => {
    for (let i = 0; i < 20; i++) await pushRecentSearch(`term${i}`);
    expect((await readRecentSearches()).length).toBeLessThanOrEqual(8);
  });

  test('can be cleared', async () => {
    await pushRecentSearch('urea');
    await clearRecentSearches();
    expect(await readRecentSearches()).toEqual([]);
  });
});

// ── Money and discounts ───────────────────────────────────────────────────────
describe('inr', () => {
  test('groups the Indian way, not the device default', () => {
    // 12,34,567 — not 1,234,567. Every price on these screens was going through
    // a bare `.toLocaleString()` with no locale.
    expect(inr(1234567)).toBe('₹12,34,567');
    expect(inr(1000)).toBe('₹1,000');
  });

  test('never renders NaN at a farmer', () => {
    expect(inr(undefined)).toBe('₹0');
    expect(inr(null)).toBe('₹0');
    expect(inr('not a number')).toBe('₹0');
  });
});

describe('discountPct', () => {
  test('computes a real discount', () => {
    expect(discountPct(1000, 750)).toBe(25);
  });

  test('refuses to invent one', () => {
    // No MRP, an MRP equal to or below the price, or garbage → NO badge. The
    // screens must never advertise a discount nobody is giving.
    expect(discountPct(null, 750)).toBe(0);
    expect(discountPct(750, 750)).toBe(0);
    expect(discountPct(500, 750)).toBe(0);
    expect(discountPct('abc', 750)).toBe(0);
  });
});

// ── Bounded retry ─────────────────────────────────────────────────────────────
describe('retryRead', () => {
  test('retries a transient failure and succeeds', async () => {
    let calls = 0;
    const result = await retryRead(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('Network Error'), { message: 'Network Error' });
      return 'ok';
    }, { attempts: 3, baseMs: 1 });

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('does NOT retry an answer that will not change', async () => {
    let calls = 0;
    await expect(retryRead(async () => {
      calls += 1;
      throw { response: { status: 404 }, userMessage: 'not found' };
    }, { attempts: 3, baseMs: 1 })).rejects.toBeDefined();

    // Retrying a 404 just repeats the same answer more slowly.
    expect(calls).toBe(1);
  });

  test('is bounded — never retries forever', async () => {
    let calls = 0;
    await expect(retryRead(async () => {
      calls += 1;
      throw Object.assign(new Error('Network Error'), { message: 'Network Error' });
    }, { attempts: 3, baseMs: 1 })).rejects.toBeDefined();

    expect(calls).toBe(3);
  });
});
