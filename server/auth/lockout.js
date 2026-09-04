/**
 * auth/lockout.js — When a locked account is actually locked.
 *
 * Two different things set `users.locked`:
 *
 *   1. The failed-attempt lockout in the login route. This is meant to be
 *      *temporary* — an attacker who knows a username (they are derived from
 *      public WBES acronyms) could otherwise lock any account for good with a
 *      handful of wrong passwords, and only an admin could undo it. So these
 *      locks carry a `locked_at` timestamp and expire on their own after a
 *      cooldown.
 *
 *   2. A deliberate admin lock (PATCH /:username/lock). That is a decision, not
 *      an accident, and must NOT auto-expire. These carry `locked_at = NULL`.
 *
 * The single rule that separates them: a lock auto-expires only when it has a
 * `locked_at` and the cooldown has passed. A NULL `locked_at` — an admin lock,
 * or a legacy row from before this column existed — stays locked until an
 * administrator unlocks it. That is deliberately the safe default.
 */

// The cooldown a region falls back to when `lockoutMinutes` is unset.
const DEFAULT_LOCKOUT_MINUTES = 60;

/**
 * Whether `user` is locked *right now*, given the region's cooldown.
 *
 * @param {{locked: boolean, locked_at: (Date|string|null)}} user
 * @param {number} minutes  the cooldown for auto-lockouts
 * @returns {{locked: boolean, until: Date|null, expired: boolean}}
 *   locked  — refuse the login if true
 *   until   — when a temporary lock lifts (null for a permanent admin lock)
 *   expired — a failed-attempt lock whose cooldown has passed; the caller
 *             should clear it and let the login proceed
 */
function effectiveLock(user, minutes = DEFAULT_LOCKOUT_MINUTES) {
  if (!user || !user.locked) return { locked: false, until: null, expired: false };

  // No timestamp → an admin lock (or a legacy row). Permanent by design.
  if (!user.locked_at) return { locked: true, until: null, expired: false };

  const lockedAtMs = new Date(user.locked_at).getTime();
  if (!Number.isFinite(lockedAtMs)) {
    // An unparseable timestamp is treated as a permanent lock rather than
    // silently unlocking the account.
    return { locked: true, until: null, expired: false };
  }

  const until = new Date(lockedAtMs + minutes * 60 * 1000);
  if (Date.now() >= until.getTime()) {
    return { locked: false, until: null, expired: true };
  }
  return { locked: true, until, expired: false };
}

/** Whole minutes until a temporary lock lifts, at least 1. */
function minutesUntil(until, now = new Date()) {
  if (!until) return null;
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / (60 * 1000)));
}

module.exports = { effectiveLock, minutesUntil, DEFAULT_LOCKOUT_MINUTES };
