#!/usr/bin/env node
/**
 * Admin API smoke test — logs in as an admin (phone OTP) and GETs every new v2
 * admin surface, reporting pass/fail. READ-ONLY (no mutations) so it's safe to run
 * against any environment, including production.
 *
 * Usage:
 *   ADMIN_BASE_URL=https://your-app.up.railway.app \
 *   ADMIN_PHONE=9876543210 \
 *   [ADMIN_OTP=000000] \
 *   node scripts/admin-smoke.mjs
 *
 * - ADMIN_BASE_URL defaults to http://localhost:3000
 * - ADMIN_OTP is optional: in dev the script auto-uses the devOtp returned by
 *   /auth/send-otp; otherwise pass the real OTP you receive by SMS.
 *
 * Exit code 0 if every required endpoint passed, 1 otherwise.
 * A 403 is reported as SCOPE (expected when the admin lacks that sub-role scope —
 * an admin with empty adminScopes is SUPER_ADMIN and should pass everything).
 */
const BASE = (process.env.ADMIN_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const PHONE = process.env.ADMIN_PHONE;
const OTP_ENV = process.env.ADMIN_OTP;

if (!PHONE) {
  console.error('ADMIN_PHONE is required (10-digit admin phone).');
  process.exit(2);
}

const GET_ENDPOINTS = [
  '/admin/me',
  '/admin/metrics?days=7',
  '/admin/settings',
  '/admin/settings/env-status',
  '/admin/settings/budget',
  '/admin/team',
  '/admin/users?limit=1',
  '/admin/returns?limit=1',
  '/admin/payouts?limit=1',
  '/admin/inventory/alerts?limit=1',
  '/admin/disputes?limit=1',
  '/admin/notification-templates?limit=1',
  '/admin/notifications/history?limit=1',
  '/admin/jobs/notifications',
  '/admin/error-logs?limit=1',
  '/admin/activity?limit=1',
];

async function login() {
  const send = await fetch(`${API}/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE }),
  });
  const sendBody = await send.json().catch(() => ({}));
  if (!send.ok) throw new Error(`send-otp failed (${send.status}): ${JSON.stringify(sendBody)}`);
  const devOtp = sendBody?.data?.devOtp;
  const otp = OTP_ENV || devOtp || '000000';
  if (!OTP_ENV && !devOtp) {
    console.warn('No ADMIN_OTP and no devOtp returned — trying 000000 (dev bypass).');
  }

  const verify = await fetch(`${API}/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, otp }),
  });
  const vBody = await verify.json().catch(() => ({}));
  if (!verify.ok) throw new Error(`verify-otp failed (${verify.status}): ${JSON.stringify(vBody)}`);
  const token = vBody?.data?.accessToken;
  const role = vBody?.data?.user?.role;
  if (!token) throw new Error('verify-otp returned no accessToken');
  if (role !== 'ADMIN') throw new Error(`account role is ${role}, not ADMIN`);
  return token;
}

async function check(path, token) {
  try {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 200) return { path, ok: true, label: 'PASS', status: 200 };
    if (res.status === 403) return { path, ok: true, label: 'SCOPE', status: 403 };
    return { path, ok: false, label: 'FAIL', status: res.status };
  } catch (err) {
    return { path, ok: false, label: 'ERROR', status: 0, err: err.message };
  }
}

(async () => {
  console.log(`\nAdmin smoke test → ${API}  (phone ${PHONE})\n`);
  let token;
  try {
    token = await login();
    console.log('✓ Logged in as ADMIN\n');
  } catch (err) {
    console.error(`✗ Login failed: ${err.message}`);
    process.exit(1);
  }

  const results = [];
  for (const path of GET_ENDPOINTS) {
    const r = await check(path, token);
    results.push(r);
    const mark = r.label === 'PASS' ? '✓' : r.label === 'SCOPE' ? '•' : '✗';
    console.log(`${mark} ${String(r.status).padEnd(3)} ${r.label.padEnd(5)} ${path}${r.err ? `  (${r.err})` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  const scoped = results.filter((r) => r.label === 'SCOPE');
  console.log(`\n${results.length - failed.length}/${results.length} ok` +
    (scoped.length ? ` (${scoped.length} scope-gated 403 — expected unless SUPER_ADMIN)` : '') +
    (failed.length ? ` — ${failed.length} FAILED` : ' — all good 🎉'));
  process.exit(failed.length ? 1 : 0);
})();
