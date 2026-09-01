/**
 * password.js — Password policy (client side).
 *
 * Mirrors server/utils/password.js so the form can give immediate feedback.
 * The server validates independently — this is convenience, not the guard.
 * Keep the two in sync.
 */

// The password every newly created, imported or admin-reset account starts with.
export const DEFAULT_PASSWORD = 'Password@123';

export const MIN_LENGTH = 8;

export const RULES = [
  { label: `Minimum ${MIN_LENGTH} characters`, test: (p) => p.length >= MIN_LENGTH },
  { label: 'At least 1 uppercase letter',      test: (p) => /[A-Z]/.test(p) },
  { label: 'At least 1 number',                test: (p) => /[0-9]/.test(p) },
  { label: 'At least 1 special character',     test: (p) => /[^a-zA-Z0-9]/.test(p) },
];

/** Returns an error string when the password fails the policy, else null. */
export function validatePassword(password) {
  if (!password) return 'A password is required.';
  const failed = RULES.filter(r => !r.test(password)).map(r => r.label.toLowerCase());
  if (failed.length === 0) return null;
  return `Password does not meet the requirements: ${failed.join(', ')}.`;
}

/** How many rules the password currently satisfies — drives the strength meter. */
export function passwordScore(password) {
  if (!password) return 0;
  return RULES.filter(r => r.test(password)).length;
}
