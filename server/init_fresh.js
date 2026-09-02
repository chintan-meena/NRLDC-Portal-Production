#!/usr/bin/env node
/**
 * init_fresh.js — Wipe the database to a clean, production-ready starting point.
 *
 * Unlike seed.js (which loads a body of test users and plants), this drops
 * EVERYTHING and rebuilds only:
 *   • the schema — all tables, the five standard RLDC regions, default configs
 *   • one account: the National administrator, admin@nldc
 *
 * That is the state a real multi-region deployment starts from: the national
 * administrator signs in and appoints each region's administrator, who then
 * adds the region's own users. No test data is created.
 *
 * Run:  node init_fresh.js          (asks for confirmation)
 *       node init_fresh.js --yes    (skips the prompt — used by fresh-start.bat)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const readline = require('readline');
const pool = require('./db');
const { DEFAULT_PASSWORD } = require('./utils/password');
const fs = require('fs');
const path = require('path');

const HASH_ROUNDS = 10;

// The one account this creates: the National administrator. It is a SUPERADMIN
// with no region — NLDC is its label and acronym, not a region row — so it sits
// above every region and administers all of them. OTP is bypassed so it can
// sign in on a fresh machine that has no mail server configured yet.
const NATIONAL_ADMIN = {
  username: 'admin@nldc',
  name: 'National Load Despatch Centre Admin',
  email: 'admin@nldc.in',
  wbes_acronym: 'NLDC',
};

/**
 * Refuse to run against a production server. This drops the whole schema, so it
 * is ruinous on a live database. --yes cannot override this — the prompt alone
 * is not the safeguard.
 */
function refuseInProduction() {
  if (process.env.NODE_ENV !== 'production') return;
  const line = '─'.repeat(66);
  console.error('');
  console.error(line);
  console.error('  REFUSING TO RUN: NODE_ENV is "production".');
  console.error(line);
  console.error('');
  console.error('  This DROPS the entire database schema and recreates it empty.');
  console.error('');
  console.error('  If this really is a throwaway database, run it with NODE_ENV unset:');
  console.error('');
  console.error('      NODE_ENV= node init_fresh.js --yes');
  console.error('');
  process.exit(1);
}

/** Ask before wiping, unless --yes was passed. */
function confirm() {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `\nThis WIPES the database at ${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}\n`
      + `and creates one account: ${NATIONAL_ADMIN.username}.\n\nType "yes" to continue: `,
      (answer) => { rl.close(); resolve(String(answer).trim().toLowerCase() === 'yes'); }
    );
  });
}

async function wipeAndRebuild() {
  console.log('[FRESH] Dropping the public schema...');
  // A clean slate: DROP SCHEMA takes every table, index, extension and sequence
  // with it, then schema.sql rebuilds the lot (tables, the 5 RLDC regions,
  // default per-region and global settings, the NLDC entity).
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  console.log('[FRESH] Applying schema.sql...');
  const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schemaSQL);
  console.log('[FRESH] Schema, regions and default settings created.');
}

async function createNationalAdmin() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, HASH_ROUNDS);
  await pool.query(
    `INSERT INTO users (username, name, role, region, email, password_hash, energy_category,
                        locked, failed_attempts, bypass_2fa, can_upload_cycle_data, wbes_acronym)
     VALUES ($1, $2, 'SUPERADMIN', NULL, $3, $4, 'ISGS', FALSE, 0, TRUE, FALSE, $5)`,
    [NATIONAL_ADMIN.username, NATIONAL_ADMIN.name, NATIONAL_ADMIN.email, hash, NATIONAL_ADMIN.wbes_acronym]
  );
  console.log(`[FRESH] ${NATIONAL_ADMIN.username} created (password: ${DEFAULT_PASSWORD}, OTP bypassed).`);
}

async function logInit() {
  await pool.query(
    `INSERT INTO system_logs (type, message) VALUES ($1, $2)`,
    ['info', `Fresh start: database wiped and initialised with national administrator ${NATIONAL_ADMIN.username}.`]
  );
}

async function main() {
  refuseInProduction();
  if (!(await confirm())) {
    console.log('Aborted. Nothing was changed.');
    await pool.end();
    process.exit(0);
  }
  try {
    console.log('[FRESH] Connecting to PostgreSQL...');
    await wipeAndRebuild();
    await createNationalAdmin();
    await logInit();
    console.log('[FRESH] ✅ Fresh start complete!');
    console.log('');
    console.log(`   Sign in as ${NATIONAL_ADMIN.username} / ${DEFAULT_PASSWORD}`);
    console.log('   Then add each region\'s administrator from the National Admin page.');
    console.log('');
  } catch (err) {
    console.error('[FRESH] ❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
