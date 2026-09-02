/**
 * routes/auth.js — Login (Step 1 credentials) and OTP verification
 * POST /api/auth/login        → validates username/password, returns OTP session
 * POST /api/auth/verify-otp   → validates OTP, returns user object
 * POST /api/auth/register     → queues a registration for an admin to approve
 * POST /api/auth/forgot-password → emails a reset code (rate-limited by design)
 * POST /api/auth/reset-password  → completes a reset with that code
 * POST /api/auth/request-password-reset → queues a reset for an admin to approve
 *
 * Mail is the scarce resource here — the plan allows a few hundred messages a
 * day — so both code-sending paths are deliberately frugal. A login code is
 * only needed once per browser per week (see auth/devices.js), and a reset code
 * is not re-sent while an unexpired one is still outstanding.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const { logEvent } = require('../utils/log');
const { FILING_CATEGORIES } = require('../utils/trade');
const { issueToken } = require('../auth/tokens');
const { validatePassword } = require('../utils/password');
const { defaultUsernameFor } = require('../utils/usernames');
const { getBoolean, getNumber } = require('../utils/settings');
const { setContextRegion } = require('../utils/requestContext');
const { isValidRegion, REGIONS } = require('../middleware/region');
const { sendMail, numericConfig } = require('../utils/mailer');
const {
  rememberDevice, isDeviceTrusted, forgetDevices, pruneExpiredDevices, trustDays,
} = require('../auth/devices');

// ─── OTP storage ────────────────────────────────────────────────────────────
// OTPs live in the database, not in process memory: a restart used to strand
// everyone who was mid-login, and an in-memory map is simply wrong once more
// than one server process is running. The code is stored as an HMAC so a
// database dump does not hand over live login codes.

const OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes for a login code
const OTP_MAX_ATTEMPTS = 5;         // per issued code, then it is burned

/** A fresh 6-digit code from a cryptographic source, never Math.random(). */
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * The purpose is part of the HMAC, so a login code cannot be presented as a
 * password-reset code even though both live in the same table.
 */
function hashOtp(username, otp, purpose) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'nrldc-otp')
    .update(`${username.toLowerCase()}:${purpose}:${otp}`)
    .digest('hex');
}

async function storeOtp(username, otp, purpose, ttlMs) {
  await pool.query(
    `INSERT INTO login_otps (username, purpose, otp_hash, attempts, expires_at)
     VALUES ($1, $2, $3, 0, NOW() + ($4 || ' milliseconds')::interval)
     ON CONFLICT (username, purpose) DO UPDATE
       SET otp_hash = $3, attempts = 0,
           expires_at = NOW() + ($4 || ' milliseconds')::interval, created_at = NOW()`,
    [username, purpose, hashOtp(username, otp, purpose), String(ttlMs)]
  );
}

/**
 * An unexpired code of this purpose, if one is outstanding.
 *
 * This is what stops a user hammering "Forgot password" from spending the
 * day's mail allowance: while a code is still live, no second one is sent.
 */
async function liveOtp(username, purpose) {
  const res = await pool.query(
    `SELECT expires_at FROM login_otps
      WHERE LOWER(username) = LOWER($1) AND purpose = $2 AND expires_at > NOW()`,
    [username, purpose]
  );
  return res.rows[0] || null;
}

/**
 * Check a supplied code. Returns { ok } or { ok: false, error }, and consumes
 * the code on success. Wrong codes count against a five-attempt budget.
 */
async function consumeOtp(username, purpose, supplied) {
  const otpRes = await pool.query(
    'SELECT otp_hash, attempts, expires_at FROM login_otps WHERE LOWER(username) = LOWER($1) AND purpose = $2',
    [username, purpose]
  );
  if (otpRes.rows.length === 0) {
    return { ok: false, error: 'That code has expired or was already used. Please request a new one.' };
  }
  const record = otpRes.rows[0];

  const clear = () => pool.query(
    'DELETE FROM login_otps WHERE LOWER(username) = LOWER($1) AND purpose = $2', [username, purpose]
  );

  if (new Date(record.expires_at).getTime() < Date.now()) {
    await clear();
    return { ok: false, error: 'That code has expired. Please request a new one.' };
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await clear();
    return { ok: false, error: 'Too many incorrect codes. Please request a new one.' };
  }

  const expected = Buffer.from(record.otp_hash);
  const provided = Buffer.from(hashOtp(username, String(supplied).trim(), purpose));
  const matches = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!matches) {
    const updated = await pool.query(
      `UPDATE login_otps SET attempts = attempts + 1
        WHERE LOWER(username) = LOWER($1) AND purpose = $2 RETURNING attempts`,
      [username, purpose]
    );
    const used = updated.rows[0]?.attempts ?? 0;
    const left = Math.max(0, OTP_MAX_ATTEMPTS - used);
    // Burn it here rather than on the next attempt. A spent code left in the
    // table is unusable but still counts as outstanding, which blocked the
    // user from requesting a fresh one for the rest of its 20 minutes.
    if (left === 0) await clear();
    return {
      ok: false,
      attemptsLeft: left,
      error: left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect codes. Please request a new one.',
    };
  }

  await clear();      // single use
  return { ok: true };
}

/** Best-effort cleanup of codes, devices and tokens that can no longer be used. */
async function pruneExpired() {
  try {
    await pool.query('DELETE FROM login_otps WHERE expires_at < NOW()');
    await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
    await pruneExpiredDevices();
  } catch { /* not worth failing a login over */ }
}

/**
 * Is two-factor authentication switched on for this region?
 *
 * Each despatch centre holds its own switch, so one region turning OTP off
 * while its mail is broken does not weaken the others.
 */
async function is2faEnabled(region) {
  return getBoolean('require2FA', region, true);   // default on
}

/**
 * Answer a rejected login, OTP or reset attempt.
 *
 * These are answered with HTTP 200 and { success: false } so the client can
 * show the reason. That reads as a successful request to the rate limiter, so
 * the failure is flagged on res.locals for it to count — see
 * middleware/rateLimit.js. Every failure path goes through here.
 */
function authFailure(res, body) {
  res.locals.authFailed = true;
  return res.json(body);
}


// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, deviceToken } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
    // Get config
    // Find user first: the lockout threshold is a regional setting, so it
    // cannot be read until we know whose region applies.
    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (userRes.rows.length === 0) {
      await logEvent('error', `Login failed: Username "${username}" does not exist`);
      return authFailure(res, { success: false, error: 'Invalid username or password.' });
    }

    const user = userRes.rows[0];
    // Login is a public route, so the context has no region until now.
    setContextRegion(user.region);
    const lockoutAttempts = await getNumber('lockoutAttempts', user.region, 3);

    if (user.locked) {
      await logEvent('error', `Login blocked: User "${username}" is currently locked out`);
      return authFailure(res, { success: false, locked: true, error: 'Your account is locked. Please contact the Admin to unlock.' });
    }

    // Verify password
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const newFailed = (user.failed_attempts || 0) + 1;
      const shouldLock = newFailed >= lockoutAttempts;

      await pool.query(
        'UPDATE users SET failed_attempts = $1, locked = $2 WHERE username = $3',
        [newFailed, shouldLock, user.username]
      );

      if (shouldLock) {
        await logEvent('error', `User "${username}" exceeded max login attempts (${lockoutAttempts}). ACCOUNT LOCKED.`);
        return authFailure(res, { success: false, locked: true, error: `Maximum password attempts reached. Your account has been locked. Please contact Admin.` });
      } else {
        await logEvent('warn', `Failed login attempt ${newFailed}/${lockoutAttempts} for user "${username}"`);
        return authFailure(res, { success: false, error: `Invalid password. Attempt ${newFailed} of ${lockoutAttempts}.` });
      }
    }

    // Password correct — reset failed attempts
    await pool.query('UPDATE users SET failed_attempts = 0 WHERE username = $1', [user.username]);

    const { password_hash, ...safeUser } = user;

    // Three ways to skip the code:
    //   1. the account is exempt (bypass_2fa),
    //   2. an admin has turned two-factor off for everyone, or
    //   3. this browser already passed a code recently and is still trusted.
    //
    // The third is what makes the mail budget work: a code is needed once per
    // browser per week rather than once per login.
    const twoFactorOn = await is2faEnabled(user.region);
    if (user.bypass_2fa || !twoFactorOn) {
      const why = user.bypass_2fa ? '2FA bypassed for this account' : '2FA disabled system-wide by admin';
      await logEvent('success', `User "${username}" logged in directly (${why}).`);
      return res.json({ success: true, requiresOTP: false, user: safeUser, token: issueToken(user) });
    }

    if (await isDeviceTrusted(user.username, deviceToken)) {
      await logEvent('success', `User "${username}" logged in from a device already verified by OTP.`);
      return res.json({ success: true, requiresOTP: false, user: safeUser, token: issueToken(user) });
    }

    await pruneExpired();

    const otp = generateOtp();
    await storeOtp(user.username, otp, 'login', OTP_TTL_MS);

    await logEvent('success', `SUCCESS step-1 login for "${username}". Sending OTP...`);

    const mail = await sendMail({
      to: user.email,
      subject: 'NRLDC Portal Login - OTP Verification',
      text: `Hello ${user.name},\n\nYour One-Time Password (OTP) for logging into the NRLDC Schedule Discrepancy Platform is: ${otp}\n\nThis OTP is valid for 5 minutes.\n\nBest regards,\nNRLDC Team`,
      html: `<p>Hello <strong>${user.name}</strong>,</p>
             <p>Your One-Time Password (OTP) for logging into the NRLDC Schedule Discrepancy Platform is: <strong style="font-size: 1.2rem; color: #2563eb; letter-spacing: 1px;">${otp}</strong></p>
             <p>This OTP is valid for 5 minutes.</p>
             <p>Best regards,<br/>NRLDC Team</p>`,
    });

    if (mail.sent) {
      await logEvent('info', `[EMAIL SYSTEM] Dispatched Login OTP to <${user.email}>. ${mail.remaining} message(s) left in today's allowance.`);
    } else {
      await logEvent('error', `[EMAIL SYSTEM] Failed to dispatch OTP to <${user.email}>: ${mail.error}`);
    }

    // The password was already correct, so saying the code could not be sent
    // reveals nothing — and leaving the user waiting for mail that will never
    // arrive helps no one.
    return res.json({
      success: true,
      requiresOTP: true,
      username: user.username,
      email: user.email,
      mailFailed: !mail.sent,
      error: mail.sent
        ? undefined
        : mail.reason === 'quota'
          ? "The portal has reached today's email limit, so your code could not be sent. Please ask the NRLDC administrator to let you in."
          : 'Your code could not be emailed. Please ask the NRLDC administrator for help signing in.',
    });
  } catch (err) {
    console.error('[AUTH /login]', err);
    return res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// POST /api/auth/verify-otp
//
// A correct code both signs the user in and registers this browser as trusted,
// so the next login within the trust window needs no code — and no email.
router.post('/verify-otp', async (req, res) => {
  const { username, otp } = req.body;
  if (!username || !otp) {
    return res.json({ success: false, error: 'Username and OTP are required.' });
  }

  try {
    // Look up the real username so the HMAC matches regardless of typed case.
    const userRes = await pool.query(
      'SELECT id, username, name, role, region, email, email2, email3, mobile, energy_category, locked, preferred_landing, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    if (userRes.rows.length === 0) {
      return authFailure(res, { success: false, error: 'User not found.' });
    }
    const user = userRes.rows[0];
    setContextRegion(user.region);

    const check = await consumeOtp(user.username, 'login', otp);
    if (!check.ok) {
      await logEvent('error', `OTP verification failed for "${user.username}": ${check.error}`);
      return authFailure(res, { success: false, error: check.error });
    }

    if (user.locked) {
      return authFailure(res, { success: false, error: 'Your account is locked. Please contact the Admin.' });
    }

    // Trust this browser from here on, so the next sign-in costs no email.
    const deviceToken = await rememberDevice(user.username, req.get('user-agent'));
    const days = await trustDays();

    await logEvent('success',
      `OTP verified! User "${user.username}" successfully logged in.`
      + (deviceToken ? ` This device is trusted for ${days} day(s).` : ''));

    return res.json({
      success: true,
      user,
      token: issueToken(user),
      deviceToken,
      deviceTrustDays: deviceToken ? days : 0,
    });
  } catch (err) {
    console.error('[AUTH /verify-otp]', err);
    return res.status(500).json({ success: false, error: 'Server error during OTP verification.' });
  }
});

// POST /api/auth/forgot-password — email a reset code
//
// This used to email a freshly generated password, which meant a working
// password sat in an inbox forever and anyone could force one to be sent. It
// now emails a short-lived code that does nothing on its own; the caller
// proves they received it at /reset-password and chooses their own password.
//
// Two things protect the mail allowance. While a code is still unexpired no
// second one is sent, so repeatedly pressing the button costs nothing. And the
// reply is identical whether or not the account exists, so the endpoint cannot
// be used to enumerate usernames — or to make the portal send mail to an
// address the caller picked.
router.post('/forgot-password', async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, error: 'Username is required.' });
  }

  const minutes = await numericConfig('resetOtpMinutes', 20);
  const GENERIC_REPLY = {
    success: true,
    codeSent: true,
    expiresInMinutes: minutes,
    message: `If that account exists, a ${minutes}-minute reset code has been emailed to its registered address. Enter it below to choose a new password.`,
  };

  try {
    const userRes = await pool.query(
      'SELECT username, name, email FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
    if (userRes.rows.length === 0) {
      await logEvent('warn', `Password recovery requested for unknown username "${username}"`);
      return res.json(GENERIC_REPLY);
    }
    const user = userRes.rows[0];

    // A code is already outstanding — say the same thing, send nothing.
    const outstanding = await liveOtp(user.username, 'reset');
    if (outstanding) {
      await logEvent('info',
        `Password reset code re-requested by "${user.username}" while one was still valid — no second email sent.`);
      return res.json(GENERIC_REPLY);
    }

    const otp = generateOtp();
    await storeOtp(user.username, otp, 'reset', minutes * 60 * 1000);

    const mail = await sendMail({
      to: user.email,
      subject: 'NRLDC Portal - Password Reset Code',
      text: `Hello ${user.name},\n\nYour password reset code for the NRLDC Schedule Discrepancy Portal is: ${otp}\n\nEnter it on the sign-in screen within ${minutes} minutes to choose a new password.\n\nIf you did not request this, you can ignore this email — the code alone cannot change anything, and your current password still works.\n\nBest regards,\nNRLDC Team`,
      html: `<p>Hello <strong>${user.name}</strong>,</p>
             <p>Your password reset code for the NRLDC Schedule Discrepancy Portal is: <strong style="font-size: 1.2rem; color: #2563eb; letter-spacing: 1px;">${otp}</strong></p>
             <p>Enter it on the sign-in screen within <strong>${minutes} minutes</strong> to choose a new password.</p>
             <p>If you did not request this, you can ignore this email — the code alone cannot change anything, and your current password still works.</p>
             <p>Best regards,<br/>NRLDC Team</p>`,
    });

    if (mail.sent) {
      await logEvent('info', `[EMAIL SYSTEM] Password reset code sent to <${user.email}>. ${mail.remaining} message(s) left in today's allowance.`);
    } else {
      // Drop the code we cannot deliver, so the user is not blocked from
      // trying again by a cooldown protecting an email that never went out.
      await pool.query(
        "DELETE FROM login_otps WHERE LOWER(username) = LOWER($1) AND purpose = 'reset'", [user.username]
      );
      await logEvent('error', `[EMAIL SYSTEM] Failed to send reset code to <${user.email}>: ${mail.error}`);
      if (mail.reason === 'quota') {
        return res.json({
          success: true,
          codeSent: false,
          message: "The portal has reached today's email limit. Please use \u201cAsk an administrator to reset it\u201d instead.",
        });
      }
    }

    return res.json(GENERIC_REPLY);
  } catch (err) {
    console.error('[AUTH /forgot-password]', err);
    return res.status(500).json({ success: false, error: 'Server error during password recovery.' });
  }
});

// POST /api/auth/reset-password — finish the reset with the emailed code
//
// The code proves the caller reads the account's mailbox; the password they
// choose here is their own, so nothing usable is ever sent by email. Every
// trusted device for the account is dropped: whoever the reset is protecting
// against must not keep a browser that skips the OTP.
router.post('/reset-password', async (req, res) => {
  const { username, otp, password } = req.body || {};
  if (!username || !otp || !password) {
    return res.status(400).json({ success: false, error: 'Username, code and new password are all required.' });
  }

  const policyError = validatePassword(password);
  if (policyError) {
    return res.status(400).json({ success: false, error: policyError });
  }

  try {
    const userRes = await pool.query(
      'SELECT username, name FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
    if (userRes.rows.length === 0) {
      // Same wording a wrong code gets, so this cannot confirm an account.
      return authFailure(res, { success: false, error: 'That code has expired or was already used. Please request a new one.' });
    }
    const user = userRes.rows[0];

    const check = await consumeOtp(user.username, 'reset', otp);
    if (!check.ok) {
      await logEvent('warn', `Password reset code rejected for "${user.username}": ${check.error}`);
      return authFailure(res, { success: false, error: check.error });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked = FALSE WHERE username = $2',
      [hash, user.username]
    );
    const dropped = await forgetDevices(user.username);

    await logEvent('success',
      `User "${user.username}" reset their own password with an emailed code.`
      + (dropped ? ` ${dropped} trusted device(s) were signed out.` : ''));

    return res.json({
      success: true,
      message: 'Your password has been changed. Please sign in with it.',
    });
  } catch (err) {
    console.error('[AUTH /reset-password]', err);
    return res.status(500).json({ success: false, error: 'Server error while resetting your password.' });
  }
});

// POST /api/auth/logout — revoke the caller's token
// Tokens are stateless and signed, so signing out has to record the token id
// until it would have expired anyway; requireAuth refuses anything listed.
// Mounted with requireAuth in index.js so req.token is populated.
router.post('/logout', async (req, res) => {
  try {
    const claims = req.token;
    if (claims?.jti) {
      await pool.query(
        `INSERT INTO revoked_tokens (jti, username, expires_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (jti) DO NOTHING`,
        [claims.jti, req.auth.username, claims.exp]
      );
      await logEvent('info', `User "${req.auth.username}" signed out; session revoked.`);
    }
    await pruneExpired();
    res.json({ success: true });
  } catch (err) {
    console.error('[AUTH /logout]', err);
    // Never block a sign-out: the client clears its copy regardless.
    res.json({ success: true });
  }
});

// POST /api/auth/register — self-service registration
//
// This does NOT create an account. It records a request that an administrator
// must approve; until then the applicant cannot sign in. The password they
// choose is hashed immediately and carried across on approval, so it is never
// stored or transmitted in the clear and no temporary password is needed.
//
// The WBES acronym given here is final — it identifies the plant, and neither
// the applicant nor the approving admin can change it afterwards.
router.post('/register', async (req, res) => {
  const { username, name, role, email, mobile, password, energy_category, wbes_acronym, qca_name, region } = req.body || {};

  // The username follows from the acronym (DADRI → dadri@nrldc), so an
  // applicant who leaves it blank still gets the conventional name rather than
  // an error. Anything they typed themselves is kept as-is.
  const derivedUsername = (username && String(username).trim())
    ? String(username).trim()
    : defaultUsernameFor(wbes_acronym);

  const required = { username: derivedUsername, name, role, email, password, energy_category, wbes_acronym };
  const missing = Object.entries(required).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
  if (missing.length > 0) {
    return res.status(400).json({ error: `These fields are required: ${missing.join(', ')}.` });
  }

  if (!['USER', 'QCA'].includes(role)) {
    return res.status(400).json({ error: 'Choose either a plant user or a QCA account.' });
  }
  if (!FILING_CATEGORIES.includes(energy_category)) {
    return res.status(400).json({ error: `Choose a valid energy category: ${FILING_CATEGORIES.join(', ')}.` });
  }
  // The region decides which despatch centre's administrator reviews this.
  if (!isValidRegion(region)) {
    return res.status(400).json({ error: `Choose your load despatch centre: ${REGIONS.join(', ')}.` });
  }

  // QCAs coordinate Renewable Energy plants only — the same rule the rest of
  // the portal enforces, applied before the account exists.
  if (role === 'QCA') {
    if (energy_category !== 'RE') {
      return res.status(400).json({ error: 'QCA accounts are for Renewable Energy (RE) plants only.' });
    }
    if (!qca_name || !qca_name.trim()) {
      return res.status(400).json({ error: 'Enter the name of your coordinating agency.' });
    }
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const cleanUsername = derivedUsername.trim();
  const cleanAcronym = wbes_acronym.trim().toUpperCase();
  const cleanEmail = email.trim();

  try {
    // Taken by an existing account?
    const clash = await pool.query(
      `SELECT
         (SELECT count(*) FROM users WHERE LOWER(username) = LOWER($1))                    AS username_taken,
         (SELECT count(*) FROM users WHERE UPPER(TRIM(wbes_acronym)) = $2)                 AS acronym_taken,
         (SELECT count(*) FROM users WHERE LOWER(email) = LOWER($3))                       AS email_taken`,
      [cleanUsername, cleanAcronym, cleanEmail]
    );
    const c = clash.rows[0];
    if (Number(c.username_taken) > 0) {
      return res.status(409).json({ error: 'That username is already registered. Try signing in, or use Forgot Password.' });
    }
    if (Number(c.acronym_taken) > 0) {
      return res.status(409).json({ error: `WBES acronym "${cleanAcronym}" is already registered to an account. Contact the NRLDC Admin if this is your plant.` });
    }
    if (Number(c.email_taken) > 0) {
      return res.status(409).json({ error: 'That email address is already registered to an account.' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO registration_requests
         (username, name, role, email, mobile, password_hash, energy_category, wbes_acronym, qca_name, region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, created_at`,
      [
        cleanUsername, name.trim(), role, cleanEmail,
        mobile && mobile.trim() ? mobile.trim() : null,
        hash, energy_category, cleanAcronym,
        role === 'QCA' ? qca_name.trim() : null,
        region,
      ]
    );

    await logEvent('info',
      `Registration request #${result.rows[0].id} submitted: "${cleanUsername}" (${region}, ${role}, ${energy_category}, WBES ${cleanAcronym}) — awaiting admin approval.`,
      region);

    return res.status(201).json({
      success: true,
      requestId: result.rows[0].id,
      message: 'Registration submitted. An NRLDC administrator will review it, and you will be able to sign in once it is approved.',
    });
  } catch (err) {
    // A pending request already exists for this username or acronym.
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'A registration for this username or WBES acronym is already awaiting approval.',
      });
    }
    console.error('[AUTH /register]', err);
    return res.status(500).json({ error: 'Server error while submitting your registration.' });
  }
});

// POST /api/auth/request-password-reset — ask an administrator for a reset
//
// This is the path for someone who cannot use /forgot-password because email
// is not reaching them, which is the common case: the portal sits behind an
// IP allow-list on an operational network and mail is the fragile part. No
// password changes here — the request goes into a queue, and an administrator
// approving it is what resets the account to the default password.
//
// The reply is identical whether or not the account exists, so this cannot be
// used to find out which usernames are real.
router.post('/request-password-reset', async (req, res) => {
  const { username, reason } = req.body || {};
  if (!username || !String(username).trim()) {
    return res.status(400).json({ success: false, error: 'Username is required.' });
  }

  const GENERIC_REPLY = {
    success: true,
    message: 'Your request has been sent to the NRLDC administrator. You will be contacted once it has been reviewed.',
  };

  const clean = String(username).trim();
  try {
    const userRes = await pool.query(
      'SELECT username, name FROM users WHERE LOWER(username) = LOWER($1)', [clean]
    );
    if (userRes.rows.length === 0) {
      await logEvent('warn', `Password reset requested for unknown username "${clean}"`);
      return res.json(GENERIC_REPLY);
    }
    const user = userRes.rows[0];

    await pool.query(
      `INSERT INTO password_reset_requests (username, reason) VALUES ($1, $2)`,
      [user.username, reason && String(reason).trim() ? String(reason).trim().slice(0, 500) : '']
    );

    await logEvent('warn', `Password reset requested by "${user.username}" — awaiting admin approval.`);
    return res.json(GENERIC_REPLY);
  } catch (err) {
    // A pending request already exists — from the user's point of view their
    // request is in the queue either way, so say the same thing.
    if (err.code === '23505') {
      return res.json(GENERIC_REPLY);
    }
    console.error('[AUTH /request-password-reset]', err);
    return res.status(500).json({ success: false, error: 'Server error while submitting your request.' });
  }
});

module.exports = router;
