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
const { scopeToRegion, regionScope } = require('../middleware/region');
const { isSuperAdmin } = require('../middleware/auth');

// GET /api/logs
router.get('/', async (req, res) => {
  try {
    // Entries with no region belong to no despatch centre — a failed login for
    // an unknown username, an SMTP failure — so only a national administrator
    // sees them. A region condition excludes NULL, which gives that for free.
    const params = [];
    const conditions = [];
    scopeToRegion(req, 'region', conditions, params);
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
// A regional admin clears only their own region's entries. TRUNCATE would take
// every region's with them, so it is reserved for a national administrator
// clearing everything deliberately.
router.delete('/', async (req, res) => {
  try {
    const region = regionScope(req);

    if (region) {
      const result = await pool.query('DELETE FROM system_logs WHERE region = $1', [region]);
      await logEvent('info', `Logs cleared for ${region} by "${req.auth.username}" (${result.rowCount} entries).`, region);
      return res.json({ success: true, cleared: result.rowCount, region });
    }

    if (!isSuperAdmin(req)) {
      return res.status(403).json({ error: 'You do not administer a region whose logs could be cleared.' });
    }

    await pool.query('TRUNCATE system_logs RESTART IDENTITY');
    await logEvent('info', `All logs, in every region, cleared by "${req.auth.username}".`, null);
    res.json({ success: true, cleared: 'all' });
  } catch (err) {
    console.error('[LOGS DELETE]', err);
    res.status(500).json({ error: 'Failed to clear logs.' });
  }
});

module.exports = router;
