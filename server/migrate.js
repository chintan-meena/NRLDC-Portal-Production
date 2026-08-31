#!/usr/bin/env node
/**
 * migrate.js — Apply schema.sql to an existing database without destroying it.
 *
 * seed.js DROPS every table before recreating them, which is right for a fresh
 * install but wrong for a database that already holds real discrepancies.
 * schema.sql is written to be idempotent (CREATE TABLE IF NOT EXISTS, ADD
 * COLUMN IF NOT EXISTS, guarded constraint additions), so running it on its own
 * brings an existing database up to date and leaves the data alone.
 *
 * Run: node migrate.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  console.log('[MIGRATE] Connecting to PostgreSQL...');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  const before = await pool.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
  );

  await pool.query(sql);

  const after = await pool.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
  );

  const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  const discs = await pool.query('SELECT COUNT(*)::int AS n FROM discrepancies');

  console.log(`[MIGRATE] Tables: ${before.rows[0].n} → ${after.rows[0].n}`);
  console.log(`[MIGRATE] Preserved ${users.rows[0].n} user(s) and ${discs.rows[0].n} discrepancy record(s).`);
  console.log('[MIGRATE] ✅ Schema is up to date. No data was dropped.');
}

migrate()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[MIGRATE] ❌ Failed:', err.message);
    pool.end();
    process.exit(1);
  });
