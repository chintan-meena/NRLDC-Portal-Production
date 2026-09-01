/**
 * lb-soak.js — Concurrent load against the portal behind its load balancer.
 *
 * Answers three questions that a plain throughput test does not:
 *
 *   1. Which backend served each request, and how evenly is the load spread?
 *      Every response carries X-Served-By (hostname/pid, set in server/index.js),
 *      so each request can be attributed. The distribution is what tells you
 *      whether the LB is doing round-robin, least-connections or IP-hash.
 *
 *   2. Does a session survive being moved between backends? Each virtual user
 *      signs in once and keeps its token. If the LB moves it to another node
 *      mid-session and the token stops working, that shows up as an auth
 *      mismatch rather than as a generic error.
 *
 *   3. What kind of errors appear, not just how many. Connection resets, gateway
 *      timeouts and TLS failures each mean something different, and a single
 *      "error rate" hides which one you have.
 *
 * Usage:
 *   k6 run -e BASE_URL=https://portal.example.in \
 *          -e USERNAME=loadtest@nrldc -e PASSWORD='...' loadtest/lb-soak.js
 *
 *   # smaller, for a first pass or a local check
 *   k6 run -e BASE_URL=http://localhost:3001 -e PROFILE=smoke loadtest/lb-soak.js
 *
 * Install k6: brew install k6   (or https://k6.io/docs/get-started/installation/)
 *
 * ── Before pointing this at production ────────────────────────────────────
 * This signs in repeatedly and reads real endpoints. Two settings in the
 * portal will otherwise distort the result or lock the account out:
 *
 *   - RATE_LIMIT_AUTH is 20 failed sign-ins per 15 minutes, and lockoutAttempts
 *     locks an account after 3 wrong passwords. Use a real, working credential:
 *     successful sign-ins are not counted against the auth limit.
 *   - RATE_LIMIT_READ is 3000 reads per 15 minutes *per signed-in user*. Every
 *     virtual user here shares one account, so at 35 VUs a long run will hit
 *     that and report 429s that are the portal working correctly, not a
 *     failure. Either raise it for the test window, or read the 429 count as
 *     "the limiter engaged" rather than as an error.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const USERNAME = __ENV.USERNAME || 'admin@nrldc';
const PASSWORD = __ENV.PASSWORD || 'Password@123';
const PROFILE = __ENV.PROFILE || 'full';

// ── Metrics ─────────────────────────────────────────────────────────────────
const servedBy = new Counter('served_by');          // tagged per node
const nodeSeen = new Counter('distinct_node_hits');
const authMismatch = new Counter('errors_auth_mismatch');
const connError = new Counter('errors_connection');
const gatewayError = new Counter('errors_gateway');
const tlsError = new Counter('errors_tls');
const throttled = new Counter('responses_429_rate_limited');
const sessionHeld = new Rate('session_survived_request');
const nodeSwitches = new Counter('session_moved_between_nodes');
const loginTime = new Trend('login_duration', true);
const listTime = new Trend('discrepancy_list_duration', true);

// ── Ramp ────────────────────────────────────────────────────────────────────
// Steps of 30s with a 3-minute hold at the peak, so each tier has a stable
// window to read p95 from rather than a moving average across a ramp.
const RAMP = [
  { duration: '30s', target: 1 },
  { duration: '30s', target: 5 },
  { duration: '30s', target: 15 },
  { duration: '30s', target: 25 },
  { duration: '30s', target: 35 },
  { duration: '3m',  target: 35 },   // hold at peak
  { duration: '30s', target: 0 },
];

const SMOKE = [
  { duration: '10s', target: 3 },
  { duration: '20s', target: 5 },
  { duration: '10s', target: 0 },
];

export const options = {
  stages: PROFILE === 'smoke' ? SMOKE : RAMP,
  thresholds: {
    // Deliberately loose. A first run is for finding out where the cliff is,
    // not for passing — tighten these once you know the real numbers.
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    session_survived_request: ['rate>0.99'],
    errors_auth_mismatch: ['count<1'],
  },
  // Report the tiers separately rather than as one blended figure.
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Classify a failure by what it actually was. k6 puts transport failures in
 * error_code; HTTP-level gateway failures come back as a status.
 */
function classify(res) {
  if (res.error_code) {
    const code = res.error_code;
    // 1500-1599 are k6's TLS codes; 1210/1211 are refused/reset.
    if (code >= 1500 && code < 1600) { tlsError.add(1); return 'tls'; }
    if (code === 1210 || code === 1211 || code === 1212) { connError.add(1); return 'connection'; }
    connError.add(1);
    return `transport:${code}`;
  }
  if (res.status === 429) { throttled.add(1); return 'rate-limited'; }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    gatewayError.add(1);
    return `gateway:${res.status}`;
  }
  if (res.status === 0) { connError.add(1); return 'no-response'; }
  return null;
}

/** Record which backend answered, and whether the VU has been moved. */
function attribute(res, state) {
  const node = res.headers['X-Served-By'] || res.headers['x-served-by'] || 'unknown';
  servedBy.add(1, { node });
  if (state.lastNode && state.lastNode !== node) {
    nodeSwitches.add(1);
    state.movedThisIteration = true;
  }
  if (!state.lastNode) nodeSeen.add(1);
  state.lastNode = node;
  return node;
}

// ── Per-VU setup: one sign-in, then reuse the session ──────────────────────
export function setup() {
  const res = http.get(`${BASE}/api/health`, { tags: { name: 'health' } });
  const body = res.status === 200 ? res.json() : {};
  console.log(`Target: ${BASE}`);
  console.log(`Health: ${res.status} node=${body.node || 'unknown'} db=${body.db || '?'} ` +
              `trustProxyHops=${body.trustProxyHops ?? '?'} forwardedFor=${body.forwardedFor || 'none'}`);
  if (res.status !== 200) {
    console.warn('Health check did not return 200 — the run will still proceed, but check the target.');
  }
  return { startedAt: Date.now() };
}

export default function () {
  const state = { lastNode: null, movedThisIteration: false };

  // ── Sign in ───────────────────────────────────────────────────────────────
  const login = http.post(`${BASE}/api/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });

  loginTime.add(login.timings.duration);
  const loginProblem = classify(login);
  attribute(login, state);

  const body = login.status === 200 ? login.json() : {};
  const token = body.token;

  check(login, {
    'login returned 200': (r) => r.status === 200,
    'login issued a token or asked for an OTP': () => !!token || body.requiresOTP === true,
  });

  if (!token) {
    // requiresOTP means the account needs a code — it cannot be load-tested.
    // Anything else is a genuine failure, already classified above.
    if (body.requiresOTP) {
      console.error('The load-test account requires an OTP. Use an account with bypass_2fa, ' +
                    'or the run cannot proceed past sign-in.');
    }
    sleep(1);
    return;
  }

  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // ── Read the endpoints a real session actually uses ──────────────────────
  const journey = [
    { name: 'config', url: `${BASE}/api/config` },
    { name: 'discrepancy-list', url: `${BASE}/api/discrepancies?limit=50&page=1` },
    { name: 'discrepancy-page-2', url: `${BASE}/api/discrepancies?limit=50&page=2` },
    { name: 'wbes-entities', url: `${BASE}/api/users/wbes-entities` },
    { name: 'health', url: `${BASE}/api/health` },
  ];

  for (const step of journey) {
    const res = http.get(step.url, { ...auth, tags: { name: step.name } });
    const problem = classify(res);
    attribute(res, state);

    if (step.name === 'discrepancy-list') listTime.add(res.timings.duration);

    // A 401 on a request that carried a valid token is the signature of a
    // session breaking when the LB moved the client to another backend —
    // usually a SESSION_SECRET that differs between nodes.
    const brokeSession = res.status === 401;
    if (brokeSession) {
      authMismatch.add(1);
      console.error(`Session lost on ${step.name} after being served by ${state.lastNode}` +
                    (state.movedThisIteration ? ' (this VU was moved between nodes)' : ''));
    }
    sessionHeld.add(!brokeSession);

    check(res, {
      [`${step.name} ok`]: (r) => r.status === 200,
    });

    if (problem) {
      console.warn(`${step.name}: ${problem} (status ${res.status})`);
    }

    sleep(0.3);
  }

  // Sign out so revoked-token rows do not pile up over a long run.
  http.post(`${BASE}/api/auth/logout`, null, { ...auth, tags: { name: 'logout' } });

  sleep(1);
}

// ── Summary ─────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const lines = [];
  const m = data.metrics;
  const val = (name, stat = 'count') => (m[name] && m[name].values[stat] != null ? m[name].values[stat] : 0);

  lines.push('');
  lines.push('════ Load balancer behaviour ══════════════════════════════════');

  // Per-node request counts, from the tagged counter.
  const nodes = {};
  for (const [key, metric] of Object.entries(m)) {
    if (key.startsWith('served_by{')) {
      const node = key.slice('served_by{node:'.length, -1);
      nodes[node] = metric.values.count;
    }
  }
  const total = Object.values(nodes).reduce((a, b) => a + b, 0);
  if (total === 0) {
    lines.push('  No X-Served-By headers seen. Either the proxy strips them, or the');
    lines.push('  build in front of the LB predates the header. Without it, requests');
    lines.push('  cannot be attributed to a backend.');
  } else {
    const entries = Object.entries(nodes).sort((a, b) => b[1] - a[1]);
    for (const [node, count] of entries) {
      const pct = ((count / total) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / total * 40));
      lines.push(`  ${node.padEnd(32)} ${String(count).padStart(6)}  ${pct.padStart(5)}%  ${bar}`);
    }
    lines.push('');
    const spread = entries.length > 1
      ? (entries[0][1] - entries[entries.length - 1][1]) / total
      : 0;
    lines.push(`  ${entries.length} backend(s) seen. Spread between busiest and quietest: ${(spread * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('  Reading the distribution:');
    lines.push('    even split, VUs moving freely        → round-robin');
    lines.push('    even split, each VU pinned to a node → IP-hash / sticky sessions');
    lines.push('    uneven split favouring one node      → least-connections, or a sick peer');
    lines.push(`    times a session was moved mid-run: ${val('session_moved_between_nodes')}`);
  }

  lines.push('');
  lines.push('════ Errors, by kind ══════════════════════════════════════════');
  lines.push(`  connection refused / reset / transport : ${val('errors_connection')}`);
  lines.push(`  gateway 502 / 503 / 504               : ${val('errors_gateway')}`);
  lines.push(`  TLS handshake                         : ${val('errors_tls')}`);
  lines.push(`  session lost after a valid sign-in    : ${val('errors_auth_mismatch')}`);
  lines.push(`  429 rate-limited (portal working)     : ${val('responses_429_rate_limited')}`);
  lines.push('');
  if (val('errors_auth_mismatch') > 0) {
    lines.push('  A session lost mid-run almost always means the backends do not share');
    lines.push('  one SESSION_SECRET. Each process signs tokens with its own key and');
    lines.push('  rejects its siblings\' — see DEPLOYMENT.md step 2.');
    lines.push('');
  }

  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }) + lines.join('\n') + '\n',
    'loadtest/last-run.json': JSON.stringify(data, null, 2),
  };
}
