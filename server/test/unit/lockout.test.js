/**
 * Unit tests for auth/lockout.js — when a locked account is actually locked.
 *
 * The security-relevant invariant: a failed-attempt lockout (locked_at set)
 * expires after the cooldown, but a deliberate admin lock (locked_at NULL) never
 * does. Getting this wrong either lets an attacker permanently lock accounts, or
 * silently unlocks accounts an admin locked on purpose.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { effectiveLock, minutesUntil, DEFAULT_LOCKOUT_MINUTES } = require('../../auth/lockout');

test('an unlocked account is not locked', () => {
  const r = effectiveLock({ locked: false, locked_at: null }, 60);
  assert.equal(r.locked, false);
});

test('a fresh failed-attempt lock is locked, with a lift time', () => {
  const r = effectiveLock({ locked: true, locked_at: new Date() }, 60);
  assert.equal(r.locked, true);
  assert.ok(r.until instanceof Date);
});

test('a failed-attempt lock past its cooldown is expired, not locked', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const r = effectiveLock({ locked: true, locked_at: twoHoursAgo }, 60);
  assert.equal(r.locked, false);
  assert.equal(r.expired, true);
});

test('a failed-attempt lock within its cooldown stays locked', () => {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const r = effectiveLock({ locked: true, locked_at: tenMinAgo }, 60);
  assert.equal(r.locked, true);
  assert.equal(r.expired, false);
});

test('an admin lock (locked_at NULL) never expires', () => {
  const r = effectiveLock({ locked: true, locked_at: null }, 60);
  assert.equal(r.locked, true);
  assert.equal(r.until, null);
  assert.equal(r.expired, false);
});

test('an unparseable locked_at is treated as a permanent lock, never auto-unlocked', () => {
  const r = effectiveLock({ locked: true, locked_at: 'not-a-date' }, 60);
  assert.equal(r.locked, true);
  assert.equal(r.expired, false);
});

test('the cooldown length is honoured', () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  assert.equal(effectiveLock({ locked: true, locked_at: fiveMinAgo }, 3).locked, false); // 3-min cooldown → expired
  assert.equal(effectiveLock({ locked: true, locked_at: fiveMinAgo }, 60).locked, true); // 60-min cooldown → still locked
});

test('minutesUntil rounds up and floors at 1', () => {
  const now = new Date();
  assert.equal(minutesUntil(new Date(now.getTime() + 30 * 60 * 1000), now), 30);
  assert.equal(minutesUntil(new Date(now.getTime() + 10 * 1000), now), 1); // <1 min → 1
  assert.equal(minutesUntil(null), null);
});

test('the default cooldown is a sane hour', () => {
  assert.equal(DEFAULT_LOCKOUT_MINUTES, 60);
});
