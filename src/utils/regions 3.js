/**
 * utils/regions.js — The regional load despatch centres (client side).
 *
 * Keep in sync with REGIONS in server/middleware/region.js and the CHECK
 * constraints in server/schema.sql.
 */

export const REGIONS = [
  { code: 'NRLDC',  name: 'Northern' },
  { code: 'ERLDC',  name: 'Eastern' },
  { code: 'WRLDC',  name: 'Western' },
  { code: 'SRLDC',  name: 'Southern' },
  { code: 'NERLDC', name: 'North Eastern' },
];

export const REGION_CODES = REGIONS.map(r => r.code);

/** "Northern (NRLDC)" — for a dropdown, where the full name helps. */
export function regionLabel(code) {
  const found = REGIONS.find(r => r.code === code);
  return found ? `${found.name} (${found.code})` : code;
}

/**
 * True for the national administrator.
 *
 * It does NOT mean "sees every region" — every account, this one included, is
 * confined to its own. It means the one extra power: creating an administrator
 * for another region, which is how a new despatch centre is opened.
 */
export const isNational = (user) => user?.role === 'SUPERADMIN';

/** True when this account administers a region. */
export const isAdminRole = (user) => ['ADMIN', 'SUPERADMIN'].includes(user?.role);
