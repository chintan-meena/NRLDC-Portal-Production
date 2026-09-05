/**
 * utils/settings.js — Reading settings, which are per-region except when they cannot be.
 *
 * Most settings belong to one despatch centre: the filing window, the re-raise
 * limits, the lockout threshold, whether OTP is required. A few describe things
 * there is only one of — one Brevo account, one daily mail allowance — and
 * those live under the reserved region 'GLOBAL'.
 *
 * Callers should not have to remember which is which, so they pass the region
 * they care about and this resolves it:
 *
 *   await getSetting('maxDays', 'ERLDC', 5)      → the ERLDC filing window
 *   await getSetting('mailDailyCap', 'ERLDC', 280) → the GLOBAL cap, region ignored
 *
 * Keep GLOBAL_KEYS in step with the schema's own list and with the writable
 * keys in routes/config.js.
 *
 * ── Caching ──
 * Settings change rarely but are read on the hottest paths — every login reads
 * the lockout threshold and the 2FA switch, every filing reads its window. Each
 * read used to be its own database round trip. Values are now cached in-process
 * for a short TTL and the cache is cleared on write, so a change still takes
 * effect within seconds while steady-state reads cost nothing.
 */

const pool = require('../db');

const GLOBAL_REGION = 'GLOBAL';
const DEFAULT_REGION = 'NRLDC';

/**
 * Settings that cannot differ between regions, because the thing they describe
 * is shared. Everything else is regional.
 */
const GLOBAL_KEYS = new Set([
  'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom',
  'otpTrustDays', 'resetOtpMinutes', 'mailDailyCap',
  // The password-recovery abuse throttle is national — one policy for the whole
  // portal, since it protects a public, account-less flow. See utils/resetAbuse.js.
  'resetAbuseEnabled', 'resetAbuseThreshold', 'resetAbuseBlockHours',
]);

const isGlobalKey = (key) => GLOBAL_KEYS.has(key);

/** Where a given key actually lives. */
function regionForKey(key, region) {
  return isGlobalKey(key) ? GLOBAL_REGION : (region || DEFAULT_REGION);
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// Keyed by the *resolved* region, so a global key is cached once under GLOBAL
// regardless of which region asked for it. A value of null means "queried, no
// row" — cached too, so a missing setting does not re-query on every read.

const CACHE_TTL_MS = parseInt(process.env.SETTINGS_CACHE_TTL_MS || '30000', 10);
const cache = new Map();

function cacheKeyFor(key, region) {
  return `${regionForKey(key, region)}:${key}`;
}

function cachePeek(key, region) {
  const k = cacheKeyFor(key, region);
  const hit = cache.get(k);
  if (hit && hit.expires > Date.now()) return hit;
  if (hit) cache.delete(k);
  return null;
}

function cachePut(key, region, value) {
  cache.set(cacheKeyFor(key, region), { value, expires: Date.now() + CACHE_TTL_MS });
}

/** Drop a cached value so the next read reflects a write immediately. */
function invalidateSetting(key, region) {
  cache.delete(cacheKeyFor(key, region));
}

/** Empty the whole cache — used by tests, and safe to call any time. */
function clearSettingsCache() {
  cache.clear();
}

/**
 * One setting as a string, or `fallback` when it has never been set.
 *
 * A missing row is normal rather than exceptional — a region added after a
 * setting was introduced has no row for it until someone saves one — so the
 * fallback is the documented path, not an error case.
 */
async function getSetting(key, region, fallback = null) {
  const cached = cachePeek(key, region);
  if (cached) return cached.value === null ? fallback : cached.value;
  try {
    const res = await pool.query(
      'SELECT value FROM config WHERE key = $1 AND region = $2',
      [key, regionForKey(key, region)]
    );
    const value = res.rows.length > 0 ? res.rows[0].value : null;
    cachePut(key, region, value);
    return value === null ? fallback : value;
  } catch {
    return fallback;   // never cache an error — the next read should retry
  }
}

/** One setting as an integer, falling back when missing or unparseable. */
async function getNumber(key, region, fallback) {
  const raw = await getSetting(key, region, null);
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** One setting as a boolean. Anything but the string 'false' is true. */
async function getBoolean(key, region, fallback) {
  const raw = await getSetting(key, region, null);
  if (raw === null) return fallback;
  return String(raw).toLowerCase() !== 'false';
}

/**
 * Several settings at once, as a plain object keyed by name. Global and
 * regional keys can be mixed freely; each is looked up where it lives.
 *
 * Cached values are served without a query; only the misses are fetched, and
 * their results (including "no row", cached as null) are written back.
 */
async function getSettings(keys, region) {
  const out = {};
  const misses = [];

  for (const key of keys) {
    const cached = cachePeek(key, region);
    if (cached) {
      if (cached.value !== null) out[key] = cached.value;
    } else {
      misses.push(key);
    }
  }
  if (misses.length === 0) return out;

  const globals = misses.filter(isGlobalKey);
  const regionals = misses.filter(k => !isGlobalKey(k));
  const found = new Set();

  if (regionals.length > 0) {
    const res = await pool.query(
      'SELECT key, value FROM config WHERE key = ANY($1) AND region = $2',
      [regionals, region || DEFAULT_REGION]
    );
    res.rows.forEach(r => { out[r.key] = r.value; cachePut(r.key, region, r.value); found.add(r.key); });
  }
  if (globals.length > 0) {
    const res = await pool.query(
      'SELECT key, value FROM config WHERE key = ANY($1) AND region = $2',
      [globals, GLOBAL_REGION]
    );
    res.rows.forEach(r => { out[r.key] = r.value; cachePut(r.key, region, r.value); found.add(r.key); });
  }
  // Cache the misses that had no row, so they do not re-query every call.
  for (const key of misses) if (!found.has(key)) cachePut(key, region, null);

  return out;
}

/** Write one setting to wherever that key lives, and drop it from the cache. */
async function setSetting(key, region, value, client = pool) {
  await client.query(
    `INSERT INTO config (key, region, value) VALUES ($1, $2, $3)
     ON CONFLICT (key, region) DO UPDATE SET value = $3`,
    [key, regionForKey(key, region), String(value)]
  );
  invalidateSetting(key, region);
}

module.exports = {
  GLOBAL_REGION,
  DEFAULT_REGION,
  GLOBAL_KEYS,
  isGlobalKey,
  regionForKey,
  getSetting,
  getNumber,
  getBoolean,
  getSettings,
  setSetting,
  invalidateSetting,
  clearSettingsCache,
};
