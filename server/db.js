require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool, types } = require('pg');

/**
 * Return DATE columns as plain 'YYYY-MM-DD' strings.
 *
 * By default node-postgres turns a DATE into a JS Date at *local* midnight.
 * JSON.stringify then serialises that as UTC, which rolls the calendar day
 * backwards at any positive offset — at IST (+5:30) a schedule dated 31 Dec
 * reached the browser as "2026-12-30T18:30:00.000Z" and was displayed as
 * 30-12-2026. A DATE has no time or zone to begin with, so handing it back
 * verbatim is both simpler and correct.
 *
 * This affects DATE (oid 1082) only. Timestamps keep their normal handling.
 */
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'nrldc_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  max: parseInt(process.env.PGPOOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Run a set of statements inside a real transaction.
 *
 * Issuing BEGIN/COMMIT through the pool does not work: the pool hands out a
 * connection per query, so the BEGIN and the statements that follow can land
 * on different backends, and two concurrent requests can interleave on each
 * other's connections. Everything inside `fn` must therefore go through the
 * single checked-out client passed to it.
 *
 *   await withTransaction(async (client) => {
 *     await client.query('UPDATE ...');
 *     await client.query('INSERT ...');
 *   });
 *
 * Commits when `fn` returns, rolls back if it throws, and always releases the
 * connection back to the pool.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[DB] Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = pool;
module.exports.withTransaction = withTransaction;
