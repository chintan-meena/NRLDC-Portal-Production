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
]);

const isGlobalKey = (key) => GLOBAL_KEYS.has(key);

/** Where a given key actually lives. */
function regionForKey(key, region) {
  return isGlobalKey(key) ? GLOBAL_REGION : (region || DEFAULT_REGION);
}

/**
 * One setting as a string, or `fallback` when it has never been set.
 *
 * A missing row is normal rather than exceptional — a region added after a
 * setting was introduced has no row for it until someone saves one — so the
 * fallback is the documented path, not an error case.
 */
async function getSetting(key, region, fallback = null) {
  try {
    const res = await pool.query(
      'SELECT value FROM config WHERE key = $1 AND region = $2',
      [key, regionForKey(key, region)]
    );
    return res.rows.length > 0 ? res.rows[0].value : fallback;
  } catch {
    return fallback;
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
 */
async function getSettings(keys, region) {
  const wanted = [...keys];
  const globals = wanted.filter(isGlobalKey);
  const regionals = wanted.filter(k => !isGlobalKey(k));

  const out = {};
  if (regionals.length > 0) {
    const res = await pool.query(
      'SELECT key, value FROM config WHERE key = ANY($1) AND region = $2',
      [regionals, region || DEFAULT_REGION]
    );
    res.rows.forEach(r => { out[r.key] = r.value; });
  }
  if (globals.length > 0) {
    const res = await pool.query(
      'SELECT key, value FROM config WHERE key = ANY($1) AND region = $2',
      [globals, GLOBAL_REGION]
    );
    res.rows.forEach(r => { out[r.key] = r.value; });
  }
  return out;
}

/** Write one setting to wherever that key lives. */
async function setSetting(key, region, value, client = pool) {
  await client.query(
    `INSERT INTO config (key, region, value) VALUES ($1, $2, $3)
     ON CONFLICT (key, region) DO UPDATE SET value = $3`,
    [key, regionForKey(key, region), String(value)]
  );
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
};
