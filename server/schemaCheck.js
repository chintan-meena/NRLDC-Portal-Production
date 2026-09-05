/**
 * schemaCheck.js — Refuse to start against an out-of-date database.
 *
 * The server used to start happily whatever state the schema was in, and then
 * fail every authenticated request with "Authentication check failed." because
 * a table the auth middleware queries did not exist yet. A server that 500s
 * every request is worse than one that refuses to start and says why.
 *
 * Checked at boot; the fix is always the same: ./nrldc.sh migrate
 */

const pool = require('./db');

// Tables the running server queries. If one is missing the schema predates a
// change and the database needs migrating.
const REQUIRED_TABLES = [
  'users',
  'discrepancies',
  'config',
  'system_logs',
  'wbes_entities',
  'user_plant_assignments',
  'transfer_requests',
  'outages',
  'cycle_data_uploads',
  'login_otps',        // added when OTPs moved out of process memory
  'revoked_tokens',       // added when logout began revoking tokens
  'registration_requests', // added with self-service registration
  'password_reset_requests', // added with admin-approved password resets
  'trusted_devices',      // added when OTP moved to once-per-device-per-week
  'mail_quota',           // added with the daily mail allowance guard
  'new_acronym_requests', // added with new-plant / new-id requests
  'password_reset_abuse', // added with the password-recovery abuse throttle
];

// Columns added after the table itself existed.
const REQUIRED_COLUMNS = [
  ['wbes_entities', 'energy_category'],   // added for the QCA/RE rule
  ['wbes_entities', 'utility_type'],      // added for the self-registration type gate
  ['wbes_entities', 'generator_subtype'], // added with the full WBES_Utility format
  ['wbes_entities', 'date_of_commissioning'],
  ['login_otps', 'purpose'],              // added when reset codes joined login codes
  ['users', 'locked_at'],                 // added for auto-expiring failed-attempt lockouts
  ['discrepancies', 'correcting_region'], // added with two-sided trade consent
  ['discrepancies', 'gna_tgna_number'],   // added with GNA/T-GNA on trade filings
];

/**
 * Returns { ok, missingTables, missingColumns, fresh }.
 * `fresh` means the database has no portal tables at all — it needs seeding
 * rather than migrating.
 */
async function checkSchema() {
  const tableRes = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const present = new Set(tableRes.rows.map(r => r.table_name));
  const missingTables = REQUIRED_TABLES.filter(t => !present.has(t));

  const missingColumns = [];
  for (const [table, column] of REQUIRED_COLUMNS) {
    if (!present.has(table)) continue;   // already reported as a missing table
    const colRes = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    );
    if (colRes.rows.length === 0) missingColumns.push(`${table}.${column}`);
  }

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
    fresh: !present.has('users'),
  };
}

/** Print what is wrong and how to fix it. */
function reportSchemaProblem({ missingTables, missingColumns, fresh }) {
  const line = '─'.repeat(66);
  console.error('');
  console.error(line);
  console.error('  THE DATABASE SCHEMA IS OUT OF DATE — the server will not start.');
  console.error(line);
  if (missingTables.length) {
    console.error(`  Missing tables : ${missingTables.join(', ')}`);
  }
  if (missingColumns.length) {
    console.error(`  Missing columns: ${missingColumns.join(', ')}`);
  }
  console.error('');
  if (fresh) {
    console.error('  This database is empty. Create the tables and seed accounts with:');
    console.error('');
    console.error('      ./nrldc.sh seed');
  } else {
    console.error('  Your data is intact — the schema just needs the newer tables and');
    console.error('  columns. Apply them without losing anything:');
    console.error('');
    console.error('      ./nrldc.sh migrate');
    console.error('');
    console.error('  (or, from the server directory:  npm run migrate)');
  }
  console.error('');
  console.error(line);
  console.error('');
}

module.exports = { checkSchema, reportSchemaProblem, REQUIRED_TABLES };
