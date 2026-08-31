/**
 * routes/config.js — System configuration endpoints
 * GET   /api/config        → get all config values
 * PATCH /api/config        → update config values
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdmin, isAdmin } = require('../middleware/auth');
const { mailUsage } = require('../utils/mailer');

// Only these keys may be written through the API. Anything else — including
// the internal 'last_users_backup' blob — is rejected, so a caller cannot
// invent config rows or repoint the SMTP server used to deliver login OTPs.
const WRITABLE_KEYS = new Set([
  'maxDays', 'lockoutAttempts', 'allowExtended', 'extendedMaxDays',
  'reraiseWindow', 'reraiseLimit',
  'outage_ISGS', 'outage_RE', 'outage_States',
  'require2FA',
  'feature_cycle_data',
  // Mail budget controls. otpTrustDays is the lever that matters: it decides
  // how often a user is asked for a code, and so how much mail the portal
  // needs. See auth/devices.js.
  'otpTrustDays', 'resetOtpMinutes', 'mailDailyCap',
  'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom'
]);

// Keys that must never be handed to a non-admin caller.
const ADMIN_ONLY_KEYS = (key) => key.startsWith('smtp') || key === 'last_users_backup';

function redactSecrets(updates) {
  const safe = { ...updates };
  if ('smtpPass' in safe) safe.smtpPass = '********';
  return safe;
}

async function logEvent(type, message) {
  try {
    await pool.query('INSERT INTO system_logs (type, message) VALUES ($1, $2)', [type, message]);
  } catch (e) { /* silent */ }
}

// GET /api/config
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM config');
    const admin = isAdmin(req);
    const config = {};
    result.rows.forEach(row => {
      // SMTP credentials are operational secrets — only admins receive them.
      if (!admin && ADMIN_ONLY_KEYS(row.key)) return;
      let val = row.value;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(val) && val.trim() !== '') val = parseInt(val);
      config[row.key] = val;
    });
    res.json(config);
  } catch (err) {
    console.error('[CONFIG GET]', err);
    res.status(500).json({ error: 'Failed to fetch config.' });
  }
});

// PATCH /api/config
router.patch('/', requireAdmin, async (req, res) => {
  const updates = req.body || {};

  const rejected = Object.keys(updates).filter(k => !WRITABLE_KEYS.has(k));
  if (rejected.length > 0) {
    return res.status(400).json({ error: `Unknown configuration key(s): ${rejected.join(', ')}.` });
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, String(value)]
      );
    }
    await logEvent('info', `Security/regulation config updated by "${req.auth.username}": ${JSON.stringify(redactSecrets(updates))}`);
    res.json({ success: true, config: updates });
  } catch (err) {
    console.error('[CONFIG PATCH]', err);
    res.status(500).json({ error: 'Failed to update config.' });
  }
});

// GET /api/config/mail-usage — how much of today's allowance is left.
//
// The mail plan is the portal's tightest resource, and running out of it is
// invisible from the outside: codes simply stop arriving. Surfacing the number
// means an admin can see it coming.
router.get('/mail-usage', requireAdmin, async (req, res) => {
  try {
    const usage = await mailUsage();
    const trustRes = await pool.query("SELECT value FROM config WHERE key = 'otpTrustDays'");
    const days = parseInt(trustRes.rows[0]?.value ?? '7', 10);
    const devices = await pool.query(
      'SELECT count(*)::int AS n FROM trusted_devices WHERE expires_at > NOW()'
    );
    res.json({
      ...usage,
      trustDays: Number.isFinite(days) ? days : 7,
      trustedDevices: devices.rows[0].n,
    });
  } catch (err) {
    console.error('[CONFIG mail-usage]', err);
    res.status(500).json({ error: 'Could not read the mail usage.' });
  }
});

const nodemailer = require('nodemailer');

// POST /api/config/test-smtp
router.post('/test-smtp', requireAdmin, async (req, res) => {
  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFrom, testRecipient } = req.body;
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !testRecipient) {
    return res.status(400).json({ error: 'All SMTP settings and test recipient email are required.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpSecure === true || smtpSecure === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      timeout: 5000 // 5 seconds timeout
    });

    await transporter.verify();

    const mailOptions = {
      from: smtpFrom || `"NRLDC Portal" <${smtpUser}>`,
      to: testRecipient,
      subject: 'NRLDC Portal - SMTP Connection Test',
      text: 'Congratulations! The SMTP configuration is correct and connection was verified successfully.',
      html: '<h3>NRLDC Portal</h3><p>Congratulations! The SMTP configuration is correct and connection was verified successfully.</p>'
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'SMTP credentials verified and test email sent successfully!' });
  } catch (err) {
    console.error('[SMTP TEST ERROR]', err);
    res.status(500).json({ error: `SMTP verification failed: ${err.message}` });
  }
});

module.exports = router;
