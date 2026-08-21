#!/usr/bin/env bash
#
# Load test (claude.md §62, §63).
#
# §62 names six workflows and §63 names the levels — 100, 500, 1000, 2000, 5000
# concurrent — and asks for RPS, p50/p95/p99, error %, CPU, RAM, DB connections
# and DB CPU at each. This drives the read paths and collects all of it.
#
# ── What this deliberately does NOT do ───────────────────────────────────────
#
# It does not touch /ai/*. §62 is explicit: "AI load tests must avoid
# unintentionally spending real provider money. Mock providers unless explicitly
# running controlled integration tests." There is no mock provider wired here,
# so the AI scenario is OMITTED rather than approximated — a load test that
# silently bills Gemini is worse than one gap in the report.
#
# It does not write. Checkout, order confirm and booking take Serializable
# transactions against real stock, and hammering them against a database shared
# with the test suite would corrupt the fixtures rather than measure anything.
# Those paths already have concurrency tests that assert their correctness
# (booking-concurrency.test.js, shopReservation.api.test.js); what was missing
# was throughput on the READ paths, which is what carries the 100-300 req/s
# target in claude.md §1.
#
# ── Honesty about the environment ────────────────────────────────────────────
#
# This runs on ONE laptop: the load generator, the API and Postgres all compete
# for the same cores, and `ab` is single-threaded. So the absolute RPS is a
# floor, not a capacity figure, and the concurrency levels above a few hundred
# measure the harness as much as the server. What IS trustworthy is the SHAPE:
# where latency starts to bend, whether errors appear, whether the event loop
# blocks, and whether memory or DB connections climb and stay climbed.
#
# Usage:
#   PROFILE=1 PROFILE_OUT=/tmp/prof.ndjson npm start &
#   ./scripts/loadtest.sh 100 500 1000
set -uo pipefail

BASE="${BASE_URL:-http://localhost:3001/api/v1}"
REQ="${REQUESTS:-2000}"
OUT="${OUT_DIR:-/tmp/cropsetu-load}"
mkdir -p "$OUT"

# Read-only, unauthenticated endpoints. Authenticated ones would need a token per
# VU to be realistic — sharing one token measures the auth cache, not the app.
# Absolute URLs, because /healthz is mounted at the ROOT and not under the API
# prefix. Entries are "name|url".
#
# /animals is NOT here. It carries its own route-level search limiter on top of
# the global one ("Too many searches"), so driving it at load measures that
# limiter rather than the endpoint. That limiter is correct and stays — but it
# is worth knowing that it is keyed per IP, and a whole village behind one NAT
# shares that budget.
declare -a SCENARIOS=(
  "storefront|${BASE}/agristore/products?page=1&limit=20"
  "products50|${BASE}/agristore/products?page=1&limit=50"
  "categories|${BASE}/agristore/categories"
  "health|${ROOT:-http://127.0.0.1:3901}/healthz"
)

pg_conns() {
  psql "${PGURL:-}" -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()" 2>/dev/null || echo "?"
}

printf '%-12s %-6s %10s %8s %8s %8s %8s %7s %6s\n' \
  SCENARIO CONC RPS p50ms p95ms p99ms maxms ERR% DBCONN

for conc in "$@"; do
  for entry in "${SCENARIOS[@]}"; do
    name="${entry%%|*}"; url="${entry#*|}"
    # -k keep-alive: without it every request pays a TCP handshake and the test
    # measures connection setup rather than the API.
    log="$OUT/${name}-${conc}.txt"
    ab -k -n "$REQ" -c "$conc" -s 30 "$url" > "$log" 2>&1 || true

    rps=$(grep -m1 "Requests per second" "$log" | awk '{print $4}')
    p50=$(awk '/^  50%/{print $2; exit}' "$log")
    p95=$(awk '/^  95%/{print $2; exit}' "$log")
    p99=$(awk '/^  99%/{print $2; exit}' "$log")
    mx=$(awk '/^ 100%/{print $2; exit}' "$log")
    failed=$(grep -m1 "Failed requests" "$log" | awk '{print $3}')
    non2xx=$(grep -m1 "Non-2xx responses" "$log" | awk '{print $3}')
    failed=${failed:-0}; non2xx=${non2xx:-0}
    errpct=$(awk -v f="$failed" -v n="$non2xx" -v r="$REQ" 'BEGIN{printf "%.2f", ((f+n)/r)*100}')

    printf '%-12s %-6s %10s %8s %8s %8s %8s %7s %6s\n' \
      "$name" "$conc" "${rps:-?}" "${p50:-?}" "${p95:-?}" "${p99:-?}" "${mx:-?}" "$errpct" "$(pg_conns)"
  done
done

echo
echo "raw ab output: $OUT"
echo "profile (if PROFILE=1 was set): node scripts/profile.js --summarise \$PROFILE_OUT"
