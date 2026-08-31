#!/usr/bin/env node
/**
 * seed.js — Seeds the PostgreSQL database with initial users.
 * Removes all discrepancies, logs, and other users for production.
 * Run: node seed.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { DEFAULT_PASSWORD } = require('./utils/password');
const fs = require('fs');
const path = require('path');

const HASH_ROUNDS = 10;

const initialUsers = [
  // Bypassed Admin
  {
    username: 'admin@nrldc',
    name: 'NRLDC Admin',
    role: 'ADMIN',
    email: 'admin@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'ISGS',
    preferred_landing: 'both',
    bypass_2fa: true,
    wbes_acronym: 'RLDC'
  },
  // Bypassed User
  {
    username: 'user@nrldc',
    name: 'NRLDC User',
    role: 'USER',
    email: 'user@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'ISGS',
    preferred_landing: null,
    bypass_2fa: true,
    wbes_acronym: 'JHAJJAR'
  },
  // QCA Users
  {
    username: 'qca1@nrldc',
    name: 'QCA User 1',
    role: 'QCA',
    email: 'qca1@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'RE',
    preferred_landing: null,
    bypass_2fa: true,
    wbes_acronym: 'QCA_A_ACR_1',
    qca_name: 'QCA Alpha'
  },
  {
    username: 'qca2@nrldc',
    name: 'QCA User 2',
    role: 'QCA',
    email: 'qca2@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'RE',
    preferred_landing: null,
    bypass_2fa: true,
    wbes_acronym: 'QCA_A_ACR_2',
    qca_name: 'QCA Alpha'
  },
  {
    username: 'qca_beta@nrldc',
    name: 'QCA Beta User',
    role: 'QCA',
    email: 'qca_beta@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'RE',
    preferred_landing: null,
    bypass_2fa: true,
    wbes_acronym: 'QCA_B_ACR',
    qca_name: 'QCA Beta'
  },
  // Plant users
  {
    username: 'plant_a@nrldc',
    name: 'Plant A Solar',
    role: 'USER',
    email: 'plant_a@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'RE',
    preferred_landing: null,
    bypass_2fa: true,
    wbes_acronym: 'PLANT_A'
  },
  {
    username: 'plant_b@nrldc',
    name: 'Plant B Wind',
    role: 'USER',
    email: 'plant_b@nrldc.in',
    password: DEFAULT_PASSWORD,
    energy_category: 'RE',
    preferred_landing: null,
    bypass_2fa: true,
    wbes_acronym: 'PLANT_B'
  }
];

// energy_category drives who may manage the plant — only RE plants can be
// placed under a QCA.
const initialPlants = [
  { acronym: 'JHAJJAR',   name: 'Jhajjar Power Station',                     energy_category: 'ISGS' },
  { acronym: 'SINGRAULI', name: 'Singrauli Super Thermal Power Station',     energy_category: 'ISGS' },
  { acronym: 'RIHAND',    name: 'Rihand Super Thermal Power Station',        energy_category: 'ISGS' },
  { acronym: 'DADRI',     name: 'Dadri Thermal Power Station',               energy_category: 'ISGS' },
  { acronym: 'UNCHAHAR',  name: 'Unchahar Thermal Power Station',            energy_category: 'ISGS' },
  { acronym: 'PLANT_A',   name: 'Plant A Solar',                             energy_category: 'RE' },
  { acronym: 'PLANT_B',   name: 'Plant B Wind',                              energy_category: 'RE' },
  { acronym: 'PLANT_C',   name: 'Plant C Solar',                             energy_category: 'RE' },
  { acronym: 'PLANT_D',   name: 'Plant D Solar',                             energy_category: 'RE' }
];

async function runSchema() {
  const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schemaSQL);
  console.log('[SEED] Schema created/verified.');
}

async function cleanDatabase() {
  console.log('[SEED] Dropping existing database tables to apply new schema...');
  await pool.query('DROP TABLE IF EXISTS discrepancies, system_logs, users, config, transfer_requests, user_plant_assignments, wbes_entities CASCADE');
  console.log('[SEED] All existing tables dropped.');
}

async function seedWbesEntities() {
  for (const p of initialPlants) {
    await pool.query(
      `INSERT INTO wbes_entities (wbes_acronym, name, energy_category) VALUES ($1, $2, $3)
       ON CONFLICT (wbes_acronym) DO UPDATE SET name = $2, energy_category = $3`,
      [p.acronym, p.name, p.energy_category]
    );
  }
  console.log(`[SEED] ${initialPlants.length} WBES plant entities seeded.`);
}

async function seedUsers() {
  for (const u of initialUsers) {
    const hash = await bcrypt.hash(u.password, HASH_ROUNDS);
    await pool.query(
      `INSERT INTO users (username, name, role, email, password_hash, energy_category, locked, failed_attempts, preferred_landing, bypass_2fa, wbes_acronym, qca_name)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, 0, $7, $8, $9, $10)
       ON CONFLICT (username) DO NOTHING`,
      [u.username, u.name, u.role, u.email, hash, u.energy_category, u.preferred_landing, u.bypass_2fa, u.wbes_acronym, u.qca_name || null]
    );
  }
  console.log(`[SEED] ${initialUsers.length} seed accounts created.`);
}

async function seedAssignments() {
  const assignments = [
    { username: 'qca1@nrldc', acronym: 'PLANT_A', from_date: '2026-06-21', to_date: '2026-06-30' },
    { username: 'qca2@nrldc', acronym: 'PLANT_A', from_date: '2026-07-01', to_date: null },
    { username: 'qca1@nrldc', acronym: 'PLANT_B', from_date: '2026-06-21', to_date: null },
    { username: 'qca2@nrldc', acronym: 'PLANT_C', from_date: '2026-06-20', to_date: null },
    { username: 'qca2@nrldc', acronym: 'PLANT_D', from_date: '2026-06-20', to_date: null }
  ];

  for (const a of assignments) {
    await pool.query(
      `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username, wbes_acronym, from_date) DO NOTHING`,
      [a.username, a.acronym, a.from_date, a.to_date]
    );
  }
  console.log('[SEED] Plant assignments seeded.');
}

async function seedLogs() {
  await pool.query(
    `INSERT INTO system_logs (type, message) VALUES ($1, $2)`,
    ['info', 'Production database initialized and cleared of all test discrepancy data.']
  );
  console.log('[SEED] Initial system log entry added.');
}

/**
 * Refuse to run against a production server.
 *
 * Both seeders drop real data and recreate accounts with a shared default
 * password and OTP switched off — right for a test machine, ruinous on a live
 * one. --yes exists to skip the prompt in scripts, so the prompt alone is not a
 * safeguard; this check is not skippable.
 */
function refuseInProduction(what) {
  if (process.env.NODE_ENV !== 'production') return;
  const line = '\u2500'.repeat(66);
  console.error('');
  console.error(line);
  console.error(`  REFUSING TO RUN: NODE_ENV is "production".`);
  console.error(line);
  console.error('');
  console.error(`  ${what}`);
  console.error('');
  console.error('  If this really is a throwaway database, run it with NODE_ENV unset:');
  console.error('');
  console.error('      NODE_ENV= node ' + require('path').basename(process.argv[1]));
  console.error('');
  console.error(line);
  console.error('');
  process.exit(1);
}

async function main() {
  refuseInProduction('This DROPS every table and recreates the schema, losing all data.');
  try {
    console.log('[SEED] Connecting to PostgreSQL...');
    await cleanDatabase();
    await runSchema();
    await seedWbesEntities();
    await seedUsers();
    await seedAssignments();
    await seedLogs();
    console.log('[SEED] ✅ Database seeding complete!');
  } catch (err) {
    console.error('[SEED] ❌ Error during seeding:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
