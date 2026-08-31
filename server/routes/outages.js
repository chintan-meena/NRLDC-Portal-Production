const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdmin, isAdmin } = require('../middleware/auth');

// Helper to format Date Objects to DD-MM-YYYY HH:MM
function formatDateDMYHM(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function logEvent(type, message) {
  try {
    await pool.query('INSERT INTO system_logs (type, message) VALUES ($1, $2)', [type, message]);
  } catch (e) { /* silent */ }
}

// GET /api/outages — Fetch outages list
router.get('/', async (req, res) => {
  const { fromDate, toDate } = req.query;
  // Non-admins are pinned to their own filings regardless of the query string.
  const username = isAdmin(req) ? req.query.username : req.auth.username;
  try {
    let query = 'SELECT id, username, generator_name, unit_number, outage_type, outage_from, outage_to, reason, status, created_at FROM outages';
    const params = [];
    const conditions = [];

    if (username) {
      params.push(username);
      conditions.push(`username = $${params.length}`);
    }

    if (fromDate) {
      params.push(fromDate);
      conditions.push(`outage_from >= $${params.length}`);
    }

    if (toDate) {
      // Add 23:59:59 to include full end day
      params.push(toDate + ' 23:59:59');
      conditions.push(`outage_from <= $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[OUTAGES GET]', err);
    res.status(500).json({ error: 'Failed to fetch outages.' });
  }
});

// POST /api/outages — File a new outage
router.post('/', async (req, res) => {
  const { generator_name, unit_number, outage_type, outage_from, outage_to, reason } = req.body;
  const username = req.auth.username;

  if (!generator_name || !unit_number || !outage_type || !outage_from || !outage_to || !reason) {
    return res.status(400).json({ error: 'All outage fields are mandatory.' });
  }

  const now = new Date();
  if (new Date(outage_to) > now) {
    return res.status(400).json({ error: 'Outage Date & Time To cannot be in the future.' });
  }
  if (new Date(outage_from) > now) {
    return res.status(400).json({ error: 'Outage Date & Time From cannot be in the future.' });
  }

  try {
    // Look up user's wbes_acronym to populate generator_name or wbes acronym field
    const userRes = await pool.query('SELECT wbes_acronym, name FROM users WHERE username = $1', [username]);
    const acronym = (userRes.rows.length > 0 && userRes.rows[0].wbes_acronym) ? userRes.rows[0].wbes_acronym : generator_name;

    const result = await pool.query(
      `INSERT INTO outages (username, generator_name, unit_number, outage_type, outage_from, outage_to, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
       RETURNING *`,
      [username, acronym, unit_number, outage_type, outage_from, outage_to, reason]
    );

    await logEvent('success', `Filed unit outage: ${acronym} Unit ${unit_number} (${outage_type})`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[OUTAGES POST]', err);
    res.status(500).json({ error: 'Failed to file unit outage.' });
  }
});

// PATCH /api/outages/:id/process — Approve or Reject outage (admin)
router.patch('/:id/process', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Approved or Rejected.' });
  }

  try {
    const result = await pool.query(
      'UPDATE outages SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Outage filing not found.' });
    }

    await logEvent('info', `Admin processed outage report #${id}: status set to ${status}`);
    res.json({ success: true, outage: result.rows[0] });
  } catch (err) {
    console.error('[OUTAGE PROCESS]', err);
    res.status(500).json({ error: 'Failed to process outage request.' });
  }
});

// PATCH /api/outages/:id — Admin edit outage entry
router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { unit_number, outage_type, outage_from, outage_to, reason, status } = req.body;

  if (outage_to) {
    const now = new Date();
    if (new Date(outage_to) > now) {
      return res.status(400).json({ error: 'Outage Date & Time To cannot be in the future.' });
    }
  }
  if (outage_from) {
    const now = new Date();
    if (new Date(outage_from) > now) {
      return res.status(400).json({ error: 'Outage Date & Time From cannot be in the future.' });
    }
  }

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (unit_number !== undefined) {
      updates.push(`unit_number = $${idx++}`);
      values.push(unit_number);
    }
    if (outage_type !== undefined) {
      updates.push(`outage_type = $${idx++}`);
      values.push(outage_type);
    }
    if (outage_from !== undefined) {
      updates.push(`outage_from = $${idx++}`);
      values.push(outage_from);
    }
    if (outage_to !== undefined) {
      updates.push(`outage_to = $${idx++}`);
      values.push(outage_to);
    }
    if (reason !== undefined) {
      updates.push(`reason = $${idx++}`);
      values.push(reason);
    }
    if (status !== undefined) {
      if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Status must be Pending, Approved, or Rejected.' });
      }
      updates.push(`status = $${idx++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE outages SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Outage filing not found.' });
    }

    await logEvent('info', `Admin updated outage entry #${id}: ${JSON.stringify(req.body)}`);
    res.json({ success: true, outage: result.rows[0] });
  } catch (err) {
    console.error('[OUTAGES PATCH EDIT]', err);
    res.status(500).json({ error: 'Failed to update outage.' });
  }
});

// DELETE /api/outages/:id — Admin delete outage entry
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM outages WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Outage filing not found.' });
    }
    await logEvent('warn', `Admin deleted outage entry #${id}: ${JSON.stringify(result.rows[0])}`);
    res.json({ success: true, message: 'Outage entry removed successfully.' });
  } catch (err) {
    console.error('[OUTAGES DELETE]', err);
    res.status(500).json({ error: 'Failed to delete outage.' });
  }
});

// GET /api/outages/download-excel — Download outages as CSV (Excel compatible) for a date range (Only approved entries!)
router.get('/download-excel', requireAdmin, async (req, res) => {
  const { fromDate, toDate, outageType } = req.query;

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'From Date and To Date query parameters are mandatory.' });
  }

  try {
    // Only approved entries are downloaded!
    let query = `
      SELECT created_at, generator_name, unit_number, outage_type, outage_from, outage_to, reason 
      FROM outages 
      WHERE status = 'Approved' AND outage_from >= $1 AND outage_from <= $2
    `;
    const params = [fromDate, toDate + ' 23:59:59'];
    if (outageType && outageType !== 'All') {
      params.push(outageType);
      query += ` AND outage_type = $${params.length}`;
    }
    query += ` ORDER BY outage_from ASC`;

    const result = await pool.query(query, params);

    // Construct CSV String
    let csv = '\ufeff'; // UTF-8 BOM for Excel compatibility
    csv += 'Timestamp,Select WBES Acronym of the Generator,Unit number,Type of outage,Outage Date & Time From,Outage Date & Time To,Reason of outage\n';

    result.rows.forEach(row => {
      const timestampStr = formatDateDMYHM(row.created_at);
      const fromStr = formatDateDMYHM(row.outage_from);
      const toStr = formatDateDMYHM(row.outage_to);

      // Escape fields containing commas or quotes
      const escape = (val) => {
        if (val === null || val === undefined) return '';
        const s = String(val).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      };

      csv += `${escape(timestampStr)},${escape(row.generator_name)},${escape(row.unit_number)},${escape(row.outage_type)},${escape(fromStr)},${escape(toStr)},${escape(row.reason)}\n`;
    });

    await logEvent('info', `Admin downloaded outages CSV report for range ${fromDate} to ${toDate} (Type: ${outageType || 'All'}, Only Approved rows)`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=outages_report_${fromDate}_to_${toDate}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('[OUTAGES DOWNLOAD CSV]', err);
    res.status(500).json({ error: 'Failed to generate outage report: ' + err.message });
  }
});

module.exports = router;
