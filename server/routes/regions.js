/**
 * routes/regions.js — Creating and managing load despatch centres.
 *
 * Reserved to the national administrator. A region is the organisational
 * namespace everything else hangs off: its acronym names the region's users
 * (<name>@<acronym>), and every account, plant, filing and setting belongs to
 * exactly one.
 *
 * Creating a region and giving it its first administrator happen together, in
 * one transaction. A region with no administrator is a region nobody can
 * manage — the national account cannot create its users either — so the two
 * are not allowed to come apart. Regions that predate that rule, or that lose
 * their last administrator, are repaired through POST /:acronym/admins: the
 * national account is the only one that can reach into a region it cannot
 * otherwise see.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { withTransaction } = require('../db');
const { requireSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/log');
const { DEFAULT_PASSWORD, validatePassword } = require('../utils/password');
const { refresh, regionExists } = require('../utils/regionRegistry');
const { usernameForRegion, ACRONYM_RULE } = require('../utils/usernames');

const HASH_ROUNDS = 10;

// A region may have several administrators — a second for cover, a replacement
// at handover — but not without limit. Four is the ceiling, enforced on every
// path that adds one so the count can never be talked past.
const MAX_ADMINS_PER_REGION = 4;

// How many administrators a region already has. Takes a client so it can run
// inside the same transaction as the insert it guards, closing the window where
// two simultaneous adds could both pass a check made outside the transaction.
async function adminCount(client, code) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM users WHERE region = $1 AND role = 'ADMIN'`, [code]);
  return r.rows[0].n;
}

// Every route here is national-level.
router.use(requireSuperAdmin);

// GET /api/regions — every region, with what it contains.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.acronym, r.name, r.status, r.created_by, r.created_at,
             (SELECT count(*)::int FROM users u
               WHERE u.region = r.acronym AND u.role IN ('USER', 'QCA'))        AS user_count,
             (SELECT count(*)::int FROM users u
               WHERE u.region = r.acronym AND u.role = 'ADMIN')                 AS admin_count,
             (SELECT count(*)::int FROM wbes_entities w WHERE w.region = r.acronym) AS plant_count,
             (SELECT count(*)::int FROM discrepancies d WHERE d.region = r.acronym) AS discrepancy_count,
             (SELECT string_agg(u.username, ', ' ORDER BY u.username) FROM users u
               WHERE u.region = r.acronym AND u.role = 'ADMIN')                 AS administrators,
             -- A locked region administrator cannot unlock themselves, and no
             -- one else in their region outranks them. Surfacing it here is
             -- what makes the national account's second job doable.
             (SELECT string_agg(u.username, ', ' ORDER BY u.username) FROM users u
               WHERE u.region = r.acronym AND u.role = 'ADMIN' AND u.locked)    AS locked_admins
        FROM regions r
       ORDER BY r.acronym
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[REGIONS GET]', err);
    res.status(500).json({ error: 'Failed to load the regions.' });
  }
});

// POST /api/regions — create a region, and its first administrator with it.
router.post('/', async (req, res) => {
  const { acronym, name, adminUsername, adminName, adminEmail, adminPassword } = req.body || {};

  const code = String(acronym || '').trim().toUpperCase();
  if (!code || !ACRONYM_RULE.test(code)) {
    return res.status(400).json({
      error: 'The acronym must be 2–10 letters or digits — it becomes the namespace users are named in.',
    });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Give the region a full name.' });
  }
  if (!adminName || !String(adminName).trim() || !adminEmail || !String(adminEmail).trim()) {
    return res.status(400).json({ error: 'The region needs an administrator: give a name and an email address.' });
  }

  // The administrator's username belongs to the region's namespace whether or
  // not one was typed, so a region cannot be opened with an account named
  // outside it.
  const username = usernameForRegion(adminUsername || 'admin', code);

  const password = adminPassword && String(adminPassword).trim() ? String(adminPassword) : DEFAULT_PASSWORD;
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const outcome = await withTransaction(async (client) => {
      const clash = await client.query(
        `SELECT (SELECT count(*) FROM regions WHERE acronym = $1)                  AS region_taken,
                (SELECT count(*) FROM users WHERE LOWER(username) = LOWER($2))     AS username_taken,
                (SELECT count(*) FROM users WHERE LOWER(email) = LOWER($3))        AS email_taken`,
        [code, username, String(adminEmail).trim()]
      );
      const c = clash.rows[0];
      if (Number(c.region_taken) > 0) {
        return { status: 409, body: { error: `A region with the acronym "${code}" already exists.` } };
      }
      if (Number(c.username_taken) > 0) {
        return { status: 409, body: { error: `The username "${username}" is already taken.` } };
      }
      if (Number(c.email_taken) > 0) {
        return { status: 409, body: { error: `"${adminEmail}" already belongs to an account.` } };
      }

      await client.query(
        'INSERT INTO regions (acronym, name, created_by) VALUES ($1, $2, $3)',
        [code, String(name).trim(), req.auth.username]
      );

      const hash = await bcrypt.hash(password, HASH_ROUNDS);
      await client.query(
        `INSERT INTO users (username, name, role, region, email, password_hash, energy_category,
                            locked, failed_attempts, bypass_2fa, can_upload_cycle_data, wbes_acronym)
         VALUES ($1, $2, 'ADMIN', $3, $4, $5, 'ISGS', FALSE, 0, FALSE, FALSE, '')`,
        [username, String(adminName).trim(), code, String(adminEmail).trim(), hash]
      );

      // Regional settings, copied from the defaults the other regions carry.
      await client.query(
        `INSERT INTO config (key, region, value)
         SELECT DISTINCT ON (key) key, $1, value FROM config
          WHERE region <> 'GLOBAL'
          ORDER BY key, region
         ON CONFLICT (key, region) DO NOTHING`,
        [code]
      );

      return { status: 201, code, username };
    });

    if (outcome.status !== 201) return res.status(outcome.status).json(outcome.body);

    await refresh();
    await logEvent('success',
      `National admin "${req.auth.username}" created region ${code} ("${String(name).trim()}") ` +
      `with administrator "${outcome.username}".`, code);

    res.status(201).json({
      success: true,
      acronym: code,
      administrator: outcome.username,
      usedDefaultPassword: password === DEFAULT_PASSWORD,
      message: `${code} created. Its administrator "${outcome.username}" can now sign in and add the region's users.`,
    });
  } catch (err) {
    console.error('[REGIONS POST]', err);
    res.status(500).json({ error: 'Failed to create the region.' });
  }
});

// PATCH /api/regions/:acronym — rename or suspend. The acronym never changes:
// it is the namespace every username in the region is built on.
router.patch('/:acronym', async (req, res) => {
  const code = String(req.params.acronym || '').toUpperCase();
  const { name, status } = req.body || {};

  if (status && !['Active', 'Suspended'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Active or Suspended.' });
  }
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'The region name cannot be blank.' });
  }

  try {
    if (!(await pool.query('SELECT 1 FROM regions WHERE acronym = $1', [code])).rows.length) {
      return res.status(404).json({ error: `There is no region "${code}".` });
    }

    const sets = [], params = [];
    if (name !== undefined) { params.push(String(name).trim()); sets.push(`name = $${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });

    params.push(code);
    const result = await pool.query(
      `UPDATE regions SET ${sets.join(', ')} WHERE acronym = $${params.length} RETURNING *`, params
    );

    await refresh();
    await logEvent('info',
      `National admin "${req.auth.username}" updated region ${code}: ${sets.join(', ')}.`, code);
    res.json({ success: true, region: result.rows[0] });
  } catch (err) {
    console.error('[REGIONS PATCH]', err);
    res.status(500).json({ error: 'Failed to update the region.' });
  }
});

// POST /api/regions/:acronym/admins — give an existing region an administrator.
//
// Region creation makes the first one, but a region can still end up with
// none: created before that rule existed, seeded straight into the database,
// or its only administrator deleted. Such a region is stuck — nobody inside it
// can sign in, and users are only ever created regionally — and the national
// account is the only one that can reach in. That is what this is for.
//
// It also serves the ordinary case of a second administrator, or a
// replacement at handover.
//
// Deliberately not the general user-creation route: an administrator has no
// WBES acronym (that names a plant, not a person), and that route requires
// one.
router.post('/:acronym/admins', async (req, res) => {
  const code = String(req.params.acronym || '').trim().toUpperCase();
  const { adminUsername, adminName, adminEmail, adminPassword } = req.body || {};

  if (!adminName || !String(adminName).trim() || !adminEmail || !String(adminEmail).trim()) {
    return res.status(400).json({ error: 'An administrator needs a name and an email address.' });
  }

  const username = usernameForRegion(adminUsername || 'admin', code);
  if (!username) {
    return res.status(400).json({ error: 'That username cannot be used. Use letters, digits, dots or hyphens.' });
  }

  const password = adminPassword && String(adminPassword).trim() ? String(adminPassword) : DEFAULT_PASSWORD;
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    // Checked against the table, not the cache: creating an account somewhere
    // is a place where being stale is worse than being slow.
    if (!(await regionExists(code))) {
      return res.status(404).json({ error: `There is no active region "${code}".` });
    }

    const outcome = await withTransaction(async (client) => {
      const clash = await client.query(
        `SELECT (SELECT count(*) FROM users WHERE LOWER(username) = LOWER($1)) AS username_taken,
                (SELECT count(*) FROM users WHERE LOWER(email) = LOWER($2))    AS email_taken`,
        [username, String(adminEmail).trim()]
      );
      const c = clash.rows[0];
      if (Number(c.username_taken) > 0) {
        return { status: 409, body: { error: `The username "${username}" is already taken.` } };
      }
      if (Number(c.email_taken) > 0) {
        return { status: 409, body: { error: `"${String(adminEmail).trim()}" already belongs to an account.` } };
      }
      if (await adminCount(client, code) >= MAX_ADMINS_PER_REGION) {
        return { status: 409, body: {
          error: `${code} already has the maximum of ${MAX_ADMINS_PER_REGION} administrators. `
               + 'Remove one before adding another.' } };
      }

      const hash = await bcrypt.hash(password, HASH_ROUNDS);
      await client.query(
        `INSERT INTO users (username, name, role, region, email, password_hash, energy_category,
                            locked, failed_attempts, bypass_2fa, can_upload_cycle_data, wbes_acronym)
         VALUES ($1, $2, 'ADMIN', $3, $4, $5, 'ISGS', FALSE, 0, FALSE, FALSE, '')`,
        [username, String(adminName).trim(), code, String(adminEmail).trim(), hash]
      );

      return { status: 201, username };
    });

    if (outcome.status !== 201) return res.status(outcome.status).json(outcome.body);

    await logEvent('success',
      `National admin "${req.auth.username}" created administrator "${outcome.username}" for region ${code}.`,
      code);

    res.status(201).json({
      success: true,
      acronym: code,
      administrator: outcome.username,
      usedDefaultPassword: password === DEFAULT_PASSWORD,
      message: `"${outcome.username}" now administers ${code} and can sign in to add the region's users.`,
    });
  } catch (err) {
    console.error('[REGION ADMIN POST]', err);
    res.status(500).json({ error: 'Failed to create the administrator.' });
  }
});

// POST /api/regions/:acronym/admins/promote — make an existing account an admin.
//
// The recovery path for a region whose administrator was lost — to a reseed, a
// deletion, a rename — but whose ordinary users remain. Rather than force a
// brand-new account (which collides with the one already on file), an existing
// member of the region is raised to administer it.
//
// It only ever promotes an account that ALREADY belongs to this region. That is
// the whole guard behind the isolation rule: an administrator of one region can
// never come to administer another, because there is no input here that names
// an account outside the region. Placing a person in a different region is done
// by creating them there, not by moving them.
router.post('/:acronym/admins/promote', async (req, res) => {
  const code = String(req.params.acronym || '').trim().toUpperCase();
  const username = String(req.body?.username || '').trim();
  if (!username) {
    return res.status(400).json({ error: 'Name the account to promote.' });
  }

  try {
    if (!(await regionExists(code))) {
      return res.status(404).json({ error: `There is no active region "${code}".` });
    }

    const outcome = await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT username, name, role, region FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
      );
      if (userRes.rows.length === 0) {
        return { status: 404, body: { error: `There is no account "${username}".` } };
      }
      const u = userRes.rows[0];

      // The isolation guard, re-checked on the server: the account must already
      // be in this region, and must be an ordinary user of it. A SUPERADMIN is
      // national and belongs to no region; an ADMIN already administers one —
      // neither is promoted here.
      if (u.region !== code) {
        return { status: 403, body: {
          error: `"${u.username}" belongs to ${u.region || 'no region'}, not ${code}. `
               + 'An administrator can only be drawn from the region’s own accounts.' } };
      }
      if (u.role === 'ADMIN') {
        return { status: 409, body: { error: `"${u.username}" already administers ${code}.` } };
      }
      if (u.role !== 'USER' && u.role !== 'QCA') {
        return { status: 403, body: { error: `"${u.username}" cannot be made an administrator.` } };
      }
      if (await adminCount(client, code) >= MAX_ADMINS_PER_REGION) {
        return { status: 409, body: {
          error: `${code} already has the maximum of ${MAX_ADMINS_PER_REGION} administrators. `
               + 'Remove one before adding another.' } };
      }

      await client.query(`UPDATE users SET role = 'ADMIN' WHERE username = $1`, [u.username]);
      return { status: 200, username: u.username };
    });

    if (outcome.status !== 200) return res.status(outcome.status).json(outcome.body);

    await logEvent('success',
      `National admin "${req.auth.username}" made "${outcome.username}" an administrator of ${code}.`,
      code);

    res.json({
      success: true,
      acronym: code,
      administrator: outcome.username,
      message: `"${outcome.username}" now administers ${code}.`,
    });
  } catch (err) {
    console.error('[REGION ADMIN PROMOTE]', err);
    res.status(500).json({ error: 'Failed to promote the account.' });
  }
});

// DELETE /api/regions/:acronym/admins/:username — remove an administrator.
//
// For an administrator assigned to the wrong region, or simply no longer
// wanted. It demotes them to an ordinary user of the region — safe, reversible,
// and it disturbs nothing that refers to the account. Removing a region's only
// administrator is allowed: the region shows "unmanaged" again, which the page
// surfaces and can re-fix. The national account cannot demote itself, and only
// an administrator OF THIS region can be named.
//
// Pass ?hard=1 to delete the account outright instead — used for a bootstrap
// admin created by mistake. If anything on record still refers to it, the
// delete is refused by the database and we fall back to demoting, so history is
// never torn out from under a filing.
router.delete('/:acronym/admins/:username', async (req, res) => {
  const code = String(req.params.acronym || '').trim().toUpperCase();
  const username = String(req.params.username || '').trim();
  const hard = req.query.hard === '1' || req.query.hard === 'true';

  if (username.toLowerCase() === String(req.auth.username).toLowerCase()) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }

  try {
    const userRes = await pool.query(
      'SELECT username, role, region FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    if (userRes.rows.length === 0 || userRes.rows[0].region !== code || userRes.rows[0].role !== 'ADMIN') {
      return res.status(404).json({ error: `"${username}" is not an administrator of ${code}.` });
    }
    const real = userRes.rows[0].username;

    if (hard) {
      try {
        await pool.query('DELETE FROM users WHERE username = $1', [real]);
        await logEvent('warn',
          `National admin "${req.auth.username}" deleted administrator "${real}" of ${code}.`, code);
        return res.json({ success: true, acronym: code, removed: real, deleted: true,
          message: `"${real}" has been deleted.` });
      } catch (delErr) {
        // Referenced elsewhere (filings, assignments…): keep the account but
        // strip its powers rather than fail outright.
        if (delErr.code !== '23503') throw delErr;
      }
    }

    await pool.query(`UPDATE users SET role = 'USER' WHERE username = $1`, [real]);
    await logEvent('warn',
      `National admin "${req.auth.username}" removed "${real}" as an administrator of ${code}.`, code);
    res.json({
      success: true, acronym: code, removed: real, deleted: false,
      message: `"${real}" is no longer an administrator of ${code}${hard ? ' (it has activity on record, so it was demoted rather than deleted)' : ''}.`,
    });
  } catch (err) {
    console.error('[REGION ADMIN DELETE]', err);
    res.status(500).json({ error: 'Failed to remove the administrator.' });
  }
});

// GET /api/regions/:acronym/users — who is in a region. Read-only: creating
// them is the region administrator's job.
router.get('/:acronym/users', async (req, res) => {
  const code = String(req.params.acronym || '').toUpperCase();
  try {
    if (!(await regionExists(code))) {
      return res.status(404).json({ error: `There is no active region "${code}".` });
    }
    const result = await pool.query(
      `SELECT id, username, name, role, region, email, energy_category, locked,
              bypass_2fa, wbes_acronym, qca_name, created_at
         FROM users WHERE region = $1 ORDER BY
           CASE role WHEN 'SUPERADMIN' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, username`,
      [code]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[REGION USERS GET]', err);
    res.status(500).json({ error: 'Failed to load the region users.' });
  }
});

module.exports = router;
