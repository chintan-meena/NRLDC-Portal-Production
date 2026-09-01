/**
 * utils/usernames.js — The portal's username convention (client side).
 *
 * Accounts are named after the plant's WBES acronym, so the login name is
 * something the operator already knows rather than something they have to be
 * told: DADRI becomes dadri@nrldc, and BIKANER_RE3 becomes bikaner.re3@nrldc.
 * Every account in the existing registry follows this shape, and deriving it
 * in one place keeps self-service registration, the admin's add-user form and
 * the approval screen from drifting apart.
 *
 * Keep this in sync with the client-side mirror in server/utils/usernames.js.
 */

export const DOMAIN = '@nrldc';

/**
 * Build the default username for a WBES acronym. Anything that is not a letter
 * or digit — underscores, spaces, hyphens — collapses to a single dot, which
 * is how the acronyms already in the registry were transliterated.
 *
 * Returns '' for an empty or unusable acronym, so callers can fall back to
 * whatever the user typed instead.
 */
export function defaultUsernameFor(acronym) {
  const slug = String(acronym || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return slug ? `${slug}${DOMAIN}` : '';
}
