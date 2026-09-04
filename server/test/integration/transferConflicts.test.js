/**
 * Integration tests for utils/transferConflicts.js — the transfer-safety rule
 * that runs against a real database at request time and, authoritatively, inside
 * the approval transaction.
 *
 * This is the most sensitive logic in the system: an effective date on or before
 * a date the OUTGOING QCA already filed for would slide that filing into the new
 * QCA's ownership window, corrupting history. These tests pin the boundary
 * exactly (>= is the rule) so a refactor cannot loosen it unnoticed.
 *
 * Needs a PostgreSQL server. Run with `npm run test:integration`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDb, teardownTestDb } = require('../helpers/testdb');
const { findTransferConflicts, transferConflictMessage } = require('../../utils/transferConflicts');

let pool;

const OUTGOING = 'qca_a@nrldc';
const INCOMING = 'qca_b@nrldc';
const PLANT = 'REWIND1';
const FILED_DATE = '2026-06-15';

before(async () => {
  pool = await setupTestDb();

  // Two QCA accounts in NRLDC (QCAs must be RE — schema constraint).
  await pool.query(
    `INSERT INTO users (username, name, role, region, email, password_hash, energy_category, wbes_acronym, qca_name)
     VALUES ($1,'QCA A','QCA','NRLDC','a@x','h','RE','', 'QCA Alpha'),
            ($2,'QCA B','QCA','NRLDC','b@x','h','RE','', 'QCA Beta')`,
    [OUTGOING, INCOMING]
  );

  // An RE plant in NRLDC, held by the outgoing QCA from the start of the year.
  await pool.query(
    `INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category) VALUES ($1,'NRLDC','Rewind One','RE')`,
    [PLANT]
  );
  await pool.query(
    `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date) VALUES ($1,$2,'2026-01-01')`,
    [OUTGOING, PLANT]
  );

  // The outgoing QCA has already filed a discrepancy for 15 Jun 2026.
  await pool.query(
    `INSERT INTO discrepancies (region, request_by, wbes_acronym, correction_for_date, time_blocks, request_content, energy_category)
     VALUES ('NRLDC',$1,$2,$3,'1','test filing','RE')`,
    [OUTGOING, PLANT, FILED_DATE]
  );
});

after(async () => {
  await teardownTestDb();
});

test('a transfer effective ON the filed date conflicts (the >= boundary)', async () => {
  const rows = await findTransferConflicts(pool, { fromUsername: OUTGOING, acronym: PLANT, effectiveDate: FILED_DATE });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].correction_for_date, FILED_DATE);
});

test('a transfer effective BEFORE the filed date conflicts', async () => {
  const rows = await findTransferConflicts(pool, { fromUsername: OUTGOING, acronym: PLANT, effectiveDate: '2026-01-01' });
  assert.equal(rows.length, 1);
});

test('a transfer effective the day AFTER the filed date is clean', async () => {
  const rows = await findTransferConflicts(pool, { fromUsername: OUTGOING, acronym: PLANT, effectiveDate: '2026-06-16' });
  assert.equal(rows.length, 0);
});

test('a first-time claim (no outgoing QCA) can never conflict', async () => {
  const rows = await findTransferConflicts(pool, { fromUsername: null, acronym: PLANT, effectiveDate: '2026-01-01' });
  assert.deepEqual(rows, []);
});

test('the acronym match is case-insensitive', async () => {
  const rows = await findTransferConflicts(pool, { fromUsername: OUTGOING, acronym: PLANT.toLowerCase(), effectiveDate: FILED_DATE });
  assert.equal(rows.length, 1);
});

test('the refusal message names the request and shows the date as dd-mm-yyyy', async () => {
  const rows = await findTransferConflicts(pool, { fromUsername: OUTGOING, acronym: PLANT, effectiveDate: FILED_DATE });
  const msg = transferConflictMessage(rows);
  assert.match(msg, /Transfer Not Allowed/);
  assert.match(msg, /Req No \d+/);
  assert.match(msg, /15-06-2026/);
});
