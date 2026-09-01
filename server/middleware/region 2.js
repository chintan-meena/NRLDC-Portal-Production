/**
 * middleware/region.js — Confining a query to the caller's region.
 *
 * The portal serves several load despatch centres from one deployment, and
 * **every account is confined to its own region — including a SUPERADMIN**.
 * Nobody reads another centre's accounts, filings, outages or settings.
 *
 * The roles differ only in what they may create:
 *
 *   ADMIN       administers its own region, and may create users, QCAs and
 *               further admins *within that region*.
 *   SUPERADMIN  the same, plus the one power nobody else has: creating an
 *               admin for a *different* region. That is how a new despatch
 *               centre gets its first administrator, and it is the whole of
 *               the difference. It grants no extra visibility.
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
 * Which region this request is confined to — always the caller's own.
 *
 * There is deliberately no way to ask for another. A super-admin's extra power
 * is creating an admin elsewhere, not reading elsewhere, so no role and no
 * query parameter widens this.
 */
function regionScope(req) {
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
 * As scopeToRegion, but also admits rows belonging to no region at all.
 *
 * Only the system log has those — a failed login for a username that does not
 * exist, an SMTP failure — and they would otherwise be visible to nobody.
 */
function scopeToRegionOrUnassigned(req, column, conditions, params) {
  const region = regionScope(req);
  if (!region) return null;
  params.push(region);
  conditions.push(`(${column} = $${params.length} OR ${column} IS NULL)`);
  return region;
}

/**
 * May this caller act on something belonging to `region`?
 *
 * Used on the single-row paths — approving a registration, editing a user —
 * where there is no list to filter, just one row to accept or refuse.
 */
function canActOnRegion(req, region) {
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
/**
 * The region a newly created row belongs to: the creator's own.
 *
 * The single exception is a super-admin creating an ADMIN, which is how a new
 * region is opened — see regionForNewAccount.
 */
function regionForNewRow(req) {
  return req.auth?.region ?? 'NRLDC';
}

/**
 * Where a newly created *account* belongs, and whether the caller may make it.
 *
 * Returns { ok: true, region } or { ok: false, error }.
 *
 *   - Anyone administering may create USER and QCA accounts, in their own
 *     region only.
 *   - An admin may create further ADMINs, again in their own region.
 *   - Only a SUPERADMIN may name a different region, and only for an ADMIN:
 *     that is the act of opening a new despatch centre.
 *   - Only a SUPERADMIN may create another SUPERADMIN, and never elsewhere —
 *     the role carries no cross-region visibility to hand out.
 */
function regionForNewAccount(req, role, requestedRegion) {
  const home = req.auth?.region ?? 'NRLDC';
  const elsewhere = requestedRegion && isValidRegion(requestedRegion) && requestedRegion !== home;

  if (role === 'SUPERADMIN') {
    if (!isSuperAdmin(req)) {
      return { ok: false, error: 'Only a national administrator can create another national administrator.' };
    }
    if (elsewhere) {
      return { ok: false, error: 'A national administrator belongs to the region that created it.' };
    }
    return { ok: true, region: home };
  }

  if (role === 'ADMIN') {
    if (!elsewhere) return { ok: true, region: home };
    if (!isSuperAdmin(req)) {
      return {
        ok: false,
        error: `You administer ${home}, so you can only create administrators for ${home}. `
             + 'Opening another region is reserved for a national administrator.',
      };
    }
    return { ok: true, region: requestedRegion };
  }

  // Ordinary accounts never leave the creator's region.
  if (elsewhere) {
    return { ok: false, error: `Stations and QCAs can only be created in your own region, ${home}.` };
  }
  return { ok: true, region: home };
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
  scopeToRegionOrUnassigned,
  canActOnRegion,
  crossRegionError,
  regionForNewRow,
  regionForNewAccount,
};
