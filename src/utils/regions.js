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

/** True when this account administers every region rather than one. */
export const isNational = (user) => user?.role === 'SUPERADMIN';
