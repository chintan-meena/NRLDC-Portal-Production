/**
 * Integration test for pendingTransferFor (routes/users.js) — the per-plant
 * guard that prevents two QCAs raising competing claims on one plant.
 *
 * Needs PostgreSQL. Run with `npm run test:integration`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDb, teardownTestDb } = require('../helpers/testdb');
const { pendingTransferFor } = require('../../routes/users');

let pool;
const PLANT = 'AAPL_BKN2';

before(async () => {
  pool = await setupTestDb();
  await pool.query(
    `INSERT INTO users (username, name, role, region, email, password_hash, energy_category, wbes_acronym, qca_name)
     VALUES ('alpha@nrldc','A','QCA','NRLDC','a@x','h','RE','', 'QCA Alpha'),
            ('beta@nrldc','B','QCA','NRLDC','b@x','h','RE','', 'QCA Beta')`
  );
  await pool.query(
    `INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category) VALUES ($1,'NRLDC','Plant','RE')`,
    [PLANT]
  );
});

after(async () => { await teardownTestDb(); });

test('no pending transfer on a fresh plant', async () => {
  assert.equal(await pendingTransferFor(PLANT, pool), null);
});

test('a pending claim is found regardless of which QCA is the target', async () => {
  // beta claims the unowned plant.
  await pool.query(
    `INSERT INTO transfer_requests (wbes_acronym, from_username, to_username, effective_date, status, requested_by)
     VALUES ($1, NULL, 'beta@nrldc', '2026-09-04', 'Pending', 'beta@nrldc')`,
    [PLANT]
  );

  // A guard keyed only on (plant, target) would miss alpha's competing claim;
  // the per-plant guard returns the in-flight request whatever the new target is.
  const pending = await pendingTransferFor(PLANT, pool);
  assert.ok(pending);
  assert.equal(pending.to_username, 'beta@nrldc'); // alpha's claim would be refused against this
});

test('case-insensitive on the acronym', async () => {
  assert.ok(await pendingTransferFor(PLANT.toLowerCase(), pool));
});

test('a decided (non-Pending) request no longer blocks a new one', async () => {
  await pool.query(`UPDATE transfer_requests SET status = 'Rejected' WHERE wbes_acronym = $1`, [PLANT]);
  assert.equal(await pendingTransferFor(PLANT, pool), null);
});
