/**
 * Integration tests for the settings cache (utils/settings.js).
 *
 * The cache must serve reads without a query for a short TTL, and a write
 * through setSetting must make the new value visible immediately (not after the
 * TTL). These are checked against a real config table.
 *
 * Needs PostgreSQL. Run with `npm run test:integration`.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDb, teardownTestDb } = require('../helpers/testdb');
const settings = require('../../utils/settings');

let pool;

before(async () => { pool = await setupTestDb(); });
after(async () => { await teardownTestDb(); });
beforeEach(() => settings.clearSettingsCache());

test('a value written through setSetting is visible immediately', async () => {
  await settings.setSetting('maxDays', 'NRLDC', '7');
  assert.equal(await settings.getSetting('maxDays', 'NRLDC', '5'), '7');
});

test('a read is served from cache even after the underlying row changes out of band', async () => {
  await settings.setSetting('maxDays', 'NRLDC', '7');
  assert.equal(await settings.getSetting('maxDays', 'NRLDC', '5'), '7'); // now cached

  // Change the row directly, bypassing setSetting so the cache is not invalidated.
  await pool.query(`UPDATE config SET value = '9' WHERE key = 'maxDays' AND region = 'NRLDC'`);
  assert.equal(await settings.getSetting('maxDays', 'NRLDC', '5'), '7'); // still the cached value

  settings.clearSettingsCache();
  assert.equal(await settings.getSetting('maxDays', 'NRLDC', '5'), '9'); // fresh read
});

test('a write invalidates the cache for that key', async () => {
  await settings.getSetting('maxDays', 'NRLDC', '5');   // populate cache
  await settings.setSetting('maxDays', 'NRLDC', '12');  // should invalidate
  assert.equal(await settings.getSetting('maxDays', 'NRLDC', '5'), '12');
});

test('a missing setting returns the fallback and does not error', async () => {
  assert.equal(await settings.getSetting('nonexistentKey', 'NRLDC', 'fallback'), 'fallback');
});

test('getSettings mixes cached and freshly-fetched keys correctly', async () => {
  await settings.setSetting('maxDays', 'NRLDC', '5');
  await settings.getSetting('maxDays', 'NRLDC');           // cache one key
  const out = await settings.getSettings(['maxDays', 'lockoutAttempts'], 'NRLDC');
  assert.equal(out.maxDays, '5');
  assert.equal(out.lockoutAttempts, '3');                  // schema default, fetched
});

test('a global key resolves under GLOBAL regardless of the region asked', async () => {
  const cap = await settings.getSetting('mailDailyCap', 'ERLDC', '280');
  assert.equal(cap, await settings.getSetting('mailDailyCap', 'NRLDC', '280'));
});
