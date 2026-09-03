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

/**
 * The signup types — the vocabulary the self-registration gate and the register's
 * "Type" column speak: the Utility Types plus RENEWABLE, the split for a
 * renewable regional entity. EMBEDDED_IN_STATE stays one bucket regardless of
 * generator. Mirrors server/utils/wbesTypes.js.
 */
export const SIGNUP_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'RENEWABLE', 'TRADER', 'PARENT_STATE', 'EMBEDDED_IN_STATE'];

export const SIGNUP_TYPE_LABELS = {
  ISGS: 'ISGS',
  REGIONAL_ENTITY: 'Regional Entity',
  RENEWABLE: 'Renewable',
  TRADER: 'Trader',
  PARENT_STATE: 'Parent State',
  EMBEDDED_IN_STATE: 'Embedded in State',
};

/** The label for a stored utility type, falling back to the value itself. */
export function utilityTypeLabel(value) {
  return UTILITY_TYPE_LABELS[value] ?? value ?? '';
}

/** The label for a signup type, falling back to the value itself. */
export function signupTypeLabel(value) {
  return SIGNUP_TYPE_LABELS[value] ?? value ?? '';
}

/**
 * The signup type for a utility/generator pair — a renewable regional entity
 * becomes RENEWABLE; everything else keeps its utility type. Empty when the row
 * is unclassified.
 */
export function deriveSignupType(utilityType, generatorType) {
  const u = String(utilityType || '').trim().toUpperCase();
  if (u === 'REGIONAL_ENTITY' && String(generatorType || '').trim().toUpperCase() === 'RENEWABLE') return 'RENEWABLE';
  return UTILITY_TYPES.includes(u) ? u : '';
}

/** Parse a stored `signupUtilityTypes` CSV into an array of canonical signup types. */
export function parseSignupTypes(csv) {
  return String(csv || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => SIGNUP_TYPES.includes(s));
}
