/**
 * utils/usernames.js — The portal's username convention (server side).
 *
 * Accounts are named after the plant's WBES acronym, so the login name is
 * something the operator already knows rather than something they have to be
 * told: DADRI becomes dadri@nrldc, and BIKANER_RE3 becomes bikaner.re3@nrldc.
 * Every account in the existing registry follows this shape, and deriving it
 * in one place keeps self-service registration, the admin's add-user form and
 * the approval screen from drifting apart.
 *
 * Keep this in sync with the client-side mirror in src/utils/usernames.js.
 */

const DOMAIN = '@nrldc';

/**
 * Build the default username for a WBES acronym. Anything that is not a letter
 * or digit — underscores, spaces, hyphens — collapses to a single dot, which
 * is how the acronyms already in the registry were transliterated.
 *
 * Returns '' for an empty or unusable acronym, so callers can fall back to
 * whatever the user typed instead.
 */
function defaultUsernameFor(acronym) {
  const slug = String(acronym || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return slug ? `${slug}${DOMAIN}` : '';
}

/**
 * Build a username from a plant's WBES acronym *and* its region:
 * <acronym-slug>@<region>, e.g. ('BIKANER_RE3', 'ERLDC') → 'bikaner.re3@erldc'.
 *
 * This is the convention self-service registration follows once the applicant
 * picks a registered acronym — the acronym decides the local part and the
 * region (carried on the acronym's wbes_entities row) decides the namespace.
 * Unlike defaultUsernameFor(), which hardcodes '@nrldc', this names the account
 * for the region that actually despatches the plant.
 *
 * Returns '' when either part is missing, so callers can fall back.
 */
function usernameFromAcronym(acronym, region) {
  const slug = String(acronym || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  const ns = String(region || '').trim().toLowerCase();
  return slug && ns ? `${slug}@${ns}` : '';
}

/**
 * An acronym that can serve as a namespace: letters and digits, 2–10 of them.
 * Anything else would produce usernames that are awkward to type or ambiguous.
 */
const ACRONYM_RULE = /^[A-Za-z0-9]{2,10}$/;

/**
 * Put a username inside a region's namespace: <name>@<acronym>, lowercased.
 *
 * This is enforced rather than suggested. A region's acronym is its
 * organisational identity, so an account belonging to it is named for it —
 * "user1" and "user1@erldc" and "USER1@NRLDC" all become "user1@nrldc" when
 * created by NRLDC's administrator, and there is no input that produces an
 * account named for a region it does not belong to.
 *
 * Authorisation never reads this. The account's role and region columns decide
 * what it may do; the name is for people.
 */
function usernameForRegion(name, acronym) {
  const local = String(name || '')
    .trim()
    .toLowerCase()
    .split('@')[0]                      // drop any namespace that was typed
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[.\-_]+|[.\-_]+$/g, '');
  const ns = String(acronym || '').trim().toLowerCase();
  if (!local || !ns) return '';
  return `${local}@${ns}`;
}

/** Does this username sit inside the region's namespace? */
function isInRegionNamespace(username, acronym) {
  if (!username || !acronym) return false;
  return String(username).trim().toLowerCase().endsWith(`@${String(acronym).trim().toLowerCase()}`);
}

module.exports = {
  DOMAIN, defaultUsernameFor, usernameFromAcronym, usernameForRegion, isInRegionNamespace, ACRONYM_RULE,
};
