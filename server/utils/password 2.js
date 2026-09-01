/**
 * utils/password.js — Password policy (server side).
 *
 * These are the rules the profile form has always advertised to users; they
 * are now enforced here so the promise is real. Keep this in sync with the
 * client-side mirror in src/utils/password.js.
 */

const crypto = require('crypto');

// The password every newly created, imported or admin-reset account starts
// with. Chosen to satisfy the policy below so test accounts stay easy to use.
const DEFAULT_PASSWORD = 'Password@123';

const MIN_LENGTH = 8;

const RULES = [
  { label: `Minimum ${MIN_LENGTH} characters`, test: (p) => p.length >= MIN_LENGTH },
  { label: 'At least 1 uppercase letter',      test: (p) => /[A-Z]/.test(p) },
  { label: 'At least 1 number',                test: (p) => /[0-9]/.test(p) },
  { label: 'At least 1 special character',     test: (p) => /[^a-zA-Z0-9]/.test(p) },
];

/**
 * Returns an error string when the password fails the policy, or null when it
 * passes.
 */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required.';
  }
  const failed = RULES.filter(r => !r.test(password)).map(r => r.label.toLowerCase());
  if (failed.length === 0) return null;
  return `Password does not meet the requirements: ${failed.join(', ')}.`;
}

/**
 * Generate a random password that satisfies the policy — used for the
 * temporary password emailed by password recovery. One character is drawn from
 * each required class, the remainder from the full set, then the whole thing is
 * shuffled so the classes are not in a predictable position.
 */
function generateCompliantPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O — easily misread in email
  const lower = 'abcdefghijkmnopqrstuvwxyz';  // no l
  const digits = '23456789';                  // no 0/1
  const special = '@#$%&*!?';
  const all = upper + lower + digits + special;

  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < Math.max(length, MIN_LENGTH)) chars.push(pick(all));

  // Fisher-Yates with a cryptographic source.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { DEFAULT_PASSWORD, MIN_LENGTH, RULES, validatePassword, generateCompliantPassword };
