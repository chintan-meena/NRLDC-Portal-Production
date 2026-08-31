/**
 * middleware/region.js — Confining a query to the caller's region.
 *
 * The portal serves several load despatch centres from one deployment. An
 * ADMIN administers exactly one of them; a SUPERADMIN administers all. Stations
 * and QCAs are scoped to their own rows already, one level below this.
 *
 * The danger with region scoping is that a *missing* filter is silent: the
 * query succeeds and quietly returns another region's data. So every admin
 * listing goes through the helpers here rather than hand-writing the condition,
 * and there is a test that walks every admin endpoint asserting an ERLDC admin
 * sees no NRLDC rows.
 *
 * Usage in a route:
 *
 *   const params = [];
 *   const conditions = [];
 *   scopeToRegion(req, 'u.region', conditions, params);
 *   // → conditions gains "u.region = $1" unless the caller sees every region
 */

const pool = require('../db');
const { isSuperAdmin } = require('./auth');

const REGIONS = ['NRLDC', 'ERLDC', 'WRLDC', 'SRLDC', 'NERLDC'];

/** The reserved region holding settings that cannot differ between regions. */
const GLOBAL_REGION = 'GLOBAL';

function isValidRegion(region) {
  return REGIONS.includes(region);
}

/**
 * Which region this request should be confined to.
 *
 * Returns null when the caller sees everything — a super-admin who has not
 * asked for one region in particular. A super-admin may narrow the view with
 * ?region=ERLDC; anyone else gets their own region whatever they ask for.
 */
function regionScope(req) {
  if (isSuperAdmin(req)) {
    const asked = req.query?.region;
    return asked && isValidRegion(asked) ? asked : null;
  }
  return req.auth?.region ?? null;
}

/**
 * Add the region condition to a query being built, if one is needed.
 *
 * Mutates `conditions` and `params` in the style the routes already use, and
 * returns the region applied (or null for an unscoped super-admin view) so the
 * caller can mention it in a log line.
 */
function scopeToRegion(req, column, conditions, params) {
  const region = regionScope(req);
  if (!region) return null;
  params.push(region);
  conditions.push(`${column} = $${params.length}`);
  return region;
}

/**
 * May this caller act on something belonging to `region`?
 *
 * Used on the single-row paths — approving a registration, editing a user —
 * where there is no list to filter, just one row to accept or refuse.
 */
function canActOnRegion(req, region) {
  if (isSuperAdmin(req)) return true;
  if (!region) return false;
  return req.auth?.region === region;
}

/**
 * The 403 body for a cross-region attempt. Deliberately does not confirm what
 * was there: an ERLDC admin probing NRLDC usernames learns nothing from it.
 */
function crossRegionError(req) {
  return {
    error: `This belongs to another region. You administer ${req.auth?.region ?? 'no region'}.`,
  };
}

/**
 * The region a newly created row belongs to.
 *
 * For an ordinary admin that is their own region — they cannot create anything
 * elsewhere. A super-admin may name one, and falls back to their home region if
 * they do not.
 */
function regionForNewRow(req, requested) {
  if (isSuperAdmin(req) && requested && isValidRegion(requested)) return requested;
  if (isSuperAdmin(req)) return req.auth?.region ?? 'NRLDC';
  return req.auth?.region ?? 'NRLDC';
}

/**
 * Refuse an admin acting on an account outside their region.
 *
 * Attached as middleware to the single-account admin routes rather than
 * repeated inside each handler: there are seven of them, and the failure of
 * forgetting one is silent. A super-admin passes straight through.
 *
 * Reads the target username from req.params[param].
 */
function requireSameRegion(param = 'username') {
  return async (req, res, next) => {
    if (isSuperAdmin(req)) return next();
    const target = req.params[param];
    if (!target) return next();

    // Acting on your own account is always in your own region.
    if (req.auth && target.toLowerCase() === req.auth.username.toLowerCase()) return next();

    try {
      const result = await pool.query(
        'SELECT region FROM users WHERE LOWER(username) = LOWER($1)',
        [target]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (result.rows[0].region !== req.auth.region) {
        return res.status(403).json(crossRegionError(req));
      }
      return next();
    } catch (err) {
      console.error('[REGION GUARD]', err);
      return res.status(500).json({ error: 'Could not check which region this account belongs to.' });
    }
  };
}

module.exports = {
  REGIONS,
  requireSameRegion,
  GLOBAL_REGION,
  isValidRegion,
  regionScope,
  scopeToRegion,
  canActOnRegion,
  crossRegionError,
  regionForNewRow,
};
