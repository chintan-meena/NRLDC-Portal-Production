const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logEvent } = require('../utils/log');
const { getBoolean } = require('../utils/settings');
const { requireAdmin } = require('../middleware/auth');
const { scopeToRegion } = require('../middleware/region');
const { toDateString } = require('../utils/dates');
const { originalFilename } = require('../utils/filenames');
const path = require('path');
const fs = require('fs');
const { createUploader } = require('../config/uploads');
const archiver = require('archiver');

// Ensure upload folder exists
const uploadsDir = path.join(__dirname, '../upload');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Upload rules (accepted types, size cap, cleanup) live in config/uploads.js
const { upload, handleUploadErrors } = createUploader(uploadsDir);

/**
 * Refuse every cycle-data request while the feature is switched off in System
 * Parameters. Hiding the tabs is not enough on its own — the endpoints have to
 * close too, or the feature is only cosmetically disabled.
 */
async function requireFeatureEnabled(req, res, next) {
  try {
    // Regional: one despatch centre can retire Cycle Data without affecting
    // the others.
    const enabled = await getBoolean('feature_cycle_data', req.auth?.region, true);
    if (!enabled) {
      return res.status(403).json({ error: 'The Cycle Data feature is currently switched off by the administrator.' });
    }
    next();
  } catch (err) {
    console.error('[CYCLE FEATURE CHECK]', err);
    res.status(500).json({ error: 'Could not check feature availability.' });
  }
}

router.use(requireFeatureEnabled);


// POST /api/cycle-data/upload — Upload cycle data file
router.post('/upload', handleUploadErrors(upload.single('file')), async (req, res) => {
  const { startDate, endDate } = req.body;
  const username = req.auth.username;

  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an Excel file.' });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Start date and end date are required.' });
  }

  try {
    // Check if user is authorized to upload cycle data
    const userRes = await pool.query('SELECT can_upload_cycle_data FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0 || !userRes.rows[0].can_upload_cycle_data) {
      // Remove uploaded file if unauthorized
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'You are not authorized to upload cycle data.' });
    }

    const result = await pool.query(
      `INSERT INTO cycle_data_uploads (username, start_date, end_date, filename)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [username, startDate, endDate, req.file.filename]
    );

    await logEvent('success', `Cycle data file uploaded by ${username} for range ${startDate} to ${endDate}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CYCLE UPLOAD ERROR]', err);
    res.status(500).json({ error: 'Failed to record cycle data upload: ' + err.message });
  }
});

// GET /api/cycle-data/my-uploads — Get uploads list for user
router.get('/my-uploads', async (req, res) => {
  // Always the caller's own uploads — the query string is not consulted.
  const username = req.auth.username;

  try {
    const result = await pool.query(
      'SELECT id, username, start_date, end_date, filename, created_at FROM cycle_data_uploads WHERE username = $1 ORDER BY created_at DESC',
      [username]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CYCLE MY-UPLOADS GET]', err);
    res.status(500).json({ error: 'Failed to fetch uploads list.' });
  }
});

// GET /api/cycle-data/admin-list — Get all uploads for a date range (admin)
router.get('/admin-list', requireAdmin, async (req, res) => {
  const { fromDate, toDate } = req.query;
  try {
    let query = `SELECT c.id, c.username, c.start_date, c.end_date, c.filename, c.created_at, u.region
                   FROM cycle_data_uploads c
                   JOIN users u ON c.username = u.username`;
    const params = [];
    const conditions = [];

    // An upload belongs to whichever region the station that made it does.
    scopeToRegion(req, 'u.region', conditions, params);

    if (fromDate) {
      params.push(fromDate);
      conditions.push(`c.end_date >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate);
      conditions.push(`c.start_date <= $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY c.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[CYCLE ADMIN-LIST GET]', err);
    res.status(500).json({ error: 'Failed to fetch cycle uploads list.' });
  }
});

// GET /api/cycle-data/download-zip — Download cycle data files as zip archive (admin)
router.get('/download-zip', requireAdmin, async (req, res) => {
  const { fromDate, toDate } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'From Date and To Date parameters are mandatory.' });
  }

  try {
    // Find files that overlap with selected range
    const params = [fromDate, toDate];
    const conditions = [];
    // The bundle is a listing too — it must not sweep in another region's files.
    scopeToRegion(req, 'u.region', conditions, params);
    const extra = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT c.username, c.start_date, c.end_date, c.filename
        FROM cycle_data_uploads c
        JOIN users u ON c.username = u.username
       WHERE c.end_date >= $1 AND c.start_date <= $2${extra}
       ORDER BY c.username ASC, c.created_at DESC
    `;
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).send('No cycle data files found in selected date range.');
    }

    const zipName = `cycle_data_report_${fromDate}_to_${toDate}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[ZIP STREAM ERROR]', err);
      res.status(500).send('Error compiling archive.');
    });

    archive.pipe(res);

    result.rows.forEach(row => {
      const filePath = path.join(uploadsDir, row.filename);
      if (fs.existsSync(filePath)) {
        const displayName = originalFilename(row.filename);
        const entryName = `${row.username}/${toDateString(row.start_date)}_to_${toDateString(row.end_date)}_${displayName}`;
        archive.file(filePath, { name: entryName });
      }
    });

    await logEvent('info', `Admin downloaded cycle data zip archive for range ${fromDate} to ${toDate}`);
    await archive.finalize();
  } catch (err) {
    console.error('[CYCLE ZIP DOWNLOAD]', err);
    res.status(500).send('Failed to compile zip file: ' + err.message);
  }
});

module.exports = router;
