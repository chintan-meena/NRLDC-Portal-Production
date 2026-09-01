/**
 * middleware/rateLimit.js — Request throttling.
 *
 * The previous setup was a single 200-requests-per-15-minutes limit keyed on
 * IP address. Two things made that unusable in an office:
 *
 *   - `trust proxy` is on and everyone sits behind one corporate NAT address,
 *     so the whole building shared one 200-request budget.
 *   - The Server Logs tab polls every 3 seconds, which is 300 requests per
 *     window on its own. An admin watching logs locked everyone out in about
 *     ten minutes.
 *
 * Limits are now keyed on the signed-in user where a token is present, and
 * split by how expensive the request is. The IP only identifies callers who
 * have not signed in yet, which is exactly the traffic worth throttling
 * tightly.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { verifyToken } = require('../auth/tokens');

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Identify the caller. The token is only signature-checked here — that is
 * enough to attribute a request, and it costs no database round trip. Callers
 * without a valid token fall back to their IP.
 */
function callerKey(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    const claims = verifyToken(header.slice(7).trim());
    if (claims) return `user:${claims.username.toLowerCase()}`;
  }
  // ipKeyGenerator normalises IPv6 addresses to a subnet, so a single client
  // cannot rotate through addresses in its own /64.
  return `ip:${ipKeyGenerator(req.ip)}`;
}

function makeLimiter({ max, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: callerKey,
    skipSuccessfulRequests,
    // A rejected login is answered with HTTP 200 and { success: false } — the
    // client needs the reason, not a bare status code. The limiter's own idea
    // of success is "status below 400", so without this every failed login
    // looked successful and skipSuccessfulRequests threw it away: passwords
    // could be sprayed across accounts without ever meeting a 429. Routes mark
    // a genuine auth failure on res.locals, and that is what counts here.
    requestWasSuccessful: (req, res) => res.statusCode < 400 && res.locals.authFailed !== true,
    message: { error: message },
  });
}

/**
 * Reads. Generous, because the dashboards poll: the log tab alone is 300
 * requests per window, and several people share a dashboard.
 */
const readLimiter = makeLimiter({
  max: parseInt(process.env.RATE_LIMIT_READ || '3000'),
  message: 'Too many requests. Please wait a moment and try again.',
});

/**
 * Writes. Far lower, since no human files thousands of discrepancies an hour,
 * but still well clear of normal use.
 */
const writeLimiter = makeLimiter({
  max: parseInt(process.env.RATE_LIMIT_WRITE || '600'),
  message: 'Too many changes submitted. Please wait a moment and try again.',
});

/**
 * Login, OTP and password recovery. Deliberately tight, and only failed
 * attempts count — signing in successfully should never push you toward a
 * lockout.
 */
const authLimiter = makeLimiter({
  max: parseInt(process.env.RATE_LIMIT_AUTH || '20'),
  message: 'Too many login attempts. Please try again in 15 minutes.',
  skipSuccessfulRequests: true,
});

/** Picks the read or write limiter based on the HTTP method. */
function apiLimiter(req, res, next) {
  const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  return isRead ? readLimiter(req, res, next) : writeLimiter(req, res, next);
}

module.exports = { apiLimiter, authLimiter, readLimiter, writeLimiter };
