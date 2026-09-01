/**
 * routes/logs.js — System log endpoints
 * GET    /api/logs   → recent entries for the caller's region (newest first)
 * DELETE /api/logs   → clear the caller's region's entries
 *
 * Mounted behind requireAdmin in index.js.
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logEvent } = require('../utils/log');
const { scopeToRegionOrUnassigned, regionScope } = require('../middleware/region');

// GET /api/logs
router.get('/', async (req, res) => {
  try {
    // Entries with no region belong to no despatch centre — a failed login for
    // an unknown username, an SMTP failure. They are included rather than
    // hidden: every admin is now scoped to one region, so excluding them would
    // leave them visible to nobody at all.
    const params = [];
    const conditions = [];
    scopeToRegionOrUnassigned(req, 'region', conditions, params);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, type, message, region, created_at AS timestamp
         FROM system_logs ${where}
        ORDER BY id DESC LIMIT 100`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[LOGS GET]', err);
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

// DELETE /api/logs
//
// Clears this region's entries only. The unattributed ones are left alone:
// they are shown to every admin, so any one of them clearing the lot would
// take away what the others are reading.
router.delete('/', async (req, res) => {
  try {
    const region = regionScope(req);
    if (!region) {
      return res.status(403).json({ error: 'You do not administer a region whose logs could be cleared.' });
    }

    const result = await pool.query('DELETE FROM system_logs WHERE region = $1', [region]);
    await logEvent('info', `Logs cleared for ${region} by "${req.auth.username}" (${result.rowCount} entries).`, region);
    res.json({ success: true, cleared: result.rowCount, region });
  } catch (err) {
    console.error('[LOGS DELETE]', err);
    res.status(500).json({ error: 'Failed to clear logs.' });
  }
});

module.exports = router;
