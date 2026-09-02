/**
 * routes/users.js — User management endpoints
 * GET    /api/users                  → list all users
 * POST   /api/users                  → register new user
 * PATCH  /api/users/:username/lock   → toggle lock
 * PATCH  /api/users/:username/profile → update profile details (name, email, email2, email3, mobile) OR password
 * PATCH  /api/users/:username/landing → update preferred landing
 * POST   /api/users/bulk-import      → CSV bulk import
 * POST   /api/users/rollback-import  → Roll back last CSV import
 * POST   /api/users/:username/reset-password → Admin reset password to the default
 * GET    /api/users/registrations    → self-service registrations awaiting a decision
 * PATCH  /api/users/registrations/:id/process → approve (optionally with corrections) or reject
 * GET    /api/users/password-resets  → password reset requests awaiting a decision
 * PATCH  /api/users/password-resets/:id/process → approve or reject a reset
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { logEvent } = require('../utils/log');
const { withTransaction } = require('../db');
const { requireAdmin, requireSelfOrAdmin, isAdmin } = require('../middleware/auth');
const {
  requireSameRegion, scopeToRegion, regionForNewRow, regionForNewAccount,
  canActOnRegion, crossRegionError,
} = require('../middleware/region');
const { previousDayString } = require('../utils/dates');
const { DEFAULT_PASSWORD, validatePassword } = require('../utils/password');
const { setSetting, getSetting } = require('../utils/settings');
const { usernameForRegion } = require('../utils/usernames');
const { FILING_CATEGORIES } = require('../utils/trade');
const { sendMail, mailUsage } = require('../utils/mailer');
const { forgetDevices, listDevices } = require('../auth/devices');

const HASH_ROUNDS = 10;

/**
 * Look up a plant's energy category. QCA coordination is permitted for
 * Renewable Energy plants only, so this is the gate for every QCA linkage.
 */
async function getPlantCategory(acronym) {
  const res = await pool.query(
    'SELECT energy_category FROM wbes_entities WHERE UPPER(wbes_acronym) = UPPER($1)',
    [acronym]
  );
  return res.rows.length > 0 ? res.rows[0].energy_category : null;
}

/**
 * Validate a role/category pair. QCA accounts must sit in the RE category —
 * ISGS and States plants are handled by their own users, never by a QCA.
 * Returns an error string, or null when the combination is allowed.
 */
function validateQcaCategory(role, energy_category, qca_name) {
  if (role !== 'QCA') return null;
  if (energy_category !== 'RE') {
    return 'QCA accounts are permitted for Renewable Energy (RE) plants only. Set the energy category to RE, or choose a different role.';
  }
  if (!qca_name || !qca_name.trim()) {
    return 'QCA Name is required for QCA accounts.';
  }
  return null;
}


async function checkUniqueness(username, emails, mobile, wbes_acronym) {
  const errors = [];

  // Check emails
  if (emails.length > 0) {
    const placeholders = emails.map((_, i) => `$${i + 2}`).join(', ');
    const query = `
      SELECT username FROM users 
      WHERE (
        LOWER(email) IN (${placeholders}) OR 
        LOWER(email2) IN (${placeholders}) OR 
        LOWER(email3) IN (${placeholders})
      ) AND LOWER(username) != LOWER($1)
    `;
    const res = await pool.query(query, [username, ...emails.map(e => e.toLowerCase())]);
    if (res.rows.length > 0) {
      errors.push('One or more of the specified email addresses are already associated with another account.');
    }
  }

  // Check mobile
  if (mobile && mobile.trim() !== '') {
    const res = await pool.query(
      `SELECT username FROM users WHERE TRIM(mobile) = $1 AND LOWER(username) != LOWER($2)`,
      [mobile.trim(), username]
    );
    if (res.rows.length > 0) {
      errors.push('The specified mobile number is already associated with another account.');
    }
  }

  // Check WBES Acronym
  if (wbes_acronym && wbes_acronym.trim() !== '') {
    const res = await pool.query(
      `SELECT username FROM users WHERE UPPER(TRIM(wbes_acronym)) = UPPER($1) AND LOWER(username) != LOWER($2)`,
      [wbes_acronym.trim().toUpperCase(), username]
    );
    if (res.rows.length > 0) {
      errors.push('The specified WBES Acronym is already associated with another account.');
    }
  }

  return errors;
}

// GET /api/users — admin only (full registry, including lock state)
router.get('/', requireAdmin, async (req, res) => {
  try {
    // An admin sees their own region's accounts. A super-admin sees every
    // region, or one in particular with ?region=ERLDC.
    const params = [];
    const conditions = [];
    scopeToRegion(req, 'region', conditions, params);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, username, name, role, region, email, email2, email3, mobile, energy_category,
              locked, failed_attempts, preferred_landing, bypass_2fa, can_upload_cycle_data,
              wbes_acronym, qca_name
         FROM users ${where} ORDER BY id ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[USERS GET]', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// POST /api/users — Register new user (admin only)
router.post('/', requireAdmin, async (req, res) => {
  const { username, name, role, email, email2, email3, mobile, password, energy_category, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name } = req.body;

  if (!username || !name || !email || !role || !wbes_acronym) {
    return res.status(400).json({ error: 'username, name, role, email, and wbes_acronym are required.' });
  }

  // Validate role
  if (!['SUPERADMIN', 'ADMIN', 'USER', 'QCA'].includes(role)) {
    return res.status(400).json({ error: 'Role must be ADMIN, USER, or QCA.' });
  }

  // Who may create what, and where. See regionForNewAccount: the national
  // administrator creates administrators in any region and no ordinary users;
  // a regional administrator creates ordinary users in its own region and no
  // administrators.
  const placement = regionForNewAccount(req, role, req.body.region);
  if (!placement.ok) {
    return res.status(403).json({ error: placement.error });
  }
  const newRegion = placement.region;

  // The account is named inside its region's namespace, whatever was typed.
  // An NRLDC administrator sending "user1@erldc" gets "user1@nrldc" — there is
  // no input that produces an account named for a region it does not belong to.
  const namespacedUsername = usernameForRegion(username, newRegion);
  if (!namespacedUsername) {
    return res.status(400).json({ error: 'That username cannot be used. Use letters, digits, dots or hyphens.' });
  }

  const category = FILING_CATEGORIES.includes(energy_category) ? energy_category : 'ISGS';

  // QCAs are RE-only — reject rather than silently rewriting the category.
  const qcaError = validateQcaCategory(role, category, qca_name);
  if (qcaError) {
    return res.status(400).json({ error: qcaError });
  }

  const rawPassword = password || DEFAULT_PASSWORD;
  const passwordError = validatePassword(rawPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  // Perform uniqueness checks
  const emailsToCheck = [email, email2, email3].filter(Boolean).map(e => e.trim());
  const uniqueErrors = await checkUniqueness(namespacedUsername, emailsToCheck, mobile, wbes_acronym);
  if (uniqueErrors.length > 0) {
    return res.status(400).json({ error: uniqueErrors.join(' ') });
  }

  try {
    const hash = await bcrypt.hash(rawPassword, HASH_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, name, role, region, email, email2, email3, mobile, password_hash, energy_category, locked, failed_attempts, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name)
       VALUES ($1, $2, $3, $14, $4, $5, $6, $7, $8, $9, FALSE, 0, $10, $11, $12, $13)
       RETURNING id, username, name, role, region, email, email2, email3, mobile, energy_category, locked, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name`,
      [
        namespacedUsername,
        name.trim(), 
        role, 
        email.trim(), 
        email2 ? email2.trim() : null, 
        email3 ? email3.trim() : null, 
        mobile ? mobile.trim() : null, 
        hash, 
        category, 
        !!bypass_2fa,
        !!can_upload_cycle_data,
        wbes_acronym.trim().toUpperCase(),
        qca_name ? qca_name.trim() : null,
        newRegion
      ]
    );

    // A new plant joins its creator's region too, so the register and the
    // account cannot disagree about who despatches it.
    await pool.query(
      `INSERT INTO wbes_entities (wbes_acronym, name, energy_category, region)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wbes_acronym) DO NOTHING`,
      [wbes_acronym.trim().toUpperCase(), name.trim(), category, newRegion]
    );

    await logEvent('success', `New user registered: ${namespacedUsername} (${newRegion}, ${category} category, role: ${role}, wbes: ${wbes_acronym}, qca: ${qca_name || 'None'})`, newRegion);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    console.error('[USERS POST]', err);
    res.status(500).json({ error: 'Failed to register user.' });
  }
});

// PATCH /api/users/:username/bypass-2fa — Toggle OTP exemption for one account
// The operational escape hatch: when a user cannot receive their code, an admin
// can let that one account in without waiting on anybody else.
router.patch('/:username/bypass-2fa', requireAdmin, requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  try {
    const current = await pool.query('SELECT bypass_2fa FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const newValue = !current.rows[0].bypass_2fa;
    await pool.query('UPDATE users SET bypass_2fa = $1 WHERE LOWER(username) = LOWER($2)', [newValue, username]);

    await logEvent(newValue ? 'warn' : 'info',
      `Admin "${req.auth.username}" ${newValue ? 'DISABLED' : 'enabled'} two-factor authentication for user "${username}".`);
    res.json({ success: true, bypass_2fa: newValue });
  } catch (err) {
    console.error('[USERS BYPASS 2FA]', err);
    res.status(500).json({ error: 'Failed to update two-factor setting.' });
  }
});

// PATCH /api/users/:username/lock — Toggle lock
router.patch('/:username/lock', requireAdmin, requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  try {
    const current = await pool.query('SELECT locked FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const newLocked = !current.rows[0].locked;
    await pool.query(
      'UPDATE users SET locked = $1, failed_attempts = 0 WHERE LOWER(username) = LOWER($2)',
      [newLocked, username]
    );
    await logEvent(newLocked ? 'warn' : 'success', `User "${username}" status manually changed to ${newLocked ? 'LOCKED' : 'UNLOCKED'}`);
    res.json({ success: true, locked: newLocked });
  } catch (err) {
    console.error('[USERS LOCK]', err);
    res.status(500).json({ error: 'Failed to toggle lock.' });
  }
});

// POST /api/users/:username/reset-password — Admin reset password to the default
router.post('/:username/reset-password', requireAdmin, requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  try {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, HASH_ROUNDS);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE LOWER(username) = LOWER($2) RETURNING id',
      [hash, username]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    // A reset must also cut off browsers that were trusted to skip the OTP,
    // or whoever the reset is protecting against keeps a way straight in.
    const dropped = await forgetDevices(username);
    await logEvent('info', `Admin "${req.auth.username}" reset the password for user "${username}" to the system default.`
      + (dropped ? ` ${dropped} trusted device(s) were signed out.` : ''));
    res.json({ success: true, message: `Password for "${username}" reset to the default successfully.`, defaultPassword: DEFAULT_PASSWORD });
  } catch (err) {
    console.error('[USERS RESET PASSWORD]', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// PATCH /api/users/:username/profile — Update profile contact details OR update password
router.patch('/:username/profile', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  const { name, email, email2, email3, mobile, password, currentPassword } = req.body;

  try {
    if (password) {
      // Password update flow.
      //
      // Changing your own password requires proving you know the current one,
      // so a walked-away-from session or a stolen token cannot be used to lock
      // the real owner out of their account. An admin resetting someone else's
      // password is a separate, deliberate act and does not need it.
      const isSelfChange = req.auth.username.toLowerCase() === username.toLowerCase();

      if (isSelfChange) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Enter your current password to set a new one.' });
        }

        const currentRes = await pool.query(
          'SELECT password_hash FROM users WHERE LOWER(username) = LOWER($1)',
          [username]
        );
        if (currentRes.rows.length === 0) {
          return res.status(404).json({ error: 'User not found.' });
        }

        const matches = await bcrypt.compare(currentPassword, currentRes.rows[0].password_hash);
        if (!matches) {
          await logEvent('warn', `Password change REJECTED for "${username}": current password incorrect.`);
          return res.status(403).json({ error: 'Your current password is incorrect.' });
        }

        if (currentPassword === password) {
          return res.status(400).json({ error: 'Your new password must be different from your current password.' });
        }
      }

      const policyError = validatePassword(password);
      if (policyError) {
        return res.status(400).json({ error: policyError });
      }

      const hash = await bcrypt.hash(password, HASH_ROUNDS);
      const updated = await pool.query(
        'UPDATE users SET password_hash = $1 WHERE LOWER(username) = LOWER($2) RETURNING username',
        [hash, username]
      );
      if (updated.rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const dropped = await forgetDevices(username);
      await logEvent('info', (isSelfChange
        ? `User "${username}" changed their own password.`
        : `Admin "${req.auth.username}" set a new password for user "${username}".`)
        + (dropped ? ` ${dropped} trusted device(s) were signed out.` : ''));
      return res.json({ success: true });
    }

    // Contact info update flow
    if (email === '') {
      return res.status(400).json({ error: 'Primary email address is mandatory.' });
    }

    // Perform uniqueness checks for profile update
    const emailsToCheck = [email, email2, email3].filter(Boolean).map(e => e.trim());
    const uniqueErrors = await checkUniqueness(username, emailsToCheck, mobile, null);
    if (uniqueErrors.length > 0) {
      return res.status(400).json({ error: uniqueErrors.join(' ') });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email.trim());
    }
    if (email2 !== undefined) {
      updates.push(`email2 = $${idx++}`);
      values.push(email2 && email2.trim() ? email2.trim() : null);
    }
    if (email3 !== undefined) {
      updates.push(`email3 = $${idx++}`);
      values.push(email3 && email3.trim() ? email3.trim() : null);
    }
    if (mobile !== undefined) {
      updates.push(`mobile = $${idx++}`);
      values.push(mobile && mobile.trim() ? mobile.trim() : null);
    }

    if (updates.length > 0) {
      values.push(username);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE username = $${idx}`, values);
      await logEvent('info', `User "${username}" updated profile settings`);
    }

    const result = await pool.query(
      'SELECT id, username, name, role, email, email2, email3, mobile, energy_category, locked, preferred_landing, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name FROM users WHERE username = $1',
      [username]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[USERS PROFILE]', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// PATCH /api/users/:username/landing — Update preferred landing
router.patch('/:username/landing', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  const { preferredLanding } = req.body;

  try {
    await pool.query('UPDATE users SET preferred_landing = $1 WHERE username = $2', [preferredLanding, username]);
    await logEvent('info', `Admin "${username}" updated landing preference to "${preferredLanding}"`);
    res.json({ success: true });
  } catch (err) {
    console.error('[USERS LANDING]', err);
    res.status(500).json({ error: 'Failed to update landing preference.' });
  }
});

// POST /api/users/bulk-import — CSV bulk import (with registry backup)
router.post('/bulk-import', requireAdmin, async (req, res) => {
  const { csvText } = req.body;
  if (!csvText || !csvText.trim()) {
    return res.status(400).json({ error: 'No CSV text provided.' });
  }

  const rows = csvText.split('\n').map(r => r.trim()).filter(r => r.length > 0);
  if (rows.length < 2) return res.status(400).json({ error: 'No user data rows found.' });

  const header = rows[0].toLowerCase().split(/[,\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const getIndex = (names) => header.findIndex(h => names.some(n => h.includes(n)));

  const nameIdx  = getIndex(['name', 'full name', 'display name']);
  const userIdx  = getIndex(['username', 'user', 'login']);
  const emailIdx = getIndex(['email', 'mail']);
  const categoryIdx = getIndex(['category', 'energy']);
  const acronymIdx = getIndex(['wbes', 'acronym']);

  if (userIdx === -1 || emailIdx === -1) {
    return res.status(400).json({ error: 'CSV must contain at least "Username" and "Email" columns.' });
  }

  try {
    // 1. Back up the current registry — this region's part of it.
    //
    // The backup and the rollback that reads it are both scoped, because
    // rollback deletes accounts that are not in the backup: an unscoped one
    // would delete every other region's users.
    const importRegion = regionForNewRow(req);
    if (!importRegion) {
      return res.status(400).json({
        error: 'A bulk import belongs to one region. Sign in as that region\'s administrator to run it.',
      });
    }
    const currentUsers = await pool.query('SELECT * FROM users WHERE region = $1', [importRegion]);
    await setSetting('last_users_backup', importRegion, JSON.stringify(currentUsers.rows));

    let importCount = 0, errorCount = 0;

    // 2. Loop and import
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].split(/[,\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
      if (cols.length < header.length) continue;

      const username = cols[userIdx];
      if (!username) continue;

      const email    = cols[emailIdx] || `${username}@nrldc.in`;
      const name     = cols[nameIdx] || username;
      const role     = 'USER';

      // The CSV column is free text, so it is matched rather than compared.
      // Order matters: "trader" contains "re", so it has to be tested first or
      // every trader in the file would import as a renewable generator.
      const rawCat   = (cols[categoryIdx] || 'isgs').toLowerCase();
      let energy_category = 'ISGS';
      if (rawCat.includes('trad')) {
        energy_category = 'Traders';
      } else if (rawCat.includes('re') || rawCat.includes('renewable')) {
        energy_category = 'RE';
      } else if (rawCat.includes('state')) {
        energy_category = 'States';
      }

      // WBES Acronym from CSV or default to uppercase username
      const wbes_acronym = acronymIdx !== -1 && cols[acronymIdx] ? cols[acronymIdx].trim().toUpperCase() : username.toUpperCase();

      try {
        const emailTrimmed = email.trim();
        const acronymTrimmed = wbes_acronym.trim().toUpperCase();

        const uniqueErrors = await checkUniqueness(username.trim(), [emailTrimmed], null, acronymTrimmed);
        if (uniqueErrors.length > 0) {
          errorCount++;
          continue;
        }

        const hash = await bcrypt.hash(DEFAULT_PASSWORD, HASH_ROUNDS);
        
        const dbRes = await pool.query(
          `INSERT INTO users (username, name, role, region, email, password_hash, energy_category, locked, failed_attempts, wbes_acronym)
           VALUES ($1, $2, $3, $8, $4, $5, $6, FALSE, 0, $7)
           ON CONFLICT (username) DO NOTHING`,
          [username, name, role, email, hash, energy_category, wbes_acronym, importRegion]
        );
        if (dbRes.rowCount > 0) {
          importCount++;
        } else {
          errorCount++; // Username duplicate skipped
        }
      } catch (e) {
        errorCount++;
      }
    }

    await logEvent('success', `Imported ${importCount} users from CSV. Duplicate/skipped: ${errorCount}`);
    const allUsers = await pool.query(
      `SELECT id, username, name, role, region, email, email2, email3, mobile, energy_category,
              locked, failed_attempts, preferred_landing, bypass_2fa, can_upload_cycle_data,
              wbes_acronym, qca_name
         FROM users WHERE region = $1 ORDER BY id ASC`, [rollbackRegion]);
    res.json({ importCount, errorCount, users: allUsers.rows });
  } catch (err) {
    console.error('[USERS BULK IMPORT]', err);
    res.status(500).json({ error: 'Failed to process CSV import: ' + err.message });
  }
});

// POST /api/users/rollback-import — Roll back last CSV import
router.post('/rollback-import', requireAdmin, async (req, res) => {
  try {
    const rollbackRegion = regionForNewRow(req);
    if (!rollbackRegion) {
      return res.status(400).json({
        error: 'A rollback belongs to one region. Sign in as that region\'s administrator to run it.',
      });
    }
    const backup = await getSetting('last_users_backup', rollbackRegion, null);
    if (!backup) {
      return res.status(400).json({ error: `No user registry backup found for ${rollbackRegion}.` });
    }

    const backupUsers = JSON.parse(backup);
    const backupUsernames = backupUsers.map(u => u.username);

    // Only this region's accounts are considered. Rollback deletes anything
    // added since the backup, so looking wider would delete other regions'
    // users — the one mistake here that cannot be undone.
    const currentUsersRes = await pool.query(
      'SELECT username, role FROM users WHERE region = $1', [rollbackRegion]
    );

    const toDelete = currentUsersRes.rows.filter(
      u => !backupUsernames.includes(u.username) && !['ADMIN', 'SUPERADMIN'].includes(u.role)
    );

    // One connection for the whole restore: deleting the imported users and
    // putting the previous ones back has to succeed or fail as a unit.
    await withTransaction(async (client) => {
      if (toDelete.length > 0) {
        const usernamesToDelete = toDelete.map(u => u.username);
        await client.query('DELETE FROM users WHERE username = ANY($1)', [usernamesToDelete]);
      }

      for (const u of backupUsers) {
        await client.query(
          `INSERT INTO users (username, name, role, region, email, email2, email3, mobile, password_hash, energy_category, locked, failed_attempts, preferred_landing, bypass_2fa, can_upload_cycle_data, wbes_acronym)
           VALUES ($1, $2, $3, $16, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (username) DO UPDATE SET
             name = $2, role = $3, region = $16, email = $4, email2 = $5, email3 = $6, mobile = $7, password_hash = $8, energy_category = $9, locked = $10, failed_attempts = $11, preferred_landing = $12, bypass_2fa = $13, can_upload_cycle_data = $14, wbes_acronym = $15`,
          [
            u.username, u.name, u.role, u.email, u.email2, u.email3, u.mobile, u.password_hash, u.energy_category,
            u.locked, u.failed_attempts, u.preferred_landing, u.bypass_2fa, u.can_upload_cycle_data || false, u.wbes_acronym || '',
            u.region || rollbackRegion
          ]
        );
      }

      await client.query("DELETE FROM config WHERE key = 'last_users_backup' AND region = $1", [rollbackRegion]);
    });

    await logEvent('success', `Rolled back the ${rollbackRegion} user registry. ${toDelete.length} account(s) added since the backup were removed.`);
    
    const allUsers = await pool.query(
      `SELECT id, username, name, role, region, email, email2, email3, mobile, energy_category,
              locked, failed_attempts, preferred_landing, bypass_2fa, can_upload_cycle_data,
              wbes_acronym, qca_name
         FROM users WHERE region = $1 ORDER BY id ASC`, [rollbackRegion]);
    res.json({ success: true, message: 'Rollback complete. Restored registry to previous state.', users: allUsers.rows });
  } catch (err) {
    console.error('[USERS ROLLBACK]', err);
    res.status(500).json({ error: 'Failed to restore user registry: ' + err.message });
  }
});

// PATCH /api/users/:username — Admin update user details (with custom password option)
router.patch('/:username', requireAdmin, requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  const { name, email, email2, email3, mobile, role, energy_category, bypass_2fa, can_upload_cycle_data, wbes_acronym, password, qca_name } = req.body;

  // Perform uniqueness checks
  const emailsToCheck = [email, email2, email3].filter(Boolean).map(e => e.trim());
  const uniqueErrors = await checkUniqueness(username, emailsToCheck, mobile, wbes_acronym);
  if (uniqueErrors.length > 0) {
    return res.status(400).json({ error: uniqueErrors.join(' ') });
  }

  try {
    // Merge the requested changes over the stored row so the QCA/RE rule is
    // checked against the account's resulting state, not just the fields sent.
    const currentRes = await pool.query(
      `SELECT name, email, email2, email3, mobile, role, energy_category,
              bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name
         FROM users WHERE username = $1`,
      [username]
    );
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const current = currentRes.rows[0];
    const effectiveRole = role !== undefined ? role : current.role;
    const effectiveCategory = energy_category !== undefined ? energy_category : current.energy_category;
    const effectiveQcaName = qca_name !== undefined ? qca_name : current.qca_name;

    const qcaError = validateQcaCategory(effectiveRole, effectiveCategory, effectiveQcaName);
    if (qcaError) {
      return res.status(400).json({ error: qcaError });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email.trim());
    }
    if (email2 !== undefined) {
      updates.push(`email2 = $${idx++}`);
      values.push(email2 && email2.trim() ? email2.trim() : null);
    }
    if (email3 !== undefined) {
      updates.push(`email3 = $${idx++}`);
      values.push(email3 && email3.trim() ? email3.trim() : null);
    }
    if (mobile !== undefined) {
      updates.push(`mobile = $${idx++}`);
      values.push(mobile && mobile.trim() ? mobile.trim() : null);
    }
    if (role !== undefined) {
      if (!['ADMIN', 'USER', 'QCA'].includes(role)) {
        return res.status(400).json({ error: 'Role must be ADMIN, USER, or QCA.' });
      }
      updates.push(`role = $${idx++}`);
      values.push(role);
    }
    if (energy_category !== undefined) {
      if (!FILING_CATEGORIES.includes(energy_category)) {
        return res.status(400).json({ error: `Invalid energy category. Choose one of: ${FILING_CATEGORIES.join(', ')}.` });
      }
      updates.push(`energy_category = $${idx++}`);
      values.push(energy_category);
    }
    if (bypass_2fa !== undefined) {
      updates.push(`bypass_2fa = $${idx++}`);
      values.push(!!bypass_2fa);
    }
    if (can_upload_cycle_data !== undefined) {
      updates.push(`can_upload_cycle_data = $${idx++}`);
      values.push(!!can_upload_cycle_data);
    }
    if (wbes_acronym !== undefined) {
      updates.push(`wbes_acronym = $${idx++}`);
      values.push(wbes_acronym.trim().toUpperCase());
    }
    if (qca_name !== undefined) {
      updates.push(`qca_name = $${idx++}`);
      values.push(qca_name && qca_name.trim() ? qca_name.trim() : null);
    }
    if (password && password.trim() !== '') {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }
      const hash = await bcrypt.hash(password, HASH_ROUNDS);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(username);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE username = $${idx} RETURNING id, username, name, role, email, email2, email3, mobile, energy_category, locked, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name`;
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Log what genuinely changed, and never the body: it carries the new
    // password when an admin sets one, and system_logs is not the place for
    // that. The edit form submits every field whether or not it was touched,
    // so comparing against the stored row is the only way to make this entry
    // mean anything.
    const submitted = {
      name, email, email2, email3, mobile, role, energy_category,
      bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name,
    };
    const norm = (v) => (v === null || v === undefined || v === '' ? '' : typeof v === 'boolean' ? String(v) : String(v).trim());
    const realChanges = Object.entries(submitted)
      .filter(([field, value]) => value !== undefined && norm(value) !== norm(current[field]))
      .map(([field, value]) => `${field}: ${norm(current[field]) || '—'} → ${norm(value) || '—'}`);
    if (password && password.trim() !== '') realChanges.push('password reset');
    const changedFields = realChanges.length ? realChanges.join('; ') : 'no field values changed';
    let deviceNote = '';
    if (password && password.trim() !== '') {
      const dropped = await forgetDevices(username);
      deviceNote = dropped ? ` ${dropped} trusted device(s) were signed out.` : '';
    }
    await logEvent('info',
      `Admin "${req.auth.username}" updated user "${username}" — ${changedFields}.${deviceNote}`);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[USERS PATCH ADMIN]', err);
    res.status(500).json({ error: 'Failed to update user details.' });
  }
});

// GET /api/users/wbes-directory — plant acronyms across every region.
//
// The region-scoped register below is right for a station: it picks from the
// plants its own centre despatches and has no business seeing the rest. A
// trader is the exception. Trading power out of NRLDC into ERLDC means naming
// an ERLDC entity, and a lookup that stopped at the trader's own region would
// make the buyer/seller fields unfillable.
//
// So this is deliberately the thinnest possible cross-region read: an acronym,
// a name, a region and a category. No owner, no coordinator, no filing, no
// count — nothing that would tell a trader anything about how another region
// is running. Restricted to traders and administrators, and it requires a
// search term, so it cannot be used to page out the national plant register.
router.get('/wbes-directory', async (req, res) => {
  const { search, region } = req.query;

  const mayLookUp = isAdmin(req) || req.auth.energy_category === 'Traders';
  if (!mayLookUp) {
    return res.status(403).json({ error: 'Only traders and administrators look up entities outside their own region.' });
  }

  const term = String(search || '').trim();
  if (term.length < 2) {
    return res.json([]);   // Not an error: an empty box is the normal state.
  }

  const params = [`%${term.toLowerCase()}%`];
  const conditions = ['(LOWER(w.wbes_acronym) LIKE $1 OR LOWER(w.name) LIKE $1)'];

  // Narrowing to one region is what the form does once a region is chosen, so
  // the suggestions match the side of the trade being filled in.
  if (region && String(region).trim()) {
    params.push(String(region).trim().toUpperCase());
    conditions.push(`w.region = $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT w.wbes_acronym, w.name, w.region, w.energy_category
         FROM wbes_entities w
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          -- An exact acronym match is almost always the one being typed, so it
          -- leads regardless of alphabetical order.
          (LOWER(w.wbes_acronym) = $${params.length + 1}) DESC,
          w.wbes_acronym ASC
        LIMIT 25`,
      [...params, term.toLowerCase()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[WBES DIRECTORY GET]', err);
    res.status(500).json({ error: 'Failed to search the entity register.' });
  }
});

// GET /api/users/wbes-entities — Search WBES plants
// A QCA caller only ever sees RE plants, since QCA coordination is limited to
// Renewable Energy. Admins and plant users see the whole register.
router.get('/wbes-entities', async (req, res) => {
  const { search, category } = req.query;

  const conditions = [];
  const params = [];

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(LOWER(w.wbes_acronym) LIKE $${params.length} OR LOWER(w.name) LIKE $${params.length})`);
  }

  // QCAs are restricted to RE regardless of what they ask for.
  const effectiveCategory = req.auth.role === 'QCA' ? 'RE' : (category && category !== 'ALL' ? category : null);
  if (effectiveCategory) {
    params.push(effectiveCategory);
    conditions.push(`w.energy_category = $${params.length}`);
  }

  // The plant register is per region: a station only ever picks from plants
  // its own despatch centre operates.
  scopeToRegion(req, 'w.region', conditions, params);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT
         w.wbes_acronym,
         w.name,
         w.name AS plant_name,
         w.energy_category,
         owner.username AS current_owner,
         owner.qca_name AS current_owner_qca
       FROM wbes_entities w
       LEFT JOIN LATERAL (
         SELECT upa.username, u.qca_name
         FROM user_plant_assignments upa
         JOIN users u ON upa.username = u.username
         WHERE upa.wbes_acronym = w.wbes_acronym AND (upa.to_date IS NULL OR upa.to_date >= CURRENT_DATE)
         ORDER BY upa.from_date DESC
         LIMIT 1
       ) owner ON TRUE
       ${where}
       ORDER BY w.wbes_acronym ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[WBES ENTITIES GET]', err);
    res.status(500).json({ error: 'Failed to fetch plant list.' });
  }
});

// GET /api/users/:username/assignments — Fetch user plant assignments
router.get('/:username/assignments', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.wbes_acronym, u.from_date, u.to_date, p.name as plant_name
       FROM user_plant_assignments u
       JOIN wbes_entities p ON u.wbes_acronym = p.wbes_acronym
       WHERE LOWER(u.username) = LOWER($1)
       ORDER BY u.from_date DESC`,
      [username]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[ASSIGNMENTS GET]', err);
    res.status(500).json({ error: 'Failed to fetch assignments.' });
  }
});

// POST /api/users/:username/assignments — Create a plant assignment or trigger transfer request
router.post('/:username/assignments', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  const { wbes_acronym, from_date, to_date } = req.body;

  if (!wbes_acronym || !from_date) {
    return res.status(400).json({ error: 'WBES Acronym and From Date are required.' });
  }

  const acronym = wbes_acronym.trim().toUpperCase();

  try {
    const plantRes = await pool.query(
      'SELECT name, energy_category FROM wbes_entities WHERE wbes_acronym = $1',
      [acronym]
    );
    if (plantRes.rows.length === 0) {
      return res.status(400).json({ error: `WBES Acronym "${acronym}" is not registered in the system.` });
    }

    // Plant assignments are the QCA mechanism: the holder must be a QCA, and
    // only RE plants may be placed under one.
    const targetRes = await pool.query('SELECT role FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (targetRes.rows[0].role !== 'QCA') {
      return res.status(403).json({ error: 'Plant assignments apply to QCA accounts only.' });
    }
    if (plantRes.rows[0].energy_category !== 'RE') {
      await logEvent('warn', `Assignment BLOCKED: QCA "${username}" attempted to claim non-RE plant ${acronym} (${plantRes.rows[0].energy_category}).`);
      return res.status(400).json({ error: `Plant "${acronym}" is an ${plantRes.rows[0].energy_category} entity. QCA management is available for Renewable Energy (RE) plants only.` });
    }

    const activeRes = await pool.query(
      `SELECT * FROM user_plant_assignments 
       WHERE wbes_acronym = $1 AND (to_date IS NULL OR to_date >= $2)
       ORDER BY from_date DESC LIMIT 1`,
      [acronym, from_date]
    );

    if (activeRes.rows.length > 0) {
      const activeOwner = activeRes.rows[0];
      if (activeOwner.username.toLowerCase() !== username.toLowerCase()) {
        await pool.query(
          `INSERT INTO transfer_requests (wbes_acronym, from_username, to_username, effective_date, status, requested_by)
           VALUES ($1, $2, $3, $4, 'Pending', $5)`,
          [acronym, activeOwner.username, username, from_date, username]
        );
        await logEvent('info', `Transfer request submitted for plant ${acronym} from user ${activeOwner.username} to ${username} effective ${from_date}`);
        return res.json({ success: true, status: 'TransferPending', message: `Plant "${acronym}" is currently assigned to user "${activeOwner.username}". A transfer request has been submitted for RLDC Admin approval.` });
      } else {
        return res.status(400).json({ error: `Plant "${acronym}" is already assigned to you for this period.` });
      }
    }

    const result = await pool.query(
      `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [username, acronym, from_date, to_date || null]
    );
    await logEvent('success', `Direct plant assignment: ${acronym} assigned to user ${username} from ${from_date}`);
    res.status(201).json({ 
      success: true, 
      status: 'Assigned', 
      assignment: result.rows[0],
      message: `Plant "${acronym}" has been successfully assigned to you.`
    });
  } catch (err) {
    console.error('[ASSIGNMENT CREATE]', err);
    res.status(500).json({ error: 'Failed to create plant assignment.' });
  }
});

// GET /api/users/transfer-requests — Fetch transfer requests
// Admins see every request; everyone else sees only the ones they raised or
// are a party to.
router.get('/transfer-requests', async (req, res) => {
  try {
    const baseQuery = `SELECT tr.*, p.name AS plant_name, p.energy_category, p.region,
              f.qca_name AS from_qca_name, f.name AS from_qca_full_name,
              t.qca_name AS to_qca_name,   t.name AS to_qca_full_name,
              rq.name AS requested_by_name
       FROM transfer_requests tr
       JOIN wbes_entities p ON tr.wbes_acronym = p.wbes_acronym
       LEFT JOIN users f  ON LOWER(f.username)  = LOWER(tr.from_username)
       LEFT JOIN users t  ON LOWER(t.username)  = LOWER(tr.to_username)
       LEFT JOIN users rq ON LOWER(rq.username) = LOWER(tr.requested_by)`;

    // An admin sees the transfers for plants in their own region.
    const adminParams = [];
    const adminConditions = [];
    scopeToRegion(req, 'p.region', adminConditions, adminParams);
    const adminWhere = adminConditions.length ? `WHERE ${adminConditions.join(' AND ')}` : '';

    const result = isAdmin(req)
      ? await pool.query(`${baseQuery} ${adminWhere} ORDER BY tr.created_at DESC`, adminParams)
      : await pool.query(
          `${baseQuery}
           WHERE LOWER(tr.requested_by) = LOWER($1)
              OR LOWER(tr.from_username) = LOWER($1)
              OR LOWER(tr.to_username) = LOWER($1)
           ORDER BY tr.created_at DESC`,
          [req.auth.username]
        );
    res.json(result.rows);
  } catch (err) {
    console.error('[TRANSFER REQUESTS GET]', err);
    res.status(500).json({ error: 'Failed to fetch transfer requests.' });
  }
});

// POST /api/users/transfer-requests — Submit a transfer request directly
router.post('/transfer-requests', async (req, res) => {
  const { wbes_acronym, to_username, effective_date, requested_by } = req.body;
  if (!wbes_acronym || !to_username || !effective_date || !requested_by) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  const acronym = wbes_acronym.trim().toUpperCase();

  // A user may only raise a transfer in their own name.
  if (!isAdmin(req) && requested_by.toLowerCase() !== req.auth.username.toLowerCase()) {
    return res.status(403).json({ error: 'You may only raise a transfer request in your own name.' });
  }

  try {
    // QCA transfers apply to RE plants handed to a QCA account — nothing else.
    const plantCategory = await getPlantCategory(acronym);
    if (plantCategory === null) {
      return res.status(400).json({ error: `WBES Acronym "${acronym}" is not registered in the system.` });
    }
    if (plantCategory !== 'RE') {
      await logEvent('warn', `Transfer BLOCKED: non-RE plant ${acronym} (${plantCategory}) cannot be placed under a QCA.`);
      return res.status(400).json({ error: `Plant "${acronym}" is an ${plantCategory} entity. QCA transfers apply to Renewable Energy (RE) plants only.` });
    }

    const targetRes = await pool.query(
      "SELECT role FROM users WHERE LOWER(username) = LOWER($1)",
      [to_username]
    );
    if (targetRes.rows.length === 0 || targetRes.rows[0].role !== 'QCA') {
      return res.status(400).json({ error: 'The selected transfer target is not a registered QCA account.' });
    }

    const ownerRes = await pool.query(
      `SELECT username FROM user_plant_assignments 
       WHERE wbes_acronym = $1 AND (to_date IS NULL OR to_date >= $2) 
       ORDER BY from_date DESC LIMIT 1`,
      [acronym, effective_date]
    );
    const from_username = ownerRes.rows[0]?.username || null;

    const result = await pool.query(
      `INSERT INTO transfer_requests (wbes_acronym, from_username, to_username, effective_date, status, requested_by)
       VALUES ($1, $2, $3, $4, 'Pending', $5) RETURNING *`,
      [acronym, from_username, to_username, effective_date, requested_by]
    );
    await logEvent('info', `Plant user submitted transfer request for ${acronym} to user ${to_username} effective ${effective_date}`);
    res.status(201).json({ success: true, request: result.rows[0] });
  } catch (err) {
    console.error('[TRANSFER CREATE]', err);
    res.status(500).json({ error: 'Failed to submit transfer request.' });
  }
});

// PATCH /api/users/transfer-requests/:id/process — Process transfer request approval
router.patch('/transfer-requests/:id/process', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Approved or Rejected.' });
  }

  try {
    // Closing the outgoing assignment, opening the incoming one and marking
    // the request processed must all land together — a half-applied transfer
    // would leave a plant with two owners or none.
    const outcome = await withTransaction(async (client) => {
      // FOR UPDATE so two admins clicking at once cannot both process it.
      const trRes = await client.query('SELECT * FROM transfer_requests WHERE id = $1 FOR UPDATE', [id]);
      if (trRes.rows.length === 0) {
        return { status: 404, body: { error: 'Transfer request not found.' } };
      }
      // A transfer belongs to the region of the plant being transferred.
      const plantRegion = await client.query(
        'SELECT region FROM wbes_entities WHERE UPPER(wbes_acronym) = UPPER($1)',
        [trRes.rows[0].wbes_acronym]
      );
      if (!canActOnRegion(req, plantRegion.rows[0]?.region)) {
        return { status: 403, body: crossRegionError(req) };
      }

      const tr = trRes.rows[0];
      if (tr.status !== 'Pending') {
        return { status: 400, body: { error: 'This transfer request has already been processed.' } };
      }

      if (status === 'Approved') {
        // Close the outgoing assignment the day before the transfer takes
        // effect. Local-time formatting keeps the boundary on the intended day.
        const prevDayStr = previousDayString(tr.effective_date);

        await client.query(
          `UPDATE user_plant_assignments
           SET to_date = $1
           WHERE wbes_acronym = $2 AND (to_date IS NULL OR to_date >= $3)`,
          [prevDayStr, tr.wbes_acronym, tr.effective_date]
        );

        await client.query(
          `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
           VALUES ($1, $2, $3, NULL)
           ON CONFLICT (username, wbes_acronym, from_date)
           DO UPDATE SET to_date = NULL`,
          [tr.to_username, tr.wbes_acronym, tr.effective_date]
        );
      }

      await client.query('UPDATE transfer_requests SET status = $1 WHERE id = $2', [status, id]);
      return { status: 200, tr };
    });

    if (outcome.status !== 200) {
      return res.status(outcome.status).json(outcome.body);
    }

    // Logged after the commit, so the audit trail only records what actually
    // took effect.
    const tr = outcome.tr;
    if (status === 'Approved') {
      await logEvent('success', `Admin "${req.auth.username}" APPROVED transfer of plant ${tr.wbes_acronym} to ${tr.to_username} effective ${tr.effective_date}`);
    } else {
      await logEvent('warn', `Admin "${req.auth.username}" REJECTED transfer of plant ${tr.wbes_acronym} to ${tr.to_username}`);
    }

    res.json({ success: true, message: `Transfer request processed as ${status}.` });
  } catch (err) {
    console.error('[TRANSFER PROCESS]', err);
    res.status(500).json({ error: 'Failed to process transfer request.' });
  }
});

// PATCH /api/users/assignments/:id — Modify historical effective date
router.patch('/assignments/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { from_date, to_date } = req.body;
  try {
    // An assignment belongs to the region of the plant it covers.
    const owning = await pool.query(
      `SELECT w.region FROM user_plant_assignments a
         JOIN wbes_entities w ON UPPER(a.wbes_acronym) = UPPER(w.wbes_acronym)
        WHERE a.id = $1`,
      [id]
    );
    if (owning.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }
    if (!canActOnRegion(req, owning.rows[0].region)) {
      return res.status(403).json(crossRegionError(req));
    }

    const result = await pool.query(
      `UPDATE user_plant_assignments 
       SET from_date = $1, to_date = $2 
       WHERE id = $3 RETURNING *`,
      [from_date, to_date || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }
    await logEvent('info', `Admin modified assignment ID ${id}: from ${from_date} to ${to_date || 'NULL'}`);
    res.json({ success: true, assignment: result.rows[0] });
  } catch (err) {
    console.error('[ASSIGNMENT UPDATE]', err);
    res.status(500).json({ error: 'Failed to update assignment.' });
  }
});

// GET /api/users/:username/qca-association — Check if plant is managed by QCA
// Only RE plants can be under a QCA, so an ISGS or States user always gets
// { assignedToQCA: false, qcaEligible: false } and the portal hides every QCA
// control for them.
router.get('/:username/qca-association', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  try {
    const userRes = await pool.query(
      'SELECT wbes_acronym, energy_category, role FROM users WHERE username = $1',
      [username]
    );
    if (userRes.rows.length === 0) {
      return res.json({ assignedToQCA: false, qcaEligible: false });
    }
    const { wbes_acronym: acronym, energy_category } = userRes.rows[0];

    if (!acronym) {
      return res.json({ assignedToQCA: false, qcaEligible: false });
    }

    // The plant register is authoritative; fall back to the user's own
    // category for plants that predate the wbes_entities column.
    const plantCategory = (await getPlantCategory(acronym)) || energy_category;
    if (plantCategory !== 'RE') {
      return res.json({ assignedToQCA: false, qcaEligible: false, energyCategory: plantCategory });
    }

    const assignRes = await pool.query(
      `SELECT u.qca_name, u.username as qca_username 
       FROM user_plant_assignments upa
       JOIN users u ON upa.username = u.username
       WHERE upa.wbes_acronym = $1 AND (upa.to_date IS NULL OR upa.to_date >= CURRENT_DATE)
       LIMIT 1`,
      [acronym]
    );

    if (assignRes.rows.length > 0) {
      res.json({
        assignedToQCA: true,
        qcaEligible: true,
        energyCategory: plantCategory,
        qcaName: assignRes.rows[0].qca_name,
        qcaUsername: assignRes.rows[0].qca_username
      });
    } else {
      res.json({ assignedToQCA: false, qcaEligible: true, energyCategory: plantCategory });
    }
  } catch (err) {
    console.error('[QCA ASSOCIATION GET]', err);
    res.status(500).json({ error: 'Failed to fetch QCA association.' });
  }
});

// GET /api/users/qcas — Retrieve all active QCA users
router.get('/qcas', async (req, res) => {
  try {
    // A station can only be coordinated by a QCA in its own region.
    const params = [];
    const conditions = ["role = 'QCA'", 'locked = FALSE'];
    scopeToRegion(req, 'region', conditions, params);
    const result = await pool.query(
      `SELECT username, name, qca_name
         FROM users
        WHERE ${conditions.join(' AND ')}
        ORDER BY qca_name ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[QCAS GET]', err);
    res.status(500).json({ error: 'Failed to fetch QCA users.' });
  }
});

// ─── Self-service registration queue (admin only) ───────────────────────────

// GET /api/users/registrations?status=Pending
router.get('/registrations', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    const conditions = [];
    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    scopeToRegion(req, 'region', conditions, params);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, username, name, role, region, email, mobile, energy_category, wbes_acronym,
              qca_name, status, review_note, reviewed_by, reviewed_at, created_at
         FROM registration_requests
         ${where}
         ORDER BY CASE status WHEN 'Pending' THEN 0 ELSE 1 END, created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[REGISTRATIONS GET]', err);
    res.status(500).json({ error: 'Failed to fetch registration requests.' });
  }
});

// PATCH /api/users/registrations/:id/process — approve or reject
//
// An administrator may correct the submitted details at the moment of approval
// — a plant that picked RE when it is really ISGS, or fat-fingered its WBES
// acronym — by sending an `edits` object. Only the fields present in `edits`
// override the application; everything else is taken from the stored request,
// never from the request body, so nothing can be smuggled in by naming a
// column at the top level. The corrections are recorded in the review note,
// and the request row itself keeps what the applicant actually submitted.
//
// The applicant's password hash is never editable here: whatever they chose at
// registration is what they sign in with.
const REGISTRATION_EDITABLE = [
  'username', 'name', 'email', 'mobile', 'role', 'energy_category', 'wbes_acronym', 'qca_name',
];

router.patch('/registrations/:id/process', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, note, edits } = req.body || {};

  if (!/^\d+$/.test(String(id))) {
    return res.status(404).json({ error: 'That registration request does not exist.' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Approved or Rejected.' });
  }
  if (status === 'Rejected' && (!note || !note.trim())) {
    return res.status(400).json({ error: 'Give a reason for the rejection so the applicant knows what to correct.' });
  }

  try {
    const outcome = await withTransaction(async (client) => {
      // FOR UPDATE so two admins cannot both process the same request.
      const reqRes = await client.query(
        'SELECT * FROM registration_requests WHERE id = $1 FOR UPDATE', [id]
      );
      if (reqRes.rows.length === 0) {
        return { status: 404, body: { error: 'Registration request not found.' } };
      }
      const reg = reqRes.rows[0];
      if (reg.status !== 'Pending') {
        return { status: 400, body: { error: `This request was already ${reg.status.toLowerCase()}.` } };
      }
      // An admin decides their own region's applications only.
      if (!canActOnRegion(req, reg.region)) {
        return { status: 403, body: crossRegionError(req) };
      }

      if (status === 'Rejected') {
        await client.query(
          `UPDATE registration_requests
              SET status = 'Rejected', review_note = $1, reviewed_by = $2, reviewed_at = NOW()
            WHERE id = $3`,
          [note.trim(), req.auth.username, id]
        );
        return { status: 200, reg, decision: 'Rejected' };
      }

      // ── Apply the admin's corrections on top of the application ──────────
      const final = { ...reg };
      const changes = [];
      for (const field of REGISTRATION_EDITABLE) {
        if (!edits || !Object.prototype.hasOwnProperty.call(edits, field)) continue;
        const raw = edits[field];
        let value = raw === null || raw === undefined ? null : String(raw).trim();
        if (field === 'wbes_acronym' && value) value = value.toUpperCase();
        if (value === '') value = field === 'mobile' || field === 'qca_name' ? null : '';
        if ((value || '') === (reg[field] || '')) continue;   // not actually a change
        changes.push(`${field}: "${reg[field] || '—'}" → "${value || '—'}"`);
        final[field] = value;
      }

      for (const field of ['username', 'name', 'email', 'wbes_acronym']) {
        if (!final[field] || !String(final[field]).trim()) {
          return { status: 400, body: { error: `${field.replace(/_/g, ' ')} cannot be blank.` } };
        }
      }
      if (!['USER', 'QCA'].includes(final.role)) {
        return { status: 400, body: { error: 'Role must be USER or QCA.' } };
      }
      if (!FILING_CATEGORIES.includes(final.energy_category)) {
        return { status: 400, body: { error: `Energy category must be one of: ${FILING_CATEGORIES.join(', ')}.` } };
      }
      // The same QCA/RE rule the rest of the portal enforces — a correction
      // cannot be used to route around it.
      const qcaError = validateQcaCategory(final.role, final.energy_category, final.qca_name);
      if (qcaError) {
        return { status: 400, body: { error: qcaError } };
      }
      if (final.role !== 'QCA') final.qca_name = null;

      // Re-check clashes against the corrected values: someone may have taken
      // the name or plant while this request sat in the queue, and the admin
      // may just have retyped it to something already in use.
      const clash = await client.query(
        `SELECT
           (SELECT count(*) FROM users WHERE LOWER(username) = LOWER($1))        AS username_taken,
           (SELECT count(*) FROM users WHERE UPPER(TRIM(wbes_acronym)) = $2)     AS acronym_taken,
           (SELECT count(*) FROM users WHERE LOWER(email) = LOWER($3))           AS email_taken`,
        [final.username, final.wbes_acronym, final.email]
      );
      const c = clash.rows[0];
      if (Number(c.username_taken) > 0) {
        return { status: 409, body: { error: `Username "${final.username}" is already in use. Edit it before approving, or reject this request.` } };
      }
      if (Number(c.acronym_taken) > 0) {
        return { status: 409, body: { error: `WBES acronym "${final.wbes_acronym}" already belongs to another account. Edit it before approving, or reject this request.` } };
      }
      if (Number(c.email_taken) > 0) {
        return { status: 409, body: { error: `Email "${final.email}" already belongs to another account.` } };
      }

      // The plant may not be on the register yet — a new station signing up.
      //
      // If it is already there under a different category the two must not be
      // left disagreeing: wbes_entities.energy_category is what gates QCA
      // assignment, so an account filed as RE against an ISGS entity would be
      // silently unassignable. The approval is the admin's explicit decision
      // on this plant, so the register follows it — but the reclassification
      // is recorded rather than done quietly.
      const existing = await client.query(
        'SELECT energy_category FROM wbes_entities WHERE UPPER(wbes_acronym) = UPPER($1)',
        [final.wbes_acronym]
      );
      if (existing.rows.length > 0 && existing.rows[0].energy_category !== final.energy_category) {
        changes.push(`WBES register: plant ${final.wbes_acronym} reclassified ${existing.rows[0].energy_category} → ${final.energy_category}`);
      }
      await client.query(
        `INSERT INTO wbes_entities (wbes_acronym, name, energy_category, region)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wbes_acronym) DO UPDATE
           SET energy_category = EXCLUDED.energy_category, region = EXCLUDED.region`,
        [final.wbes_acronym, final.name, final.energy_category, reg.region]
      );

      // The account is created with the password the applicant chose, carried
      // across as a hash — there is no temporary password to communicate.
      await client.query(
        `INSERT INTO users (username, name, role, region, email, mobile, password_hash, energy_category,
                            locked, failed_attempts, bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name)
         VALUES ($1,$2,$3,$10,$4,$5,$6,$7, FALSE, 0, FALSE, FALSE, $8, $9)`,
        [final.username, final.name, final.role, final.email, final.mobile, reg.password_hash,
         final.energy_category, final.wbes_acronym, final.qca_name, reg.region]
      );

      // Keep the application as submitted; record the corrections beside it.
      const auditNote = [
        note ? note.trim() : '',
        changes.length ? `Approved with corrections — ${changes.join('; ')}` : '',
      ].filter(Boolean).join(' | ');

      await client.query(
        `UPDATE registration_requests
            SET status = 'Approved', review_note = $1, reviewed_by = $2, reviewed_at = NOW()
          WHERE id = $3`,
        [auditNote, req.auth.username, id]
      );

      return { status: 200, reg, final, changes, decision: 'Approved' };
    });

    if (outcome.status !== 200) {
      return res.status(outcome.status).json(outcome.body);
    }

    const { reg, final, changes, decision } = outcome;
    const account = final || reg;
    await logEvent(decision === 'Approved' ? 'success' : 'warn',
      `Admin "${req.auth.username}" ${decision.toUpperCase()} registration #${id} for "${account.username}" (${account.role}, WBES ${account.wbes_acronym}).`
      + (changes && changes.length ? ` Corrected before approval — ${changes.join('; ')}.` : ''));

    // Best effort — the decision stands whether or not the mail gets out.
    const mail = decision === 'Approved'
      ? {
          subject: 'NRLDC Portal — your registration has been approved',
          text: `Hello ${account.name},\n\nYour registration for the NRLDC Schedule Discrepancy Portal has been approved.\n\nUsername: ${account.username}\nWBES Acronym: ${account.wbes_acronym}\n\nSign in with the password you chose when registering.`
            + (changes && changes.length
              ? `\n\nThe administrator corrected some details before approving, so please use the username and acronym exactly as shown above.`
              : '')
            + `\n\nNRLDC Team`,
        }
      : {
          subject: 'NRLDC Portal — your registration could not be approved',
          text: `Hello ${reg.name},\n\nYour registration for the NRLDC Schedule Discrepancy Portal was not approved.\n\nReason: ${note.trim()}\n\nYou may register again with corrected details.\n\nNRLDC Team`,
        };
    const sent = await sendMail({ to: account.email, ...mail });
    await logEvent(sent.sent ? 'info' : 'warn',
      `[EMAIL SYSTEM] Registration ${decision.toLowerCase()} notice to <${account.email}>: ${sent.sent ? 'sent' : 'FAILED — ' + sent.error}`);

    res.json({
      success: true,
      message: decision === 'Approved'
        ? `Account created for "${account.username}". They can sign in with the password they chose.`
          + (changes && changes.length ? ` ${changes.length} detail${changes.length === 1 ? '' : 's'} corrected before approval.` : '')
        : `Registration for "${reg.username}" was rejected.`,
      emailed: sent.sent,
      corrections: changes || [],
    });
  } catch (err) {
    console.error('[REGISTRATION PROCESS]', err);
    res.status(500).json({ error: 'Failed to process the registration request.' });
  }
});

// ─── Password reset queue (admin only) ──────────────────────────────────────
//
// Users who cannot receive the emailed temporary password ask here instead;
// approving puts the account back to the known default password and clears any
// lockout, so the admin never has to wait on mail or on anyone else.

// GET /api/users/password-resets?status=Pending
router.get('/password-resets', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    const conditions = [];
    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }
    // The join is what carries the region: a reset request belongs to whichever
    // region its account does. The join stays LEFT so a request whose account
    // was since deleted is not lost — it has no region, so only a super-admin
    // sees it, which is the right home for an orphan.
    scopeToRegion(req, 'u.region', conditions, params);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT r.id, r.username, r.reason, r.status, r.review_note, r.reviewed_by,
              r.reviewed_at, r.created_at,
              u.name, u.email, u.locked, u.wbes_acronym, u.energy_category, u.region
         FROM password_reset_requests r
         LEFT JOIN users u ON LOWER(u.username) = LOWER(r.username)
         ${where}
         ORDER BY CASE r.status WHEN 'Pending' THEN 0 ELSE 1 END, r.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[PASSWORD RESETS GET]', err);
    res.status(500).json({ error: 'Failed to fetch password reset requests.' });
  }
});

// PATCH /api/users/password-resets/:id/process — approve or reject
//
// Approving sets the account back to the default password and unlocks it: a
// user asking for a reset has usually locked themselves out trying, and
// resetting the password while leaving the lock on would not let them in.
router.patch('/password-resets/:id/process', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body || {};

  if (!/^\d+$/.test(String(id))) {
    return res.status(404).json({ error: 'That password reset request does not exist.' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Approved or Rejected.' });
  }
  if (status === 'Rejected' && (!note || !note.trim())) {
    return res.status(400).json({ error: 'Give a reason for the rejection so the user knows why.' });
  }

  try {
    const outcome = await withTransaction(async (client) => {
      const reqRes = await client.query(
        'SELECT * FROM password_reset_requests WHERE id = $1 FOR UPDATE', [id]
      );
      if (reqRes.rows.length === 0) {
        return { status: 404, body: { error: 'Password reset request not found.' } };
      }
      const reset = reqRes.rows[0];
      if (reset.status !== 'Pending') {
        return { status: 400, body: { error: `This request was already ${reset.status.toLowerCase()}.` } };
      }

      const userRes = await client.query(
        'SELECT username, name, email, region FROM users WHERE LOWER(username) = LOWER($1)', [reset.username]
      );
      if (userRes.rows.length === 0) {
        return { status: 404, body: { error: `The account "${reset.username}" no longer exists.` } };
      }
      const user = userRes.rows[0];
      if (!canActOnRegion(req, user.region)) {
        return { status: 403, body: crossRegionError(req) };
      }

      if (status === 'Approved') {
        const hash = await bcrypt.hash(DEFAULT_PASSWORD, HASH_ROUNDS);
        await client.query(
          'UPDATE users SET password_hash = $1, failed_attempts = 0, locked = FALSE WHERE LOWER(username) = LOWER($2)',
          [hash, reset.username]
        );
        // Trusted browsers must not survive a reset — see auth/devices.js.
        await client.query(
          'DELETE FROM trusted_devices WHERE LOWER(username) = LOWER($1)', [reset.username]
        );
      }

      await client.query(
        `UPDATE password_reset_requests
            SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW()
          WHERE id = $4`,
        [status, note ? note.trim() : '', req.auth.username, id]
      );

      return { status: 200, user, decision: status };
    });

    if (outcome.status !== 200) {
      return res.status(outcome.status).json(outcome.body);
    }

    const { user, decision } = outcome;
    await logEvent(decision === 'Approved' ? 'warn' : 'info',
      `Admin "${req.auth.username}" ${decision.toUpperCase()} the password reset request #${id} for "${user.username}".`
      + (decision === 'Approved' ? ' Password set to the system default and the account unlocked.' : ''));

    const mail = decision === 'Approved'
      ? {
          subject: 'NRLDC Portal — your password has been reset',
          text: `Hello ${user.name},\n\nAn NRLDC administrator has reset your portal password.\n\nUsername: ${user.username}\nTemporary password: ${DEFAULT_PASSWORD}\n\nPlease sign in and change it immediately from Profile Settings.\n\nNRLDC Team`,
        }
      : {
          subject: 'NRLDC Portal — password reset request declined',
          text: `Hello ${user.name},\n\nYour password reset request was not approved.\n\nReason: ${note.trim()}\n\nNRLDC Team`,
        };
    const sent = await sendMail({ to: user.email, ...mail });

    res.json({
      success: true,
      message: decision === 'Approved'
        ? `Password for "${user.username}" reset to "${DEFAULT_PASSWORD}" and the account unlocked. Tell them to change it after signing in.`
        : `Password reset request for "${user.username}" was declined.`,
      emailed: sent.sent,
    });
  } catch (err) {
    console.error('[PASSWORD RESET PROCESS]', err);
    res.status(500).json({ error: 'Failed to process the password reset request.' });
  }
});

// ─── Trusted devices ────────────────────────────────────────────────────────
//
// A browser that has passed an OTP is trusted for a while so the portal does
// not have to email a code at every login. These endpoints make that visible
// and reversible — a user can see where they are signed in, and an admin can
// cut off a lost or shared machine without touching the password.

// GET /api/users/:username/devices
router.get('/:username/devices', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  try {
    res.json(await listDevices(req.params.username));
  } catch (err) {
    console.error('[DEVICES GET]', err);
    res.status(500).json({ error: 'Could not list trusted devices.' });
  }
});

// DELETE /api/users/:username/devices — stop trusting every browser
router.delete('/:username/devices', requireSelfOrAdmin('username'), requireSameRegion(), async (req, res) => {
  const { username } = req.params;
  try {
    const dropped = await forgetDevices(username);
    await logEvent('warn',
      `${isAdmin(req) && req.auth.username.toLowerCase() !== username.toLowerCase()
        ? `Admin "${req.auth.username}"` : `User "${username}"`}`
      + ` signed out ${dropped} trusted device(s) for "${username}". Each will need a fresh OTP.`);
    res.json({ success: true, dropped, message: dropped
      ? `${dropped} device(s) will need a fresh code at the next sign-in.`
      : 'There were no trusted devices to sign out.' });
  } catch (err) {
    console.error('[DEVICES DELETE]', err);
    res.status(500).json({ error: 'Could not sign out the trusted devices.' });
  }
});

module.exports = router;

