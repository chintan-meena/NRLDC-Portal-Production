/**
 * utils/resetAbuse.js — Throttle the password-recovery flow by source IP.
 *
 * Login has an account to lock; the recovery endpoints (forgot-password,
 * reset-password, request-password-reset) do not — they are reachable without
 * signing in, and a caller can spray junk usernames or reset codes at them with
 * nothing to stop them but the shared auth rate limiter. This adds a second,
 * longer guard aimed squarely at abuse: after `resetAbuseThreshold` failed
 * attempts from one IP within the counting window, that IP is blocked from the
 * recovery flow until `resetAbuseBlockHours` have passed.
 *
 * DB-backed (table password_reset_abuse) so a block survives a restart, and
 * configurable at the national level:
 *   resetAbuseEnabled    'true' | 'false'   (default true)
 *   resetAbuseThreshold  failed attempts before a block   (default 5)
 *   resetAbuseBlockHours how long the block lasts          (default 24)
 *
 * A *successful* reset clears the counter for that IP, so an honest user who
 * fat-fingers a code a few times and then gets it right is not left blocked.
 */

const pool = require('../db');
const { getBoolean, getNumber } = require('./settings');

const DEFAULT_THRESHOLD = 5;
const DEFAULT_BLOCK_HOURS = 24;
// Failures older than the block window no longer count toward a fresh block, so
// the counter is measured over a rolling window of the same length.
async function policy() {
  return {
    enabled: await getBoolean('resetAbuseEnabled', null, true),
    threshold: Math.max(1, await getNumber('resetAbuseThreshold', null, DEFAULT_THRESHOLD)),
    blockHours: Math.max(1, await getNumber('resetAbuseBlockHours', null, DEFAULT_BLOCK_HOURS)),
  };
}

/** Normalise an IP to a stable key; never throw on a missing one. */
function keyFor(ip) {
  return String(ip || 'unknown').slice(0, 64);
}

/**
 * Is this IP currently blocked? Returns { blocked, retryAfterMinutes }.
 * Fails open (blocked:false) on any error — a throttle must never be the reason
 * a legitimate reset cannot happen.
 */
async function isBlocked(ip) {
  try {
    const { enabled } = await policy();
    if (!enabled) return { blocked: false };
    const res = await pool.query(
      'SELECT blocked_until FROM password_reset_abuse WHERE ip = $1',
      [keyFor(ip)]
    );
    const until = res.rows[0]?.blocked_until;
    if (until && new Date(until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(until).getTime() - Date.now()) / 60000);
      return { blocked: true, retryAfterMinutes: mins };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

/**
 * Record one failed recovery attempt from this IP. When the count reaches the
 * threshold within the window, set the block. Best-effort; never throws.
 */
async function recordFailure(ip) {
  try {
    const { enabled, threshold, blockHours } = await policy();
    if (!enabled) return;
    const key = keyFor(ip);
    // Reset the running count if the last activity is older than the window, so
    // the threshold applies to a rolling window rather than for all time.
    const res = await pool.query(
      `INSERT INTO password_reset_abuse (ip, failed_count, first_failed_at, updated_at)
         VALUES ($1, 1, NOW(), NOW())
       ON CONFLICT (ip) DO UPDATE SET
         failed_count = CASE
           WHEN password_reset_abuse.updated_at < NOW() - ($2 || ' hours')::interval THEN 1
           ELSE password_reset_abuse.failed_count + 1 END,
         first_failed_at = CASE
           WHEN password_reset_abuse.updated_at < NOW() - ($2 || ' hours')::interval THEN NOW()
           ELSE password_reset_abuse.first_failed_at END,
         updated_at = NOW()
       RETURNING failed_count`,
      [key, String(blockHours)]
    );
    const count = res.rows[0]?.failed_count || 1;
    if (count >= threshold) {
      await pool.query(
        `UPDATE password_reset_abuse
            SET blocked_until = NOW() + ($2 || ' hours')::interval, updated_at = NOW()
          WHERE ip = $1`,
        [key, String(blockHours)]
      );
    }
  } catch { /* throttling is best-effort */ }
}

/** A successful reset clears the counter and any block for that IP. */
async function clearOnSuccess(ip) {
  try {
    await pool.query('DELETE FROM password_reset_abuse WHERE ip = $1', [keyFor(ip)]);
  } catch { /* best-effort */ }
}

/** Housekeeping: drop rows that are neither counting nor blocked any more. */
async function pruneExpired() {
  try {
    await pool.query(
      `DELETE FROM password_reset_abuse
        WHERE (blocked_until IS NULL OR blocked_until < NOW())
          AND updated_at < NOW() - INTERVAL '7 days'`
    );
  } catch { /* housekeeping only */ }
}

module.exports = { isBlocked, recordFailure, clearOnSuccess, pruneExpired };
