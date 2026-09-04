/**
 * routes/simulation.js — The Simulation screen's read-only projection API.
 *
 * Lets an admin ask "who coordinates which plant on each day of this range, and
 * what would a set of proposed transfers do to that picture" — over an arbitrary
 * window, not just the six fixed cases the CLI oracle proves. It runs the SAME
 * ownerOn / findTransferConflicts / approve logic the real routes use
 * (utils/simulation.js), and it NEVER persists: the what-if branch applies its
 * transfers inside a BEGIN/ROLLBACK, so nothing survives the request.
 *
 * Admin-only and region-scoped: a regional admin projects its own region; the
 * national admin projects across regions (optionally narrowing with a region).
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { regionScope } = require('../middleware/region');
const { projectPlants, simulateApprove } = require('../utils/simulation');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const MAX_PLANTS = 100;

// The RE plants and QCA accounts the caller may simulate, confined to region.
async function loadScope(req) {
  const region = regionScope(req); // null for national
  const params = [];
  let where = `energy_category = 'RE'`;
  if (region) { params.push(region); where += ` AND region = $${params.length}`; }
  const plants = (await pool.query(
    `SELECT wbes_acronym, name, region FROM wbes_entities WHERE ${where} ORDER BY wbes_acronym`, params
  )).rows;

  const qparams = [];
  let qwhere = `role = 'QCA'`;
  if (region) { qparams.push(region); qwhere += ` AND region = $${qparams.length}`; }
  const qcas = (await pool.query(
    `SELECT username, qca_name, region FROM users WHERE ${qwhere} ORDER BY qca_name`, qparams
  )).rows;
  return { region, plants, qcas };
}

// GET /api/simulation/context — plants + QCAs for the screen's pickers.
router.get('/context', requireAdmin, async (req, res) => {
  try {
    const { region, plants, qcas } = await loadScope(req);
    res.json({ region: region || 'ALL', plants, qcas });
  } catch (err) {
    console.error('[SIM CONTEXT]', err);
    res.status(500).json({ error: 'Failed to load simulation context.' });
  }
});

// POST /api/simulation/project — per-day ownership over a range, with optional
// what-if transfers applied and rolled back.
router.post('/project', requireAdmin, async (req, res) => {
  const { fromDate, toDate, acronyms, whatIfTransfers } = req.body || {};
  if (!ISO.test(String(fromDate)) || !ISO.test(String(toDate))) {
    return res.status(400).json({ error: 'fromDate and toDate must be YYYY-MM-DD.' });
  }
  if (toDate < fromDate) return res.status(400).json({ error: 'toDate must be on or after fromDate.' });
  // day span (inclusive)
  const span = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000) + 1;
  if (span > MAX_DAYS) return res.status(400).json({ error: `Range too long — keep it within ${MAX_DAYS} days.` });

  try {
    const { plants, qcas } = await loadScope(req);
    const inScope = new Map(plants.map(p => [p.wbes_acronym.toUpperCase(), p]));
    const qcaByUser = new Map(qcas.map(q => [q.username.toLowerCase(), q]));

    // Which plants to project: the requested subset (validated), else all in scope.
    let chosen;
    if (Array.isArray(acronyms) && acronyms.length > 0) {
      chosen = [];
      for (const a of acronyms) {
        const key = String(a).toUpperCase();
        if (!inScope.has(key)) return res.status(403).json({ error: `Plant "${a}" is not in your region's scope.` });
        chosen.push(key);
      }
    } else {
      chosen = plants.map(p => p.wbes_acronym.toUpperCase());
    }
    if (chosen.length > MAX_PLANTS) return res.status(400).json({ error: `Too many plants — pick at most ${MAX_PLANTS}.` });

    // Validate any what-if transfers against scope.
    const whatIfs = Array.isArray(whatIfTransfers) ? whatIfTransfers : [];
    for (const w of whatIfs) {
      const acr = String(w.wbes_acronym || '').toUpperCase();
      if (!inScope.has(acr)) return res.status(403).json({ error: `Transfer plant "${w.wbes_acronym}" is not in scope.` });
      if (!qcaByUser.has(String(w.to_username || '').toLowerCase())) {
        return res.status(400).json({ error: `Transfer target "${w.to_username}" is not a QCA in scope.` });
      }
      if (!ISO.test(String(w.effective_date))) return res.status(400).json({ error: 'Each transfer needs an effective_date (YYYY-MM-DD).' });
      if (!chosen.includes(acr)) chosen.push(acr); // make sure the moved plant is in the picture
    }

    const meta = chosen.map(a => inScope.get(a)).filter(Boolean);
    const nameFor = (username) => (username ? (qcaByUser.get(username.toLowerCase())?.qca_name || username) : null);

    // Baseline: current committed state.
    const baseline = await projectPlants(pool, chosen, fromDate, toDate);

    let whatIf = null;
    if (whatIfs.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const applied = [];
        // Apply in effective-date order, mirroring how approvals would land.
        const ordered = [...whatIfs].sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)));
        for (const w of ordered) {
          const acr = String(w.wbes_acronym).toUpperCase();
          const ownerRes = await client.query(
            `SELECT username FROM user_plant_assignments
              WHERE UPPER(wbes_acronym) = UPPER($1) AND (to_date IS NULL OR to_date >= $2)
              ORDER BY from_date DESC LIMIT 1`, [acr, w.effective_date]);
          const fromUsername = ownerRes.rows[0]?.username || null;
          const r = await simulateApprove(client, { acronym: acr, fromUsername, toUsername: w.to_username, effectiveDate: w.effective_date });
          applied.push({
            wbes_acronym: acr, from_username: fromUsername, from_qca: nameFor(fromUsername),
            to_username: w.to_username, to_qca: nameFor(w.to_username),
            effective_date: w.effective_date, ok: r.ok, message: r.ok ? null : r.message,
          });
        }
        const projected = await projectPlants(client, chosen, fromDate, toDate);
        await client.query('ROLLBACK'); // never persist a simulation
        whatIf = { applied, conflicts: applied.filter(a => !a.ok), projected };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
    }

    // Attach display names to the timelines.
    const decorate = (proj) => {
      const out = {};
      for (const acr of Object.keys(proj)) {
        out[acr] = proj[acr].map(d => ({ ...d, ownerName: nameFor(d.owner) }));
      }
      return out;
    };

    res.json({
      fromDate, toDate, days: span,
      plants: meta,
      baseline: decorate(baseline),
      whatIf: whatIf ? { applied: whatIf.applied, conflicts: whatIf.conflicts, projected: decorate(whatIf.projected) } : null,
    });
  } catch (err) {
    console.error('[SIM PROJECT]', err);
    res.status(500).json({ error: 'Simulation failed.' });
  }
});

module.exports = router;
