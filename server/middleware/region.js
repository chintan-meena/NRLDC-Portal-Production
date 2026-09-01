/**
 * middleware/region.js — Confining a query to the caller's region.
 *
 * Three levels, and each stops where the next begins:
 *
 *   SUPERADMIN  the national administrator. Creates and manages regions and
 *               their administrators, and sees across all of them. Does NOT
 *               create ordinary users — that is the region's own business.
 *   ADMIN       administers exactly one region. Creates the users and QCAs in
 *               it. Cannot create administrators, and cannot reach another
 *               region at all.
 *   USER / QCA  scoped to their own rows within their region, as before.
 *
 * The boundary is enforced here and in the queries, never in the interface. A
 * regional admin who edits a request by hand gets the same refusal as one who
 * clicks a button, because the region comes from req.auth — which is read from
 * the database on every request — and never from anything the client sends.
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

/** The reserved region holding settings that cannot differ between regions. */
const GLOBAL_REGION = 'GLOBAL';

// Regions are rows now, so the list comes from the registry rather than a
// constant. The foreign keys are what actually enforce it; this is validation.
const { isValidRegion, regionCodes } = require('../utils/regionRegistry');

/**
 * Which region this request is confined to.
 *
 * Returns null for the national administrator, meaning "no restriction" — they
 * have visibility across every region, and may narrow to one with ?region=X.
 * Everyone else gets their own region whatever the request asks for.
 */
function regionScope(req) {
  if (isSuperAdmin(req)) {
    const asked = req.query?.region;
    return asked && isValidRegion(asked) ? String(asked).toUpperCase() : null;
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
  if (isSuperAdmin(req)) return true;      // national: across all regions
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
  // Null for a national account, which belongs to no region. Callers that
  // create rows must refuse rather than invent one.
  return req.auth?.region ?? null;
}

/**
 * Where a newly created *account* belongs, and whether the caller may make it.
 *
 * Returns { ok: true, region } or { ok: false, error }.
 *
 * The hierarchy in one place:
 *
 *   national  → creates ADMIN (and further national admins) in ANY region.
 *               Does NOT create ordinary users: a region's users are its own
 *               administrator's responsibility, and the national account
 *               having that power would blur the level it sits at.
 *   regional  → creates USER and QCA in its OWN region only. Cannot create
 *               administrators of any kind.
 *
 * A regional admin cannot name a region at all: theirs is taken from the
 * account making the request, so there is no field to tamper with.
 */
function regionForNewAccount(req, role, requestedRegion) {
  const home = req.auth?.region ?? null;   // null for the national account
  const national = isSuperAdmin(req);
  const wanted = requestedRegion ? String(requestedRegion).toUpperCase() : null;

  if (role === 'SUPERADMIN' || role === 'ADMIN') {
    if (!national) {
      return {
        ok: false,
        error: 'Only the national administrator creates administrator accounts. '
             + `You administer ${home}, and can create users and QCAs within it.`,
      };
    }
    if (role === 'ADMIN') {
      if (!wanted) return { ok: false, error: 'Choose which region this administrator will run.' };
      if (!isValidRegion(wanted)) return { ok: false, error: `There is no region "${requestedRegion}".` };
      return { ok: true, region: wanted };
    }
    // A further national administrator sits at the national level; its region
    // is only a home label, so it inherits the creator's.
    return { ok: true, region: home };
  }

  // Ordinary accounts. The national administrator does not create these.
  if (national) {
    return {
      ok: false,
      error: 'The national administrator creates regions and their administrators, not users. '
           + 'Ask the region\'s administrator to create this account.',
    };
  }
  if (!home) return { ok: false, error: 'Your account has no region, so it cannot create users.' };
  if (wanted && wanted !== home) {
    return { ok: false, error: `You administer ${home}, so accounts you create belong to ${home}.` };
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
    if (isSuperAdmin(req)) return next();   // national: across all regions
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
  get REGIONS() { return regionCodes(); },
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
