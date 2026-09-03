/**
 * scripts/simTransferConflicts.js — Pre-deployment simulation for QCA transfers.
 *
 * Proves the discrepancy-conflict rule and the transactional approve logic behave
 * correctly across the six required scenarios, WITHOUT leaving any data behind:
 * everything runs inside one transaction that is ROLLED BACK at the end, and each
 * scenario is isolated in a SAVEPOINT. It exercises the very same
 * findTransferConflicts / transferConflictMessage the routes use, and mirrors the
 * approval close/open SQL from routes/users.js.
 *
 *   node server/scripts/simTransferConflicts.js
 *
 * Exit code 0 = all scenarios passed; 1 = a failure (or an unexpected throw).
 */

const pool = require('../db');
const { previousDayString } = require('../utils/dates');
const { findTransferConflicts, transferConflictMessage } = require('../utils/transferConflicts');

const REGION = 'NRLDC';
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
}

// ── seeders (all names prefixed so they never collide, though we roll back) ──
async function seedRegion(c) {
  await c.query(
    `INSERT INTO regions (acronym, name) VALUES ($1, $2) ON CONFLICT (acronym) DO NOTHING`,
    [REGION, 'Sim Region']
  );
}
async function seedQca(c, username, qcaName) {
  await c.query(
    `INSERT INTO users (username, name, role, region, email, password_hash, energy_category, wbes_acronym, qca_name)
     VALUES ($1, $2, 'QCA', $3, $4, 'x', 'RE', '', $5)`,
    [username, qcaName, REGION, `${username}@example.com`, qcaName]
  );
}
async function seedPlant(c, acronym, name) {
  await c.query(
    `INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category)
     VALUES ($1, $2, $3, 'RE')`,
    [acronym, REGION, name]
  );
}
async function seedAssignment(c, username, acronym, fromDate, toDate) {
  await c.query(
    `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
     VALUES ($1, $2, $3, $4)`,
    [username, acronym, fromDate, toDate]
  );
}
async function seedDiscrepancy(c, requestBy, acronym, correctionDate) {
  const r = await c.query(
    `INSERT INTO discrepancies (region, request_by, correction_for_date, time_blocks, request_content, energy_category)
     VALUES ($1, $2, $3, '1', 'sim', 'RE') RETURNING req_no`,
    [REGION, requestBy, acronym, correctionDate]
  );
  return r.rows[0].req_no;
}

// Mirror of the approval transaction body in routes/users.js: conflict-gate,
// then close-outgoing + open-incoming.
async function simulateApprove(c, { acronym, fromUsername, toUsername, effectiveDate }) {
  const conflicts = await findTransferConflicts(c, { fromUsername, acronym, effectiveDate });
  if (conflicts.length > 0) {
    return { ok: false, status: 409, message: transferConflictMessage(conflicts) };
  }
  const prevDayStr = previousDayString(effectiveDate);
  await c.query(
    `UPDATE user_plant_assignments SET to_date = $1
      WHERE wbes_acronym = $2 AND (to_date IS NULL OR to_date >= $3)`,
    [prevDayStr, acronym, effectiveDate]
  );
  await c.query(
    `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (username, wbes_acronym, from_date) DO UPDATE SET to_date = NULL`,
    [toUsername, acronym, effectiveDate]
  );
  return { ok: true };
}

// Who owns `acronym` on `date`, per the assignment window (NULL if nobody).
async function ownerOn(c, acronym, date) {
  const r = await c.query(
    `SELECT username FROM user_plant_assignments
      WHERE wbes_acronym = $1 AND $2::date >= from_date AND (to_date IS NULL OR $2::date <= to_date)
      ORDER BY from_date DESC LIMIT 1`,
    [acronym, date]
  );
  return r.rows[0]?.username || null;
}
// Does `qca` see a discrepancy for `date` via the filer path OR the window path?
async function qcaSees(c, qca, acronym, date) {
  const r = await c.query(
    `SELECT 1 FROM discrepancies d
      WHERE d.wbes_acronym = $2 AND d.correction_for_date = $3::date
        AND (LOWER(d.request_by) = LOWER($1)
             OR EXISTS (SELECT 1 FROM user_plant_assignments a
                          WHERE LOWER(a.username) = LOWER($1) AND a.wbes_acronym = d.wbes_acronym
                            AND d.correction_for_date >= a.from_date
                            AND (a.to_date IS NULL OR d.correction_for_date <= a.to_date)))
      LIMIT 1`,
    [qca, acronym, date]
  );
  return r.rows.length > 0;
}

async function withSavepoint(c, fn) {
  await c.query('SAVEPOINT t');
  try { await fn(); } finally { await c.query('ROLLBACK TO SAVEPOINT t'); }
}

async function main() {
  let c;
  try {
    c = await pool.connect();
  } catch (err) {
    console.error(`\nSIMULATION could not run — the database is unreachable (${err.code || err.message}).`);
    console.error('Start PostgreSQL / check server/.env, then re-run: node server/scripts/simTransferConflicts.js\n');
    await pool.end().catch(() => {});
    process.exit(1);
  }
  try {
    await c.query('BEGIN');
    await seedRegion(c);
    const A = '__sim_qca_a@nldc';
    const B = '__sim_qca_b@nldc';
    const P1 = '__SIM_P1';
    const P2 = '__SIM_P2';

    // Test 1 — no discrepancy → transfer succeeds.
    await withSavepoint(c, async () => {
      await seedQca(c, A, 'Sim QCA A'); await seedQca(c, B, 'Sim QCA B');
      await seedPlant(c, P1, 'Sim Plant 1');
      await seedAssignment(c, A, P1, '2026-08-15', null);
      const res = await simulateApprove(c, { acronym: P1, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      check('Test 1 — no discrepancy → allowed', res.ok === true, JSON.stringify(res));
      check('Test 1 — B owns from 1-Sep', (await ownerOn(c, P1, '2026-09-01')) === B);
      check('Test 1 — A owns 31-Aug', (await ownerOn(c, P1, '2026-08-31')) === A);
    });

    // Test 2 — discrepancy before effective date → allowed.
    await withSavepoint(c, async () => {
      await seedQca(c, A, 'Sim QCA A'); await seedQca(c, B, 'Sim QCA B');
      await seedPlant(c, P1, 'Sim Plant 1');
      await seedAssignment(c, A, P1, '2026-08-15', null);
      await seedDiscrepancy(c, A, P1, '2026-08-31');
      const res = await simulateApprove(c, { acronym: P1, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      check('Test 2 — 31-Aug disc, 1-Sep effective → allowed', res.ok === true, JSON.stringify(res));
    });

    // Test 3 — discrepancy on/after effective date → rejected cleanly, no change.
    await withSavepoint(c, async () => {
      await seedQca(c, A, 'Sim QCA A'); await seedQca(c, B, 'Sim QCA B');
      await seedPlant(c, P1, 'Sim Plant 1');
      await seedAssignment(c, A, P1, '2026-08-15', null);
      await seedDiscrepancy(c, A, P1, '2026-09-02');
      const res = await simulateApprove(c, { acronym: P1, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      check('Test 3 — 2-Sep disc, 1-Sep effective → rejected', res.ok === false && res.status === 409, JSON.stringify(res));
      check('Test 3 — message is a business sentence', typeof res.message === 'string' && res.message.startsWith('Transfer Not Allowed'));
      check('Test 3 — no assignment change (A still owns 2-Sep)', (await ownerOn(c, P1, '2026-09-02')) === A);
      check('Test 3 — B owns nothing', (await ownerOn(c, P1, '2026-09-01')) === A);
    });

    // Test 4 — transfer one plant; the other (with discrepancies) is untouched.
    await withSavepoint(c, async () => {
      await seedQca(c, A, 'Sim QCA A'); await seedQca(c, B, 'Sim QCA B');
      await seedPlant(c, P1, 'Sim Plant 1'); await seedPlant(c, P2, 'Sim Plant 2');
      await seedAssignment(c, A, P1, '2026-08-15', null);
      await seedAssignment(c, A, P2, '2026-08-15', null);
      await seedDiscrepancy(c, A, P2, '2026-09-05');
      const res = await simulateApprove(c, { acronym: P1, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      check('Test 4 — P1 (no disc) transfers', res.ok === true, JSON.stringify(res));
      check('Test 4 — P2 still owned by A on 5-Sep', (await ownerOn(c, P2, '2026-09-05')) === A);
      check('Test 4 — A still sees P2 5-Sep discrepancy', (await qcaSees(c, A, P2, '2026-09-05')) === true);
    });

    // Test 5 — mixed batch: clean plant transfers, conflicting plant refused.
    await withSavepoint(c, async () => {
      await seedQca(c, A, 'Sim QCA A'); await seedQca(c, B, 'Sim QCA B');
      await seedPlant(c, P1, 'Sim Plant 1'); await seedPlant(c, P2, 'Sim Plant 2');
      await seedAssignment(c, A, P1, '2026-08-15', null);
      await seedAssignment(c, A, P2, '2026-08-15', null);
      await seedDiscrepancy(c, A, P2, '2026-09-03');   // conflicts with 1-Sep effective
      const r1 = await simulateApprove(c, { acronym: P1, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      const r2 = await simulateApprove(c, { acronym: P2, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      check('Test 5 — P1 transfers', r1.ok === true, JSON.stringify(r1));
      check('Test 5 — P2 refused', r2.ok === false && r2.status === 409, JSON.stringify(r2));
      check('Test 5 — P1 now B', (await ownerOn(c, P1, '2026-09-01')) === B);
      check('Test 5 — P2 still A', (await ownerOn(c, P2, '2026-09-03')) === A);
    });

    // Test 6 — after a valid transfer, history is preserved and future dates use B.
    await withSavepoint(c, async () => {
      await seedQca(c, A, 'Sim QCA A'); await seedQca(c, B, 'Sim QCA B');
      await seedPlant(c, P1, 'Sim Plant 1');
      await seedAssignment(c, A, P1, '2026-08-15', null);
      await seedDiscrepancy(c, A, P1, '2026-08-20');   // historical, before effective
      const res = await simulateApprove(c, { acronym: P1, fromUsername: A, toUsername: B, effectiveDate: '2026-09-01' });
      await seedDiscrepancy(c, B, P1, '2026-09-05');   // new, filed by B after transfer
      check('Test 6 — transfer allowed', res.ok === true, JSON.stringify(res));
      check('Test 6 — A still sees its 20-Aug filing', (await qcaSees(c, A, P1, '2026-08-20')) === true);
      check('Test 6 — B does NOT own the 20-Aug date', (await ownerOn(c, P1, '2026-08-20')) === A);
      check('Test 6 — B owns 5-Sep', (await ownerOn(c, P1, '2026-09-05')) === B);
      check('Test 6 — B sees its 5-Sep filing', (await qcaSees(c, B, P1, '2026-09-05')) === true);
    });

    await c.query('ROLLBACK');   // nothing is ever persisted
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('\nSIMULATION ABORTED (unexpected error):', err.message);
    c.release();
    await pool.end();
    process.exit(1);
  }
  c.release();
  await pool.end();

  // Report
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log('\n  QCA transfer conflict simulation (all changes rolled back)\n');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 52)}${r.ok ? '' : '  ← ' + r.detail}`);
  }
  console.log(`\n  ${results.length - failed}/${results.length} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
