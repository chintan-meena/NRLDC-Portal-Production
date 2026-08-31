/**
 * auth/devices.js — Remembering browsers that have already passed an OTP.
 *
 * Why this exists: mail is the scarce resource. The portal's allowance is a
 * few hundred messages a day, and demanding a code at every login would spend
 * most of it on people who signed in yesterday from the same desk. Verifying a
 * code once registers that browser for `otpTrustDays` (7 by default), and
 * logins from it skip the code — turning "an OTP per login" into "an OTP per
 * user per week", roughly a sevenfold reduction.
 *
 * What keeps it honest:
 *   - Trust belongs to a browser, not to an account. The device holds a random
 *     32-byte secret; a password alone still cannot log in from anywhere else.
 *   - Only the SHA-256 of that secret is stored, so a database dump yields
 *     nothing usable. The token has full entropy, so a plain hash is the right
 *     tool here — bcrypt guards low-entropy secrets like passwords.
 *   - Trust expires on a fixed date rather than sliding forward on use, so a
 *     device cannot stay trusted indefinitely by being used often.
 *   - Changing a password, or an admin resetting one, drops every device for
 *     that account: whoever is being locked out should be locked out.
 */

const crypto = require('crypto');
const pool = require('../db');

const DEFAULT_TRUST_DAYS = 7;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** How long a device stays trusted. 0 disables the whole mechanism. */
async function trustDays() {
  try {
    const res = await pool.query("SELECT value FROM config WHERE key = 'otpTrustDays'");
    if (res.rows.length === 0) return DEFAULT_TRUST_DAYS;
    const n = parseInt(res.rows[0].value, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TRUST_DAYS;
  } catch {
    return DEFAULT_TRUST_DAYS;
  }
}

/**
 * Shorten a User-Agent to something an admin can recognise in a list. Best
 * effort only — it is a label, never a security control.
 */
function describeDevice(userAgent) {
  const ua = String(userAgent || '').slice(0, 300);
  if (!ua) return 'Unknown browser';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' :
    /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const platform =
    /Windows/.test(ua) ? 'Windows' :
    /Macintosh|Mac OS/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : '';
  return platform ? `${browser} on ${platform}` : browser;
}

/**
 * Register this browser as trusted. Returns the raw token to hand back to the
 * client, or null when device trust is switched off.
 */
async function rememberDevice(username, userAgent) {
  const days = await trustDays();
  if (days <= 0) return null;

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO trusted_devices (username, token_hash, label, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)`,
    [username, hashToken(token), describeDevice(userAgent), String(days)]
  );
  return token;
}

/**
 * Is this browser still trusted for this account?
 *
 * The username is checked alongside the token so a token cannot be replayed
 * against a different account, and `last_seen_at` is updated for the admin's
 * benefit — it does not extend the expiry.
 */
async function isDeviceTrusted(username, token) {
  if (!token || (await trustDays()) <= 0) return false;
  try {
    const res = await pool.query(
      `UPDATE trusted_devices
          SET last_seen_at = NOW()
        WHERE token_hash = $1
          AND LOWER(username) = LOWER($2)
          AND expires_at > NOW()
        RETURNING id`,
      [hashToken(token), username]
    );
    return res.rows.length > 0;
  } catch {
    // If the lookup fails, fall back to asking for a code — never the reverse.
    return false;
  }
}

/**
 * Drop every trusted device for an account. Called whenever the password
 * changes, by the user or by an admin: the point of a reset is to cut off
 * whoever should no longer have access, and a still-trusted browser would
 * quietly survive it.
 */
async function forgetDevices(username) {
  try {
    const res = await pool.query(
      'DELETE FROM trusted_devices WHERE LOWER(username) = LOWER($1) RETURNING id',
      [username]
    );
    return res.rowCount;
  } catch {
    return 0;
  }
}

/** Devices currently trusted for an account, newest first. */
async function listDevices(username) {
  const res = await pool.query(
    `SELECT id, label, created_at, last_seen_at, expires_at
       FROM trusted_devices
      WHERE LOWER(username) = LOWER($1) AND expires_at > NOW()
      ORDER BY last_seen_at DESC`,
    [username]
  );
  return res.rows;
}

async function pruneExpiredDevices() {
  try {
    await pool.query('DELETE FROM trusted_devices WHERE expires_at < NOW()');
  } catch { /* housekeeping only */ }
}

module.exports = {
  rememberDevice,
  isDeviceTrusted,
  forgetDevices,
  listDevices,
  pruneExpiredDevices,
  trustDays,
  describeDevice,
};
