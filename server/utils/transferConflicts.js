/**
 * utils/transferConflicts.js — Is a QCA plant transfer safe for history?
 *
 * The discrepancy↔QCA link is derived, never stored: a discrepancy carries only
 * request_by + wbes_acronym + correction_for_date, and ownership is read at query
 * time from the user_plant_assignments window. So moving a plant to a new QCA with
 * an effective date on or before a date the OUTGOING QCA already filed for would
 * slide that filing into the new QCA's window — the new QCA would inherit a
 * discrepancy it never raised, and historical ownership would be inconsistent.
 *
 * This module detects exactly those rows so the transfer routes (and the
 * pre-deployment simulation) can refuse cleanly rather than corrupt history.
 */

/**
 * Discrepancies that make the proposed transfer unsafe.
 *
 * `db` is the pool or a transaction client, so the same check runs at request
 * time and, authoritatively, inside the approval transaction. A first-time claim
 * has no outgoing QCA (fromUsername null/empty) and so nothing to strand → [].
 */
async function findTransferConflicts(db, { fromUsername, acronym, effectiveDate }) {
  if (!fromUsername) return [];
  const res = await db.query(
    `SELECT req_no, correction_for_date FROM discrepancies
      WHERE LOWER(request_by) = LOWER($1)
        AND UPPER(wbes_acronym) = UPPER($2)
        AND correction_for_date >= $3::date
      ORDER BY correction_for_date`,
    [fromUsername, acronym, effectiveDate]
  );
  return res.rows;
}

/** A clear, user-facing reason a transfer was refused for a discrepancy clash. */
function transferConflictMessage(rows) {
  const first = rows[0];
  const raw = first.correction_for_date;
  const iso = (raw instanceof Date) ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
  const [y, m, day] = iso.split('-');
  const shown = (y && m && day) ? `${day}-${m}-${y}` : iso;
  const more = rows.length > 1 ? ` (and ${rows.length - 1} more)` : '';
  return `Transfer Not Allowed — an existing discrepancy (Req No ${first.req_no} for ${shown})${more} `
       + `was filed for this plant on or after the requested effective date. Choose a later effective `
       + `date, or resolve it with the current QCA first.`;
}

module.exports = { findTransferConflicts, transferConflictMessage };
