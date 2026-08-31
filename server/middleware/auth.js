/**
 * middleware/auth.js — Request authentication and authorisation.
 *
 * Every /api route except the public auth endpoints and the health check
 * requires a valid bearer token. Routes read the caller's identity from
 * `req.auth` — never from a client-supplied `username` field.
 */

const pool = require('../db');
const { verifyToken } = require('../auth/tokens');

function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

/** Rejects the request unless it carries a valid, unexpired token. */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  const claims = token ? verifyToken(token) : null;

  if (!claims) {
    return res.status(401).json({ error: 'Authentication required. Please log in again.' });
  }

  try {
    // A token that was explicitly logged out is refused for the rest of its
    // natural life. Tokens issued before revocation existed have no jti; those
    // are treated as current so upgrading does not sign everyone out.
    if (claims.jti) {
      const revoked = await pool.query(
        'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
        [claims.jti]
      );
      if (revoked.rows.length > 0) {
        return res.status(401).json({ error: 'This session has been signed out. Please log in again.' });
      }
    }

    // Re-read the account so a locked, deleted or demoted user cannot keep
    // using a token that was issued before the change.
    const result = await pool.query(
      'SELECT username, role, region, locked, energy_category, wbes_acronym, qca_name FROM users WHERE username = $1',
      [claims.username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Account no longer exists. Please log in again.' });
    }
    const user = result.rows[0];
    if (user.locked) {
      return res.status(403).json({ error: 'Your account is locked. Please contact the Admin.' });
    }

    req.auth = user;
    req.token = claims;      // carries jti and exp, used by the logout route
    next();
  } catch (err) {
    console.error('[AUTH MIDDLEWARE]', err);

    // 42P01 is "relation does not exist" — the schema is behind the code, and
    // the fix is a migration rather than anything the user can do.
    if (err.code === '42P01') {
      console.error('[AUTH MIDDLEWARE] The database schema is out of date. Run: ./nrldc.sh migrate');
      return res.status(503).json({
        error: 'The server database needs updating. Please tell your administrator to run "./nrldc.sh migrate".',
      });
    }

    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

/**
 * Rejects the request unless the caller administers something.
 *
 * A SUPERADMIN passes every check an ADMIN passes; what separates them is not
 * permission but reach, and that is decided by the region scope rather than
 * here. See middleware/region.js.
 */
function requireAdmin(req, res, next) {
  if (!req.auth || !['ADMIN', 'SUPERADMIN'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'Administrator privileges are required for this action.' });
  }
  next();
}

/** Rejects the request unless the caller administers every region. */
function requireSuperAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== 'SUPERADMIN') {
    return res.status(403).json({
      error: 'This action affects every region, so it is reserved for a national administrator.',
    });
  }
  next();
}

/**
 * Rejects the request unless the caller is an ADMIN or is acting on their own
 * account. Reads the target username from `req.params[param]`.
 */
function requireSelfOrAdmin(param = 'username') {
  return (req, res, next) => {
    const target = req.params[param];
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (['ADMIN', 'SUPERADMIN'].includes(req.auth.role)) return next();
    if (target && target.toLowerCase() === req.auth.username.toLowerCase()) return next();
    return res.status(403).json({ error: 'You may only act on your own account.' });
  };
}

/** True when the caller administers anything — one region or all of them. */
function isAdmin(req) {
  return !!req.auth && ['ADMIN', 'SUPERADMIN'].includes(req.auth.role);
}

/** True when the caller administers every region. */
function isSuperAdmin(req) {
  return !!req.auth && req.auth.role === 'SUPERADMIN';
}

module.exports = {
  requireAuth, requireAdmin, requireSuperAdmin, requireSelfOrAdmin, isAdmin, isSuperAdmin,
};
