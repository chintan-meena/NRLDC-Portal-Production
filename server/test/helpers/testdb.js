/**
 * test/helpers/testdb.js — A disposable PostgreSQL database for integration tests.
 *
 * SAFETY: this helper refuses to operate on any database whose name does not end
 * in `_test`. It can create, wipe and drop the target, so it must never be
 * pointed at a real database — the guard below is what makes that impossible by
 * accident. The working database (nrldc_portal) and the demo one (nrldc_db) are
 * therefore untouchable from here.
 *
 * The target name comes from PGDATABASE_TEST, defaulting to `nrldc_test`. The
 * host/port/user/password come from the ordinary PG* env (server/.env), so the
 * test DB lives on the same server as the real one but as a separate database.
 *
 *   const { setupTestDb, teardownTestDb } = require('./helpers/testdb');
 *   const pool = await setupTestDb();   // fresh schema, empty tables
 *   ...
 *   await teardownTestDb();
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client, Pool, types } = require('pg');

// Mirror db.js: DATE columns come back as plain 'YYYY-MM-DD' strings, so tests
// see exactly what the application sees.
types.setTypeParser(1082, (value) => value);

const TEST_DB = process.env.PGDATABASE_TEST || 'nrldc_test';

if (!/_test$/.test(TEST_DB)) {
  throw new Error(
    `Refusing to run: the test database name "${TEST_DB}" does not end in "_test". ` +
    `Set PGDATABASE_TEST to a name ending in _test.`
  );
}

const CONN = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

let pool = null;

/** Connect to the maintenance database to create/drop the test database. */
async function adminClient() {
  const client = new Client({ ...CONN, database: 'postgres' });
  await client.connect();
  return client;
}

async function createDatabaseIfMissing() {
  const client = await adminClient();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (exists.rows.length === 0) {
      await client.query(`CREATE DATABASE "${TEST_DB}"`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Create the test database if needed, wipe its schema and apply schema.sql, then
 * return a pool bound to it. Every call yields a clean, empty-but-seeded database
 * (the five RLDC regions, default settings and the NLDC entity that schema.sql
 * inserts) with no user rows.
 */
async function setupTestDb() {
  await createDatabaseIfMissing();

  pool = new Pool({ ...CONN, database: TEST_DB, max: 4 });

  // A clean slate every run — the same DROP SCHEMA / CREATE SCHEMA that
  // init_fresh.js uses, so tests never inherit a previous run's rows.
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const schemaSQL = fs.readFileSync(path.join(__dirname, '..', '..', 'schema.sql'), 'utf8');
  await pool.query(schemaSQL);

  return pool;
}

/** Close the pool. The database itself is left in place for the next run. */
async function teardownTestDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { setupTestDb, teardownTestDb, TEST_DB };
