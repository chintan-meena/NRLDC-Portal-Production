/**
 * routes/discrepancies.js — Discrepancy CRUD endpoints
 * GET   /api/discrepancies                → list all (admin) or by user
 * POST  /api/discrepancies                → create new
 * PATCH /api/discrepancies/:reqNo/process → resolve or reject (admin)
 * PATCH /api/discrepancies/:reqNo/reraise → re-raise rejected/resolved
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdmin, isAdmin } = require('../middleware/auth');
const { toDateString, daysSince } = require('../utils/dates');
const { parseTimeBlocks } = require('../utils/timeBlocks');
const { typeMatchPattern } = require('../utils/discrepancyTypes');
const path = require('path');
const fs = require('fs');
const { createUploader } = require('../config/uploads');
const ExcelJS = require('exceljs');

// Ensure upload folder exists
const uploadsDir = path.join(__dirname, '../upload');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Upload rules (accepted types, size cap, cleanup) live in config/uploads.js
const { upload, handleUploadErrors } = createUploader(uploadsDir);

async function logEvent(type, message) {
  try {
    await pool.query('INSERT INTO system_logs (type, message) VALUES ($1, $2)', [type, message]);
  } catch (e) { /* silent */ }
}

/**
 * True when the caller owns the discrepancy, or is the QCA holding the plant
 * it was raised against for the relevant date.
 */
async function canAccessDiscrepancy(req, disc) {
  const me = req.auth.username.toLowerCase();
  if (disc.request_by.toLowerCase() === me) return true;

  if (req.auth.qca_name && disc.wbes_acronym) {
    const res = await pool.query(
      `SELECT 1 FROM user_plant_assignments
        WHERE LOWER(username) = LOWER($1)
          AND wbes_acronym = $2
          AND $3::date >= from_date
          AND (to_date IS NULL OR $3::date <= to_date)
        LIMIT 1`,
      [req.auth.username, disc.wbes_acronym, disc.correction_for_date]
    );
    if (res.rows.length > 0) return true;
  }

  // A plant user can see requests raised against their own plant.
  if (req.auth.wbes_acronym && disc.wbes_acronym === req.auth.wbes_acronym) return true;

  return false;
}

// Whole days between the correction date and today, computed in local time.
const daysDiff = daysSince;

// GET /api/discrepancies?username=xxx
router.get('/', async (req, res) => {
  const { fromDate, toDate, page = 1, limit = 50, status, category, search, type } = req.query;

  // A non-admin caller is always scoped to their own account, whatever the
  // query string asks for. Only an admin may look at another user's requests.
  const username = isAdmin(req) ? req.query.username : req.auth.username;

  try {
    let baseQuery = 'SELECT d.*, u.name as request_by_name FROM discrepancies d JOIN users u ON d.request_by = u.username';
    const params = [];
    const conditions = [];

    // Role-based visibility
    if (username) {
      const userRes = await pool.query('SELECT role, wbes_acronym, qca_name FROM users WHERE username = $1', [username]);
      if (userRes.rows.length > 0) {
        const user = userRes.rows[0];
        if (user.role === 'USER' || user.role === 'QCA') {
          if (user.qca_name) {
            params.push(username);
            conditions.push(
              `(LOWER(d.request_by) = LOWER($${params.length}) OR d.wbes_acronym IN (
                SELECT wbes_acronym FROM user_plant_assignments 
                WHERE LOWER(username) = LOWER($${params.length}) 
                  AND d.correction_for_date >= from_date 
                  AND (to_date IS NULL OR d.correction_for_date <= to_date)
              ))`
            );
          } else {
            params.push(username);
            const acronym = user.wbes_acronym || '';
            params.push(acronym);
            conditions.push(`(LOWER(d.request_by) = LOWER($${params.length - 1}) OR d.wbes_acronym = $${params.length})`);
          }
        }
      }
    }

    if (search && search.trim()) {
      const term = search.trim();

      // ILIKE throughout, so searching "transformer" finds "Transformer" — the
      // previous clause compared the free-text columns case-sensitively, which
      // meant a search over remarks almost never matched.
      params.push(`%${term}%`);
      const like = `$${params.length}`;

      const clauses = [
        `d.request_by ILIKE ${like}`,          // station / user account
        `u.name ILIKE ${like}`,                // station display name
        `d.request_content ILIKE ${like}`,     // the remarks themselves
        `d.discrepancy_type ILIKE ${like}`,    // the reason tags
        `d.admin_comment ILIKE ${like}`,       // what the admin wrote back
        `d.rejection_reason ILIKE ${like}`,
        `d.wbes_acronym ILIKE ${like}`,        // plant acronym
        `d.time_blocks ILIKE ${like}`,
        `d.status ILIKE ${like}`,              // "pending", "resolved", ...
        `d.energy_category ILIKE ${like}`,     // "ISGS", "RE", "States"
      ];

      // A bare number is almost always a request number, so match it exactly
      // as well — searching "42" should find Req No 42, not just any text
      // containing 42.
      if (/^\d+$/.test(term)) {
        params.push(parseInt(term, 10));
        clauses.push(`d.req_no = $${params.length}`);
      }

      // "#42" is how request numbers are shown in the UI.
      const hashMatch = term.match(/^#\s*(\d+)$/);
      if (hashMatch) {
        params.push(parseInt(hashMatch[1], 10));
        clauses.push(`d.req_no = $${params.length}`);
      }

      conditions.push(`(${clauses.join(' OR ')})`);
    }

    if (fromDate) {
      params.push(fromDate);
      conditions.push(`d.correction_for_date >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate);
      conditions.push(`d.correction_for_date <= $${params.length}`);
    }

    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`d.status = $${params.length}`);
    }

    // Discrepancy type is its own filter. It used to be squeezed through the
    // status parameter on the admin screen, which produced
    // "WHERE status = 'Real-Time Instructions…'" and therefore never matched,
    // and through the free-text search on the user screen, which matched other
    // columns too. Types are stored as <tag> markers, so match on the marker.
    if (type && type !== 'ALL') {
      params.push(typeMatchPattern(type));
      conditions.push(`d.discrepancy_type ILIKE $${params.length}`);
    }

    if (category && category !== 'both') {
      params.push(category);
      conditions.push(`d.energy_category = $${params.length}`);
    }

    if (conditions.length > 0) {
      baseQuery += ' WHERE ' + conditions.join(' AND ');
    }

    const countQuery = baseQuery.replace('d.*, u.name as request_by_name', 'COUNT(*) as count');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    baseQuery += ` ORDER BY 
      CASE d.status 
        WHEN 'Pending' THEN 1 
        WHEN 'Returned' THEN 2 
        WHEN 'Resolved' THEN 3 
        WHEN 'Rejected' THEN 4 
        ELSE 5 
      END ASC, 
      d.req_no DESC`;
    
    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);
    const offset = (parsedPage - 1) * parsedLimit;
    
    params.push(parsedLimit);
    baseQuery += ` LIMIT $${params.length}`;
    params.push(offset);
    baseQuery += ` OFFSET $${params.length}`;

    const result = await pool.query(baseQuery, params);
    res.json({
      data: result.rows,
      total,
      page: parsedPage,
      limit: parsedLimit
    });
  } catch (err) {
    console.error('[DISC GET]', err);
    res.status(500).json({ error: 'Failed to fetch discrepancies.' });
  }
});

// POST /api/discrepancies/upload — Upload files to server/upload/
router.post('/upload', handleUploadErrors(upload.array('files')), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.json({ success: true, filenames: [] });
    }
    const filenames = req.files.map(file => file.filename);
    res.json({ success: true, filenames });
  } catch (err) {
    console.error('[UPLOAD ERROR]', err);
    res.status(500).json({ error: 'Failed to upload files.' });
  }
});

// POST /api/discrepancies — Create new
router.post('/', async (req, res) => {
  const { correctionDate, timeBlocks, requestContent, discrepancyType, files, wbes_acronym } = req.body;

  // The filer is whoever holds the token — never a name supplied in the body.
  const username = req.auth.username;

  if (!correctionDate || !timeBlocks || !requestContent) {
    return res.status(400).json({ error: 'correctionDate, timeBlocks, and requestContent are required.' });
  }

  // Only digits, commas and ranges, each block within the 96-block day. The
  // normalised form is what gets stored, so the column stays consistent.
  const parsedBlocks = parseTimeBlocks(timeBlocks);
  if (!parsedBlocks.ok) {
    return res.status(400).json({ error: parsedBlocks.error });
  }

  try {
    const configResult = await pool.query("SELECT key, value FROM config WHERE key IN ('maxDays', 'allowExtended', 'extendedMaxDays')");
    const config = {};
    configResult.rows.forEach(row => {
      config[row.key] = row.value;
    });

    const maxDays = parseInt(config.maxDays || '5');
    const allowExtended = config.allowExtended === 'true';
    const extendedMaxDays = parseInt(config.extendedMaxDays || '15');
    const diff = daysDiff(correctionDate);

    const checkLimit = allowExtended ? extendedMaxDays : maxDays;

    // A negative difference means the correction date is in the future, which
    // cannot be a discrepancy in a schedule that has not been operated yet.
    if (diff < 0) {
      await logEvent('error', `Discrepancy filing BLOCKED: User "${username}" tried to file for the future date ${correctionDate}`);
      return res.status(400).json({ error: 'The correction date cannot be in the future.' });
    }

    if (diff > checkLimit) {
      await logEvent('error', `Discrepancy filing BLOCKED: User "${username}" tried to file for ${correctionDate} which is ${diff} days old (limit: ${checkLimit})`);
      return res.status(400).json({ error: `Cannot file discrepancy older than ${checkLimit} days.` });
    }

    const userRes = await pool.query('SELECT role, energy_category, wbes_acronym FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const userRole = userRes.rows[0].role;
    let energy_category = userRes.rows[0].energy_category || 'ISGS';
    const defaultAcronym = userRes.rows[0].wbes_acronym || '';

    const targetAcronym = wbes_acronym || defaultAcronym;

    if (userRole === 'QCA') {
      if (!targetAcronym) {
        return res.status(400).json({ error: 'Select the plant this discrepancy is being filed for.' });
      }

      // A QCA may only file against an RE plant currently assigned to them.
      const plantRes = await pool.query(
        'SELECT energy_category FROM wbes_entities WHERE UPPER(wbes_acronym) = UPPER($1)',
        [targetAcronym]
      );
      if (plantRes.rows.length === 0) {
        return res.status(400).json({ error: `WBES Acronym "${targetAcronym}" is not registered in the system.` });
      }
      if (plantRes.rows[0].energy_category !== 'RE') {
        await logEvent('error', `Filing BLOCKED: QCA "${username}" attempted to file for non-RE plant ${targetAcronym} (${plantRes.rows[0].energy_category}).`);
        return res.status(403).json({ error: `Plant "${targetAcronym}" is an ${plantRes.rows[0].energy_category} entity. QCAs may file only for Renewable Energy (RE) plants.` });
      }

      const heldRes = await pool.query(
        `SELECT 1 FROM user_plant_assignments
          WHERE LOWER(username) = LOWER($1)
            AND wbes_acronym = $2
            AND $3::date >= from_date
            AND (to_date IS NULL OR $3::date <= to_date)
          LIMIT 1`,
        [username, targetAcronym, correctionDate]
      );
      if (heldRes.rows.length === 0) {
        await logEvent('error', `Filing BLOCKED: QCA "${username}" is not the assigned coordinator for ${targetAcronym} on ${correctionDate}.`);
        return res.status(403).json({ error: `You are not the assigned QCA for plant "${targetAcronym}" on ${correctionDate}.` });
      }

      energy_category = plantRes.rows[0].energy_category;
    }

    const result = await pool.query(
      `INSERT INTO discrepancies (request_by, request_date, correction_for_date, days_diff, time_blocks, request_content, discrepancy_type, status, energy_category, files, admin_comment, admin_files, rejection_reason, resolved_time, wbes_acronym)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, 'Pending', $7, $8::jsonb, '', '[]'::jsonb, '', NULL, $9)
       RETURNING *`,
      [username, correctionDate, diff >= 0 ? diff : 0, parsedBlocks.normalised, requestContent, discrepancyType || '', energy_category, JSON.stringify(files || []), targetAcronym]
    );

    await logEvent('success', `Discrepancy raised: Req No ${result.rows[0].req_no} for ${correctionDate} (${energy_category})`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[DISC POST]', err);
    res.status(500).json({ error: 'Failed to create discrepancy.' });
  }
});

// PATCH /api/discrepancies/:reqNo/process — Resolve, Reject, or Return
router.patch('/:reqNo/process', requireAdmin, async (req, res) => {
  const { reqNo } = req.params;
  const { status, comment, adminFiles, rejectionReason } = req.body;

  if (!['Resolved', 'Rejected', 'Returned'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Resolved, Rejected, or Returned.' });
  }

  try {
    const discRes = await pool.query('SELECT * FROM discrepancies WHERE req_no = $1', [reqNo]);
    if (discRes.rows.length === 0) return res.status(404).json({ error: 'Discrepancy not found.' });

    const disc = discRes.rows[0];
    const result = await pool.query(
      `UPDATE discrepancies SET status = $1, admin_comment = $2, admin_files = $3::jsonb, rejection_reason = $4, resolved_time = NOW()
       WHERE req_no = $5 RETURNING *`,
      [status, comment || '', JSON.stringify(adminFiles || []), rejectionReason || '', reqNo]
    );

    await logEvent('success', `Admin "${req.auth.username}" processed discrepancy Req No ${reqNo} as "${status.toUpperCase()}"`);

    // Log simulated email
    const userRes = await pool.query('SELECT email FROM users WHERE username = $1', [disc.request_by]);
    const email = userRes.rows[0]?.email || 'station@utility.in';
    const statusText = status === 'Resolved' ? 'Cleared' : (status === 'Returned' ? 'Returned for Review' : 'Rejected');
    await logEvent('info', `[EMAIL SYSTEM] Dispatched to <${email}>:\nSubject: NRLDC Scheduling Discrepancy Update: Req No ${reqNo}\nBody: The discrepancy status is now: ${statusText}. ${status === 'Returned' ? 'Reason: ' + comment : 'Kindly check and report if discrepancy still exists.'}`);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[DISC PROCESS]', err);
    res.status(500).json({ error: 'Failed to process discrepancy.' });
  }
});

// PATCH /api/discrepancies/:reqNo/reraise — Re-raise
router.patch('/:reqNo/reraise', async (req, res) => {
  const { reqNo } = req.params;
  const { requestContent, discrepancyType, files } = req.body;
  const username = req.auth.username;

  try {
    const configResult = await pool.query("SELECT key, value FROM config WHERE key IN ('reraiseWindow', 'reraiseLimit')");
    const config = {};
    configResult.rows.forEach(row => {
      config[row.key] = row.value;
    });

    const reraiseWindow = parseInt(config.reraiseWindow || '45');
    const reraiseLimit = parseInt(config.reraiseLimit || '2');

    const discRes = await pool.query('SELECT * FROM discrepancies WHERE req_no = $1', [reqNo]);
    if (discRes.rows.length === 0) return res.status(404).json({ error: 'Discrepancy not found.' });

    const disc = discRes.rows[0];

    if (!isAdmin(req) && !(await canAccessDiscrepancy(req, disc))) {
      return res.status(403).json({ error: 'You may only re-raise your own discrepancies.' });
    }

    const diff = daysDiff(disc.correction_for_date);

    if (diff > reraiseWindow) {
      await logEvent('error', `Re-raise BLOCKED: Req No ${reqNo} date ${disc.correction_for_date} is ${diff} days old (reraiseWindow: ${reraiseWindow})`);
      return res.status(400).json({ error: `Cannot re-raise — correction date is older than the configured limit of ${reraiseWindow} days.` });
    }

    if (disc.reraise_count >= reraiseLimit) {
      await logEvent('error', `Re-raise BLOCKED: Req No ${reqNo} count ${disc.reraise_count} has reached limit ${reraiseLimit}`);
      return res.status(400).json({ error: `Cannot re-raise — you have reached the maximum allowed limit of ${reraiseLimit} re-raises for this discrepancy.` });
    }

    // Merge new files into existing files JSON array
    const existingFiles = Array.isArray(disc.files) ? disc.files : [];
    const newFiles = Array.isArray(files) ? files : [];
    const mergedFiles = [...existingFiles, ...newFiles];

    const result = await pool.query(
      `UPDATE discrepancies SET 
         status = 'Pending', 
         request_date = CURRENT_DATE, 
         days_diff = $1, 
         request_content = $2, 
         discrepancy_type = $3, 
         files = $4::jsonb, 
         rejection_reason = '', 
         resolved_time = NULL, 
         reraise_count = reraise_count + 1
       WHERE req_no = $5 RETURNING *`,
      [diff >= 0 ? diff : 0, requestContent, discrepancyType, JSON.stringify(mergedFiles), reqNo]
    );

    await logEvent('success', `Discrepancy Req No ${reqNo} successfully RE-RAISED by user "${username}" (Count: ${result.rows[0].reraise_count}/${reraiseLimit})`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[DISC RERAISE]', err);
    res.status(500).json({ error: 'Failed to re-raise discrepancy.' });
  }
});

// GET /api/discrepancies/:reqNo/export-excel — Export discrepancy schedule as standardized Excel
router.get('/:reqNo/export-excel', async (req, res) => {
  const { reqNo } = req.params;
  try {
    const discRes = await pool.query('SELECT * FROM discrepancies WHERE req_no = $1', [reqNo]);
    if (discRes.rows.length === 0) {
      return res.status(404).json({ error: 'Discrepancy not found.' });
    }
    const disc = discRes.rows[0];

    if (!isAdmin(req) && !(await canAccessDiscrepancy(req, disc))) {
      return res.status(403).json({ error: 'You do not have access to this discrepancy.' });
    }

    // Blocks were validated on the way in, so this should always parse; if an
    // older row predates validation, fall back to an empty set rather than
    // failing the export.
    const parsed = parseTimeBlocks(disc.time_blocks);
    const affectedBlocks = new Set(parsed.ok ? parsed.blocks : []);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Schedule Discrepancy');

    worksheet.columns = [
      { header: 'Block', key: 'block', width: 8 },
      { header: 'Start Time', key: 'startTime', width: 12 },
      { header: 'End Time', key: 'endTime', width: 12 },
      { header: 'DC (MW)', key: 'dc', width: 12 },
      { header: 'Entitlement (MW)', key: 'entitlement', width: 18 },
      { header: 'Requisition (MW)', key: 'requisition', width: 18 },
      { header: 'SG (Schedule) (MW)', key: 'sg', width: 22 },
      { header: 'SG_Required (Revised) (MW)', key: 'sgRequired', width: 26 },
      { header: 'Deviation (MW)', key: 'deviation', width: 15 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total (MW)', key: 'total', width: 12 },
      { header: 'User Edits (Col M)', key: 'userEdits', width: 20 },
      { header: 'User Remarks (Col N)', key: 'userRemarks', width: 30 }
    ];

    // Header Meta rows
    worksheet.insertRow(1, ['NRLDC SCHEDULE DISCREPANCY PORTAL REPORT']);
    worksheet.insertRow(2, ['Request Number', `#${disc.req_no}`, 'Station', disc.request_by]);
    worksheet.insertRow(3, ['Correction Date', toDateString(disc.correction_for_date), 'Status', disc.status]);
    worksheet.insertRow(4, ['Remarks', disc.request_content]);
    worksheet.insertRow(5, ['Note', 'Schedule values are not held by this portal — complete columns D to N from your WBES records. Blocks flagged by this request are shaded.']);
    worksheet.insertRow(6, []); // blank row

    worksheet.getRow(1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
    for (let r = 2; r <= 4; r++) {
      worksheet.getRow(r).font = { name: 'Arial', size: 10, bold: true };
    }
    worksheet.getRow(5).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF92400E' } };

    // worksheet.columns wrote its header at row 1; the six inserted meta rows
    // pushed it down to row 7, which is where the real header is written.
    const headerRow = worksheet.getRow(7);
    headerRow.values = [
      'Block', 'Start Time', 'End Time', 'DC (MW)', 'Entitlement (MW)', 'Requisition (MW)', 
      'SG (Schedule) (MW)', 'SG_Required (Revised) (MW)', 'Deviation (MW)', 'Type', 'Status', 'Total (MW)',
      'User Edits (Col M)', 'User Remarks (Col N)'
    ];
    headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Generate all 96 blocks of the day.
    //
    // The portal does not hold DC / entitlement / requisition / schedule
    // values — those live in the WBES scheduling system — so the numeric
    // columns are deliberately left blank for the station to populate from
    // its own records. Only the block timings and which blocks the request
    // flagged are filled in here, because those are the facts we actually
    // have. Never substitute placeholder figures: a report that looks like
    // real schedule data but is not would be worse than an empty one.
    for (let i = 1; i <= 96; i++) {
      const startHour = Math.floor(((i - 1) * 15) / 60);
      const startMin = ((i - 1) * 15) % 60;
      const endHour = Math.floor((i * 15) / 60);
      const endMin = (i * 15) % 60;

      const pad = (n) => String(n).padStart(2, '0');
      const startStr = `${pad(startHour)}:${pad(startMin)}`;
      const endStr = `${pad(endHour)}:${pad(endMin)}`;

      const isAffected = affectedBlocks.has(i);

      const rowData = {
        block: i,
        startTime: startStr,
        endTime: endStr,
        dc: '',
        entitlement: '',
        requisition: '',
        sg: '',
        sgRequired: '',
        deviation: '',
        type: isAffected ? 'Discrepancy' : '',
        status: isAffected ? 'Flagged' : '',
        total: '',
        userEdits: '',
        userRemarks: ''
      };

      const row = worksheet.addRow(rowData);

      // Formatting and protection configuration
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Arial', size: 9 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        // Columns A–C (block timings) are reference data and stay locked.
        // Columns D–N are for the station to complete.
        if (colNumber <= 3) {
          cell.protection = { locked: true };
        } else {
          cell.protection = { locked: false };
        }

        // Highlight the blocks this request flagged.
        if (isAffected && colNumber <= 11) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          if (colNumber === 10 || colNumber === 11) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
          }
        }
      });
    }

    // Protect worksheet
    await worksheet.protect('nrldc_export_pass', {
      selectLockedCells: true,
      selectUnlockedCells: true
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=discrepancy_report_req_${disc.req_no}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXCEL EXPORT ERROR]', err);
    res.status(500).json({ error: 'Failed to generate Excel report: ' + err.message });
  }
});

module.exports = router;
