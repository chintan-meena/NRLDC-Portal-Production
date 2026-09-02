/**
 * routes/config.js — System configuration endpoints
 * GET   /api/config        → get all config values
 * PATCH /api/config        → update config values
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logEvent } = require('../utils/log');
const { requireAdmin, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { scopeToRegion } = require('../middleware/region');
const { GLOBAL_REGION, isGlobalKey, setSetting, getNumber } = require('../utils/settings');
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
  // Filing-window rules. postFactoCutoffDay is the day of the following month
  // after which a correction period closes for good; flaggedThresholdPercent
  // is the share of a filer's discrepancies marked flagged that flags them.
  'postFactoCutoffDay', 'flaggedThresholdPercent',
  // Whether ISGS / RE filers must attach the WBES Net Schedule Report Summary.
  'requireNetScheduleFile',
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


// GET /api/config
//
// The caller's own region's settings, with the shared ones merged in. There is
// no way to read another region's — not for any role.
router.get('/', async (req, res) => {
  try {
    // A national account has no region of its own, so it reads the shared
    // settings and nothing else — never another region's, and never a silent
    // default standing in for one.
    const region = req.auth?.region || null;
    const result = await pool.query(
      'SELECT key, value FROM config WHERE region = $1 OR region = $2',
      [region, GLOBAL_REGION]
    );
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
    config.region = region;
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

  // Settings that describe shared things — the one mail account, the one daily
  // allowance — land on every region at once, so they need a single owner.
  // That is the national administrator; it is the only shared thing that role
  // holds, and it grants no visibility into anyone else's data.
  const globalAttempts = Object.keys(updates).filter(isGlobalKey);
  if (globalAttempts.length > 0 && !isSuperAdmin(req)) {
    return res.status(403).json({
      error: `${globalAttempts.join(', ')} ${globalAttempts.length === 1 ? 'applies' : 'apply'} to every region, `
        + 'so only a national administrator can change '
        + (globalAttempts.length === 1 ? 'it.' : 'them.'),
    });
  }

  // Settings are written to the caller's own region, and there is no
  // client-supplied alternative — a region cannot be named in the body, so one
  // despatch centre's screen can never write another's rules.
  const region = req.auth?.region || null;
  const regionalKeys = Object.keys(updates).filter(k => !isGlobalKey(k));
  if (regionalKeys.length > 0 && !region) {
    return res.status(403).json({
      error: `${regionalKeys.join(', ')} ${regionalKeys.length === 1 ? 'belongs' : 'belong'} to each `
        + 'despatch centre. A national account holds none of its own — '
        + `each region’s administrator changes ${regionalKeys.length === 1 ? 'it' : 'them'} there.`,
    });
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      await setSetting(key, region, value);
    }
    await logEvent('info',
      `Settings updated for ${region || GLOBAL_REGION} by "${req.auth.username}": `
      + JSON.stringify(redactSecrets(updates)));
    res.json({ success: true, config: updates, region });
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
    // The allowance is one shared pot, so the totals are national however many
    // regions are using it. The device count is scoped, so a regional admin
    // sees how many of their own stations are currently trusted.
    const usage = await mailUsage();
    const days = await getNumber('otpTrustDays', null, 7);

    const params = [];
    const conditions = ['d.expires_at > NOW()'];
    scopeToRegion(req, 'u.region', conditions, params);
    const devices = await pool.query(
      `SELECT count(*)::int AS n FROM trusted_devices d
         JOIN users u ON d.username = u.username
        WHERE ${conditions.join(' AND ')}`,
      params
    );

    res.json({
      ...usage,
      shared: true,
      trustDays: days,
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
