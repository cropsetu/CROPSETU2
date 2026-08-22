/**
 * Order-status pushes (claude.md §45).
 *
 * §45 lists order status among the things push exists for. It had no caller:
 * before today the only sendPushToUser sites were animaltrade chat, crop-report
 * shares, admin broadcast and the security paths.
 *
 * These assert the copy table's rules, which are the part with judgement in
 * them. The wiring itself is covered by catalogSplit.api.test.js, which drives a
 * real multi-seller order through CONFIRMED → SHIPPED → DELIVERED.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../../../src/routes/agristore.routes.js', import.meta.url), 'utf8');

describe('ORDER_STATUS_PUSH copy', () => {
  it('covers the four statuses a buyer cannot see without opening the app', () => {
    for (const s of ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']) {
      expect(SRC).toMatch(new RegExp(`${s}:\\s*\\{\\s*title:`));
    }
  });

  it('deliberately omits PENDING', () => {
    // PENDING is the state an order is CREATED in. Pushing it would notify a
    // farmer about something they just did on the screen in front of them.
    expect(SRC).not.toMatch(/PENDING:\s*\{\s*title:/);
  });

  it('carries no uuid in the body', () => {
    // Orders have no human-readable number; the only id is a uuid, and a uuid
    // fragment on a lock screen is noise. Identity rides in data.orderId, which
    // is what gets the farmer to the right screen.
    const block = SRC.slice(SRC.indexOf('const ORDER_STATUS_PUSH'), SRC.indexOf('/** Sorts that depend on OFFER'));
    expect(block).not.toMatch(/orderNumber|orderId|\$\{/);
  });

  it('sends only on a real rollup transition', () => {
    // One seller confirming their half of a two-seller order does not change the
    // ORDER's status. Pushing on every item update would send "your order is
    // confirmed" twice, which trains people to ignore the one that matters.
    expect(SRC).toMatch(/result\.orderStatus !== result\.previousStatus/);
  });

  it('pushes outside the Serializable transaction', () => {
    // A push is not worth holding a Serializable transaction open for, and a
    // queue hiccup must not roll back a status change the seller was already
    // told succeeded.
    const txEnd = SRC.indexOf("{ isolationLevel: 'Serializable' }");
    const push  = SRC.indexOf("type: 'ORDER_STATUS'");
    expect(push).toBeGreaterThan(txEnd);
  });

  it('never lets a push failure fail the request', () => {
    const idx = SRC.indexOf("type: 'ORDER_STATUS'");
    expect(SRC.slice(idx, idx + 400)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('deep-links to the order', () => {
    const idx = SRC.indexOf("type: 'ORDER_STATUS'");
    const block = SRC.slice(idx, idx + 400);
    expect(block).toMatch(/orderId/);
    expect(block).toMatch(/screen: 'OrderDetail'/);
  });
});
