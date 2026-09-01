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
 * are not allowed to come apart.
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
               WHERE u.region = r.acronym AND u.role = 'ADMIN')                 AS administrators
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
