/**
 * utils/mailer.js — Outgoing mail, configured from the database, metered.
 *
 * SMTP settings live in the config table so an administrator can change them
 * from System Parameters without a redeploy.
 *
 * Everything goes out through sendMail(), which counts against a daily
 * allowance. The portal's mail plan is small — a few hundred messages a day —
 * and the failure mode of exceeding it is the bad kind: the provider starts
 * rejecting mail, users stop receiving login codes, and nothing in the portal
 * says why. Metering here means the portal stops on its own terms, writes a
 * log entry that names the cap, and can show an admin how much is left.
 */

const nodemailer = require('nodemailer');
const pool = require('../db');

/** Read a numeric setting, falling back when it is missing or unparseable. */
async function numericConfig(key, fallback) {
  try {
    const res = await pool.query('SELECT value FROM config WHERE key = $1', [key]);
    if (res.rows.length === 0) return fallback;
    const n = parseInt(res.rows[0].value, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

async function getTransporter() {
  const configRes = await pool.query("SELECT key, value FROM config WHERE key LIKE 'smtp%'");
  const smtp = {};
  configRes.rows.forEach(row => { smtp[row.key] = row.value; });

  const user = smtp.smtpUser || process.env.SMTP_USER || '';
  const transporter = nodemailer.createTransport({
    host: smtp.smtpHost || process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(smtp.smtpPort || process.env.SMTP_PORT || '587'),
    secure: (smtp.smtpSecure === 'true') || (process.env.SMTP_SECURE === 'true'),
    auth: { user, pass: smtp.smtpPass || process.env.SMTP_PASS || '' },
  });

  const from = smtp.smtpFrom || process.env.SMTP_FROM || `"NRLDC Portal" <${user}>`;
  return { transporter, from };
}

/**
 * Claim one message from today's allowance.
 *
 * The counter is incremented first and rolled back if the send fails, so two
 * requests arriving together cannot both believe they had the last slot. A day
 * with no row yet is created by the same statement.
 *
 * Returns { ok, sent, cap } — ok is false when the cap is already reached.
 */
async function claimQuota(cap) {
  const res = await pool.query(
    `INSERT INTO mail_quota (day, sent) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (day) DO UPDATE
       SET sent = mail_quota.sent + 1, updated_at = NOW()
     RETURNING sent`
  );
  const sent = res.rows[0].sent;
  if (sent > cap) {
    // Over-claimed: give the slot back and record that a message was withheld.
    await pool.query(
      `UPDATE mail_quota
          SET sent = GREATEST(sent - 1, 0), suppressed = suppressed + 1, updated_at = NOW()
        WHERE day = CURRENT_DATE`
    );
    return { ok: false, sent: cap, cap };
  }
  return { ok: true, sent, cap };
}

/** Hand a claimed slot back after a failed send — no message actually left. */
async function releaseQuota() {
  try {
    await pool.query(
      `UPDATE mail_quota SET sent = GREATEST(sent - 1, 0), updated_at = NOW()
        WHERE day = CURRENT_DATE`
    );
  } catch { /* the count drifting by one is not worth failing anything over */ }
}

async function logEvent(type, message) {
  try {
    await pool.query('INSERT INTO system_logs (type, message) VALUES ($1, $2)', [type, message]);
  } catch { /* never let logging break a send */ }
}

/**
 * Send a message, reporting success rather than throwing.
 *
 * Notifications must never fail the action that triggered them: an approved
 * registration is still approved whether or not the email got out.
 *
 * Returns { sent, reason?, error?, remaining? }. `reason` is 'quota' when the
 * day's allowance is gone — the caller can tell the user something useful
 * rather than leaving them waiting for a code that will never arrive.
 */
async function sendMail({ to, subject, text, html }) {
  const cap = await numericConfig('mailDailyCap', 280);

  let claim;
  try {
    claim = await claimQuota(cap);
  } catch (err) {
    // The counter is unavailable; sending blind is better than not sending.
    console.error('[MAIL QUOTA]', err.message);
    claim = { ok: true, sent: 0, cap };
  }

  if (!claim.ok) {
    await logEvent('error',
      `[EMAIL SYSTEM] Daily mail allowance of ${cap} reached — message to <${to}> ("${subject}") was NOT sent. ` +
      `Raise mailDailyCap in System Parameters, or wait until tomorrow.`);
    return { sent: false, reason: 'quota', error: `Daily mail limit of ${cap} reached.`, remaining: 0 };
  }

  try {
    const { transporter, from } = await getTransporter();
    await transporter.sendMail({ from, to, subject, text, html });

    const remaining = Math.max(0, cap - claim.sent);
    // One warning as the allowance runs low, rather than silence until it is gone.
    if (remaining === Math.floor(cap * 0.2)) {
      await logEvent('warn',
        `[EMAIL SYSTEM] ${claim.sent} of ${cap} messages used today — ${remaining} left.`);
    }
    return { sent: true, remaining };
  } catch (err) {
    console.error('[SMTP]', err.message);
    await releaseQuota();
    return { sent: false, reason: 'smtp', error: err.message };
  }
}

/** Today's usage, for the admin's System Parameters page. */
async function mailUsage() {
  const cap = await numericConfig('mailDailyCap', 280);
  try {
    const res = await pool.query(
      'SELECT sent, suppressed FROM mail_quota WHERE day = CURRENT_DATE'
    );
    const row = res.rows[0] || { sent: 0, suppressed: 0 };
    return {
      sent: row.sent,
      suppressed: row.suppressed,
      cap,
      remaining: Math.max(0, cap - row.sent),
    };
  } catch {
    return { sent: 0, suppressed: 0, cap, remaining: cap };
  }
}

module.exports = { getTransporter, sendMail, mailUsage, numericConfig };
