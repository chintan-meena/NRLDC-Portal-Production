/**
 * utils/usernames.js — The portal's username convention (client side).
 *
 * Accounts are named after the plant's WBES acronym, so the login name is
 * something the operator already knows rather than something they have to be
 * told: DADRI becomes dadri@nrldc, and DADRI_THERMAL becomes dadri_thermal@nrldc.
 * The acronym's own separators (underscores, hyphens, dots) are kept so the
 * login name reads as the acronym itself, only lowercased. Every account
 * follows this shape, and deriving it in one place keeps self-service
 * registration, the admin's add-user form and the approval screen from drifting
 * apart.
 *
 * Keep this in sync with the client-side mirror in server/utils/usernames.js.
 */

export const DOMAIN = '@nrldc';

/**
 * Slugify a WBES acronym into the local part of a username: lowercased, with the
 * acronym's own separators (dot, underscore, hyphen) kept as-is so the name
 * stays the acronym. Anything else — a space or stray character — collapses to a
 * dot. Leading/trailing separators are trimmed. Returns '' when nothing usable
 * is left.
 */
function acronymSlug(acronym) {
  return String(acronym || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[.\-_]+|[.\-_]+$/g, '');
}

/**
 * Build the default username for a WBES acronym: the lowercased acronym plus the
 * '@nrldc' domain. Returns '' for an empty or unusable acronym, so callers can
 * fall back to whatever the user typed instead.
 */
export function defaultUsernameFor(acronym) {
  const slug = acronymSlug(acronym);
  return slug ? `${slug}${DOMAIN}` : '';
}

/**
 * Build a username from a plant's WBES acronym *and* its region:
 * <acronym>@<region>, e.g. ('BIKANER_RE3', 'ERLDC') → 'bikaner_re3@erldc'.
 *
 * Self-service registration uses this once the applicant picks a registered
 * acronym: the acronym's row carries the region, so the account is named for
 * the centre that despatches it rather than always '@nrldc'.
 *
 * Mirror of usernameFromAcronym in server/utils/usernames.js.
 */
export function usernameFromAcronym(acronym, region) {
  const slug = acronymSlug(acronym);
  const ns = String(region || '').trim().toLowerCase();
  return slug && ns ? `${slug}@${ns}` : '';
}
