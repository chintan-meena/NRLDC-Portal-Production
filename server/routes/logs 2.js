/**
 * routes/logs.js — System log endpoints
 * GET    /api/logs   → get recent 100 logs (newest first)
 * DELETE /api/logs   → clear all logs
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/logs
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, type, message, created_at AS timestamp FROM system_logs ORDER BY id DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[LOGS GET]', err);
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

// DELETE /api/logs
router.delete('/', async (req, res) => {
  try {
    await pool.query('TRUNCATE system_logs RESTART IDENTITY');
    await pool.query("INSERT INTO system_logs (type, message) VALUES ('info', 'Logs cleared by user')");
    res.json({ success: true });
  } catch (err) {
    console.error('[LOGS DELETE]', err);
    res.status(500).json({ error: 'Failed to clear logs.' });
  }
});

module.exports = router;
