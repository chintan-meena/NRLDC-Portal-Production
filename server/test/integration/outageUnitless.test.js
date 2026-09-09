/**
 * Integration test for unit-less outages. Renewable (RE) plants have no
 * generating unit to name, so they file an outage with a NULL unit_number
 * (routes/outages.js enforces the requirement per-category). This pins the
 * schema side of that rule: the outages.unit_number column must stay nullable,
 * or a future migration re-adding NOT NULL would silently break RE filing.
 *
 * Needs a PostgreSQL server. Run with `npm run test:integration`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDb, teardownTestDb } = require('../helpers/testdb');

let pool;

const RE_USER = 're_plant@nrldc';
const ISGS_USER = 'isgs_plant@nrldc';

before(async () => {
  pool = await setupTestDb();
  await pool.query(
    `INSERT INTO users (username, name, role, region, email, password_hash, energy_category, wbes_acronym)
     VALUES ($1,'Solar One','USER','NRLDC','re@x','h','RE','SOLAR1'),
            ($2,'Thermal One','USER','NRLDC','isgs@x','h','ISGS','THERM1')`,
    [RE_USER, ISGS_USER]
  );
});

after(async () => {
  await teardownTestDb();
});

test('an RE outage stores a NULL unit_number', async () => {
  const res = await pool.query(
    `INSERT INTO outages (username, generator_name, unit_number, outage_type, outage_from, outage_to, reason, status)
     VALUES ($1,'SOLAR1',NULL,'Forced Outage',NOW() - INTERVAL '2 hours',NOW() - INTERVAL '1 hour','inverter trip','Pending')
     RETURNING unit_number`,
    [RE_USER]
  );
  assert.equal(res.rows[0].unit_number, null);
});

test('a conventional outage keeps its unit_number', async () => {
  const res = await pool.query(
    `INSERT INTO outages (username, generator_name, unit_number, outage_type, outage_from, outage_to, reason, status)
     VALUES ($1,'THERM1','Unit 3','Partial Outage',NOW() - INTERVAL '2 hours',NOW() - INTERVAL '1 hour','boiler leak','Pending')
     RETURNING unit_number`,
    [ISGS_USER]
  );
  assert.equal(res.rows[0].unit_number, 'Unit 3');
});

test('the unit_number column is nullable in the schema', async () => {
  const res = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'outages' AND column_name = 'unit_number'`
  );
  assert.equal(res.rows[0].is_nullable, 'YES');
});
