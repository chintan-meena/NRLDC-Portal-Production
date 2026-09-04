/**
 * utils/simulation.js — The QCA-transfer projection engine.
 *
 * One place for "who owns which plant on which day", the discrepancy-visibility
 * rule, and the non-persisting approve simulation. Both the pre-deployment CLI
 * (scripts/simTransferConflicts.js) and the live Simulation screen
 * (routes/simulation.js) import these so the screen a user drives and the proof
 * that ships are literally the same arithmetic.
 *
 * Nothing here writes to the database on its own: `simulateApprove` mutates only
 * inside whatever transaction the caller opened, and the route runs it inside a
 * BEGIN/ROLLBACK so a projection never leaves a trace.
 */

const { previousDayString } = require('./dates');
const { findTransferConflicts, transferConflictMessage } = require('./transferConflicts');

// Who owns `acronym` on `date`, per the assignment window (NULL if nobody).
async function ownerOn(db, acronym, date) {
  const r = await db.query(
    `SELECT username FROM user_plant_assignments
      WHERE UPPER(wbes_acronym) = UPPER($1) AND $2::date >= from_date AND (to_date IS NULL OR $2::date <= to_date)
      ORDER BY from_date DESC LIMIT 1`,
    [acronym, date]
  );
  return r.rows[0]?.username || null;
}

// Does `qca` see a discrepancy for `date` via the filer path OR the window path?
async function qcaSees(db, qca, acronym, date) {
  const r = await db.query(
    `SELECT 1 FROM discrepancies d
      WHERE UPPER(d.wbes_acronym) = UPPER($2) AND d.correction_for_date = $3::date
        AND (LOWER(d.request_by) = LOWER($1)
             OR EXISTS (SELECT 1 FROM user_plant_assignments a
                          WHERE LOWER(a.username) = LOWER($1) AND UPPER(a.wbes_acronym) = UPPER(d.wbes_acronym)
                            AND d.correction_for_date >= a.from_date
                            AND (a.to_date IS NULL OR d.correction_for_date <= a.to_date)))
      LIMIT 1`,
    [qca, acronym, date]
  );
  return r.rows.length > 0;
}

// Mirror of the approval transaction body in routes/users.js: conflict-gate,
// then close-outgoing + open-incoming. Mutates only inside the caller's tx.
async function simulateApprove(db, { acronym, fromUsername, toUsername, effectiveDate }) {
  const conflicts = await findTransferConflicts(db, { fromUsername, acronym, effectiveDate });
  if (conflicts.length > 0) {
    return { ok: false, status: 409, message: transferConflictMessage(conflicts) };
  }
  const prevDayStr = previousDayString(effectiveDate);
  await db.query(
    `UPDATE user_plant_assignments SET to_date = $1
      WHERE UPPER(wbes_acronym) = UPPER($2) AND (to_date IS NULL OR to_date >= $3)`,
    [prevDayStr, acronym, effectiveDate]
  );
  await db.query(
    `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (username, wbes_acronym, from_date) DO UPDATE SET to_date = NULL`,
    [toUsername, acronym, effectiveDate]
  );
  return { ok: true };
}

// Inclusive list of 'YYYY-MM-DD' strings from `from` to `to`, computed in local
// time so a day never rolls backward under IST like toISOString() would.
function eachDate(from, to) {
  const out = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const toDateStr = (v) => (v == null ? null : String(v).slice(0, 10));

/**
 * Per-day ownership for each acronym over [fromDate, toDate], read from whatever
 * the given db handle sees (so it reflects uncommitted what-if changes when run
 * inside the projection transaction). Assignments are fetched once per call and
 * the daily owner is resolved in JS — no query-per-day.
 * Returns { [acronym]: [{ date, owner, hasDiscrepancy }] }.
 */
async function projectPlants(db, acronyms, fromDate, toDate) {
  const days = eachDate(fromDate, toDate);
  const result = {};
  if (acronyms.length === 0) return result;

  const upper = acronyms.map(a => a.toUpperCase());
  const assignRes = await db.query(
    `SELECT UPPER(wbes_acronym) AS acr, username, from_date, to_date
       FROM user_plant_assignments WHERE UPPER(wbes_acronym) = ANY($1::text[])
      ORDER BY from_date ASC`,
    [upper]
  );
  const discRes = await db.query(
    `SELECT UPPER(wbes_acronym) AS acr, correction_for_date AS d
       FROM discrepancies
      WHERE UPPER(wbes_acronym) = ANY($1::text[])
        AND correction_for_date BETWEEN $2::date AND $3::date`,
    [upper, fromDate, toDate]
  );

  const byAcr = new Map(upper.map(a => [a, []]));
  for (const row of assignRes.rows) {
    if (!byAcr.has(row.acr)) byAcr.set(row.acr, []);
    byAcr.get(row.acr).push({ username: row.username, from: toDateStr(row.from_date), to: toDateStr(row.to_date) });
  }
  const discDays = new Set(discRes.rows.map(r => `${r.acr}|${toDateStr(r.d)}`));

  for (const acr of upper) {
    const segs = byAcr.get(acr) || [];
    result[acr] = days.map(date => {
      // latest segment whose window covers `date`
      let owner = null;
      for (const s of segs) {
        if (s.from <= date && (s.to === null || date <= s.to)) owner = s.username; // segs sorted asc → last match wins
      }
      return { date, owner, hasDiscrepancy: discDays.has(`${acr}|${date}`) };
    });
  }
  return result;
}

module.exports = { ownerOn, qcaSees, simulateApprove, eachDate, projectPlants };
