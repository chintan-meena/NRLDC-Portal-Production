#!/usr/bin/env node
/**
 * lb-soak.mjs — The same load test as lb-soak.js, with nothing to install.
 *
 * k6 is the better tool and lb-soak.js is the version to use for the real run:
 * it gives proper percentile accounting and a ramp scheduler. This exists so
 * the test can be run *now*, on any machine with Node, and so the setup can be
 * proved end to end before anyone waits on a k6 install.
 *
 * It measures the same things: which backend served each request, whether a
 * session survives being moved between them, latency percentiles per tier, and
 * errors classified by kind rather than lumped into one rate.
 *
 * Usage:
 *   node loadtest/lb-soak.mjs --url https://portal.example.in \
 *        --user loadtest@nrldc --pass 'secret'
 *   node loadtest/lb-soak.mjs --profile smoke        # short local run
 *   node loadtest/lb-soak.mjs --tiers 1,5,15,25,35 --step 45 --hold 180
 *
 * Read the warning in lb-soak.js about rate limits before pointing it at
 * production: every virtual user shares one account, so the per-user read limit
 * will engage on a long run at 35 concurrent.
 */

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ') || true])
);

const BASE = args.url || 'http://localhost:3001';
const USER = args.user || 'admin@nrldc';
const PASS = args.pass || 'Password@123';
const SMOKE = args.profile === 'smoke';

const TIERS = (args.tiers ? String(args.tiers).split(',').map(Number) : (SMOKE ? [2, 5] : [1, 5, 15, 25, 35]));
const STEP_SECONDS = Number(args.step || (SMOKE ? 6 : 45));
const HOLD_SECONDS = Number(args.hold || (SMOKE ? 6 : 180));

const B = '\x1b[1m', D = '\x1b[2m', R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', O = '\x1b[0m';

// ── Collected results ───────────────────────────────────────────────────────
const nodes = new Map();          // node id → request count
const errors = new Map();         // kind → count
const tiers = [];                 // per-concurrency-tier summaries
let sessionMoves = 0;
let authMismatches = 0;

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

/** Classify a failure by what it actually was — the kinds mean different things. */
function classify(err, status) {
  if (err) {
    const code = err.cause?.code || err.code || '';
    if (/CERT|TLS|SSL|EPROTO/i.test(code + err.message)) return 'tls-handshake';
    if (code === 'ECONNREFUSED') return 'connection-refused';
    if (code === 'ECONNRESET') return 'connection-reset';
    if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return 'connect-timeout';
    if (err.name === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'client-timeout';
    return `transport:${code || err.name}`;
  }
  if (status === 429) return 'rate-limited(429)';
  if (status === 502) return 'gateway(502)';
  if (status === 503) return 'unavailable(503)';
  if (status === 504) return 'gateway-timeout(504)';
  if (status === 401) return 'auth-mismatch(401)';
  if (status >= 500) return `server(${status})`;
  if (status >= 400) return `client(${status})`;
  return null;
}

async function request(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const ms = performance.now() - started;
    const node = res.headers.get('x-served-by') || 'unknown';
    bump(nodes, node);
    let body = null;
    try { body = await res.json(); } catch { /* not all responses are JSON */ }
    const kind = classify(null, res.status);
    if (kind) bump(errors, kind);
    return { ok: res.ok, status: res.status, ms, node, body, kind };
  } catch (err) {
    const ms = performance.now() - started;
    const kind = classify(err);
    bump(errors, kind);
    return { ok: false, status: 0, ms, node: null, body: null, kind };
  } finally {
    clearTimeout(timer);
  }
}

/** One virtual user: sign in once, then work, watching for the session breaking. */
async function virtualUser(deadline, samples) {
  let lastNode = null;

  while (performance.now() < deadline) {
    const login = await request(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    samples.push({ step: 'login', ms: login.ms, ok: login.ok });
    if (login.node) { if (lastNode && lastNode !== login.node) sessionMoves++; lastNode = login.node; }

    const token = login.body?.token;
    if (!token) {
      if (login.body?.requiresOTP) return { fatal: 'account requires an OTP — use one with bypass_2fa' };
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const auth = { headers: { Authorization: `Bearer ${token}` } };
    for (const [step, path] of [
      ['config', '/api/config'],
      ['list', '/api/discrepancies?limit=50&page=1'],
      ['list-p2', '/api/discrepancies?limit=50&page=2'],
      ['entities', '/api/users/wbes-entities'],
      ['health', '/api/health'],
    ]) {
      if (performance.now() >= deadline) break;
      const res = await request(`${BASE}${path}`, auth);
      samples.push({ step, ms: res.ms, ok: res.ok });
      if (res.node) { if (lastNode && lastNode !== res.node) sessionMoves++; lastNode = res.node; }
      // A 401 while carrying a token that just worked is the signature of the
      // backends not sharing one signing key.
      if (res.status === 401) authMismatches++;
      await new Promise(r => setTimeout(r, 30));
    }

    await request(`${BASE}/api/auth/logout`, { method: 'POST', ...auth });
  }
  return {};
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

async function runTier(concurrency, seconds) {
  const samples = [];
  const deadline = performance.now() + seconds * 1000;
  const started = performance.now();

  const results = await Promise.all(
    Array.from({ length: concurrency }, () => virtualUser(deadline, samples))
  );
  const fatal = results.find(r => r.fatal);
  if (fatal) {
    console.error(`\n  ${R}✗${O} ${fatal.fatal}`);
    process.exit(2);
  }

  const elapsed = (performance.now() - started) / 1000;
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const failed = samples.filter(s => !s.ok).length;

  const row = {
    concurrency,
    requests: samples.length,
    rps: samples.length / elapsed,
    p50: pct(times, 0.50), p95: pct(times, 0.95), p99: pct(times, 0.99),
    max: times[times.length - 1] || 0,
    errorRate: samples.length ? failed / samples.length : 0,
  };
  tiers.push(row);

  const flag = row.errorRate > 0.05 ? `${R}FAIL${O}` : row.errorRate > 0 ? `${Y}WARN${O}` : `${G}PASS${O}`;
  console.log(
    `  ${String(concurrency).padStart(3)} VU  ${String(row.requests).padStart(6)} req  ` +
    `${row.rps.toFixed(1).padStart(6)}/s   ` +
    `p50 ${row.p50.toFixed(0).padStart(5)}ms  p95 ${row.p95.toFixed(0).padStart(5)}ms  ` +
    `p99 ${row.p99.toFixed(0).padStart(6)}ms   ` +
    `err ${(row.errorRate * 100).toFixed(1).padStart(5)}%  ${flag}`
  );
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`\n${B}Load test — ${BASE}${O}`);
console.log(`${D}tiers ${TIERS.join(' → ')} concurrent · ${STEP_SECONDS}s per step · ${HOLD_SECONDS}s hold at peak${O}\n`);

const probe = await request(`${BASE}/api/health`);
if (!probe.ok) {
  console.error(`  ${R}✗${O} Health check failed (${probe.kind || probe.status}). Is the target up?`);
  process.exit(2);
}
console.log(`  ${G}✓${O} ${probe.body.node}  db ${probe.body.dbLatencyMs}ms  ` +
            `trustProxyHops=${probe.body.trustProxyHops}  forwardedFor=${probe.body.forwardedFor || 'none'}\n`);
if (probe.node === 'unknown') {
  console.log(`  ${Y}!${O} No X-Served-By header — requests cannot be attributed to a backend.`);
  console.log(`    Either the proxy strips it, or the deployed build predates it.\n`);
}
nodes.clear(); errors.clear();

for (const tier of TIERS) {
  const isPeak = tier === TIERS[TIERS.length - 1];
  await runTier(tier, isPeak ? HOLD_SECONDS : STEP_SECONDS);
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${B}Which backend served the load${O}`);
const total = [...nodes.values()].reduce((a, b) => a + b, 0);
const ranked = [...nodes.entries()].sort((a, b) => b[1] - a[1]);
for (const [node, count] of ranked) {
  const share = count / total;
  console.log(`  ${node.padEnd(34)} ${String(count).padStart(6)}  ${(share * 100).toFixed(1).padStart(5)}%  ` +
              '█'.repeat(Math.round(share * 36)));
}
if (ranked.length === 1) {
  console.log(`\n  ${Y}Only one backend answered.${O} Behind a 3-IP load balancer that means`);
  console.log('  either the LB pinned this client (IP-hash / sticky sessions), or two');
  console.log('  peers are out of rotation. Run from two different source addresses to');
  console.log('  tell those apart.');
} else {
  const spread = (ranked[0][1] - ranked[ranked.length - 1][1]) / total;
  console.log(`\n  ${ranked.length} backends · spread busiest-to-quietest ${(spread * 100).toFixed(1)}%`);
  console.log(`  ${D}even + sessions moving  → round-robin${O}`);
  console.log(`  ${D}even + sessions pinned  → IP-hash / sticky${O}`);
  console.log(`  ${D}uneven                  → least-connections, or a sick peer${O}`);
}
console.log(`  sessions moved between backends mid-run: ${sessionMoves}`);

console.log(`\n${B}Errors, by kind${O}`);
if (errors.size === 0) {
  console.log(`  ${G}none${O}`);
} else {
  for (const [kind, count] of [...errors.entries()].sort((a, b) => b[1] - a[1])) {
    const colour = kind.startsWith('rate-limited') ? Y : R;
    console.log(`  ${colour}${kind.padEnd(28)}${O} ${count}`);
  }
}
if (authMismatches > 0) {
  console.log(`\n  ${R}${authMismatches} session(s) were rejected while carrying a valid token.${O}`);
  console.log('  That is almost always the backends not sharing one SESSION_SECRET:');
  console.log('  each signs with its own key and refuses its siblings\'. DEPLOYMENT.md step 2.');
}
if (errors.has('rate-limited(429)')) {
  console.log(`\n  ${Y}429s are the portal defending itself, not a fault.${O} Every virtual user`);
  console.log('  shares one account and the read limit is per user — see the note in');
  console.log('  lb-soak.js before reading these as failures.');
}

const worst = tiers.reduce((a, b) => (b.errorRate > a.errorRate ? b : a), tiers[0]);
const passed = tiers.filter(t => t.errorRate <= 0.05).length;
console.log(`\n${B}${passed} of ${tiers.length} tiers within a 5% error budget.${O}` +
            (worst.errorRate > 0.05 ? `  Degrades from ${worst.concurrency} concurrent.` : ''));
console.log('');
