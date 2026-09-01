/**
 * auth/tokens.js — Stateless HMAC-signed session tokens.
 *
 * Format: base64url(payload).base64url(HMAC-SHA256(payload, SESSION_SECRET))
 * The payload carries the username, role and expiry, so every request can be
 * attributed to a real account without trusting anything the client sends in
 * the body or query string.
 *
 * Implemented with node:crypto so the server gains no new dependency.
 */

const crypto = require('crypto');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// Behind a load balancer the per-process fallback below is not merely
// inconvenient, it is broken: each process would sign with a different key and
// reject every token issued by its siblings, so users would be bounced back to
// the login screen at random with nothing in the logs to explain it. In
// production that is a refusal to start, not a warning.
let SECRET = process.env.SESSION_SECRET;
const SECRET_IS_UNSET = !SECRET || SECRET.trim() === '' || SECRET === 'nrldc_secret_key_2026';

if (SECRET_IS_UNSET && process.env.NODE_ENV === 'production') {
  const line = '─'.repeat(66);
  console.error('');
  console.error(line);
  console.error('  SESSION_SECRET IS NOT SET — the server will not start.');
  console.error(line);
  console.error('');
  console.error('  Session tokens are signed with this value. Without it each server');
  console.error('  process invents its own, so behind a load balancer users are signed');
  console.error('  out at random as their requests move between processes.');
  console.error('');
  console.error('  Generate one, and give every process the same value:');
  console.error('');
  console.error('      openssl rand -hex 32');
  console.error('');
  console.error('  then put it in server/.env as:');
  console.error('');
  console.error('      SESSION_SECRET=<the generated value>');
  console.error('');
  console.error(line);
  console.error('');
  process.exit(1);
}

if (SECRET_IS_UNSET) {
  SECRET = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[AUTH] SESSION_SECRET is missing or still set to the shipped default. ' +
    'A random secret was generated for this process — all sessions will be ' +
    'invalidated on restart, and running more than one process would break ' +
    'logins entirely. Set a strong SESSION_SECRET in server/.env.'
  );
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadB64) {
  return b64url(crypto.createHmac('sha256', SECRET).update(payloadB64).digest());
}

/**
 * Issue a token for a user row.
 *
 * Each token carries a unique id (jti) so that a single logout can revoke that
 * one session without disturbing the user's other devices.
 */
function issueToken(user) {
  const payload = {
    u: user.username,
    r: user.role,
    g: user.region,
    jti: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a token's signature and expiry. Returns { username, role, region, jti, exp }
 * or null when the token is malformed, tampered with, or expired.
 *
 * This says nothing about revocation — the auth middleware checks that against
 * the revoked_tokens table, because it needs the database.
 */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, providedSig] = parts;
  const expectedSig = sign(payloadB64);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.u !== 'string') return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;

  return { username: payload.u, role: payload.r, region: payload.g, jti: payload.jti, exp: payload.exp };
}

module.exports = { issueToken, verifyToken, TOKEN_TTL_MS };
