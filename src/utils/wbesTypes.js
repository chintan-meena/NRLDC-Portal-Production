/**
 * utils/wbesTypes.js — WBES entity classification (client mirror).
 *
 * Mirrors server/utils/wbesTypes.js. Display only on the client, plus the
 * canonical list the admin type-correction dropdown and the System Parameters
 * self-registration switches are built from. The stored values and the
 * derivation live on the server; keep the two files in sync.
 */

export const UTILITY_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'TRADER', 'PARENT_STATE', 'EMBEDDED_IN_STATE'];

export const UTILITY_TYPE_LABELS = {
  ISGS: 'ISGS',
  REGIONAL_ENTITY: 'Regional Entity',
  TRADER: 'Trader',
  PARENT_STATE: 'Parent State',
  EMBEDDED_IN_STATE: 'Embedded in State',
};

export const GENERATOR_TYPES = ['RENEWABLE', 'THERMAL', 'HYDRO', 'GAS', 'NUCLEAR'];

/** The label for a stored utility type, falling back to the value itself. */
export function utilityTypeLabel(value) {
  return UTILITY_TYPE_LABELS[value] ?? value ?? '';
}

/** Parse a stored `signupUtilityTypes` CSV into an array of canonical types. */
export function parseSignupTypes(csv) {
  return String(csv || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => UTILITY_TYPES.includes(s));
}
