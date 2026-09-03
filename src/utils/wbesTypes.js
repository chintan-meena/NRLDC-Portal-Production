/**
 * utils/wbesTypes.js — WBES entity classification (client mirror).
 *
 * Mirrors server/utils/wbesTypes.js. Display only on the client, plus the
 * canonical list the admin type-correction dropdown and the System Parameters
 * self-registration switches are built from. The stored values and the
 * derivation live on the server; keep the two files in sync.
 */

export const UTILITY_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'TRADER', 'PARENT_STATE', 'EMBEDDED_IN_STATE', 'QCA'];

export const UTILITY_TYPE_LABELS = {
  ISGS: 'ISGS',
  REGIONAL_ENTITY: 'Regional Entity',
  TRADER: 'Trader',
  PARENT_STATE: 'Parent State',
  EMBEDDED_IN_STATE: 'Embedded in State',
  QCA: 'QCA — Coordinating Agency',
};

export const GENERATOR_TYPES = ['RENEWABLE', 'THERMAL', 'HYDRO', 'GAS', 'NUCLEAR'];

// Generator SubType from WBES_Utility.xlsx — descriptive metadata on the register.
export const GENERATOR_SUBTYPES = ['SOLAR', 'WIND', 'HYBRID', 'STORAGE', 'PSP', 'COAL', 'LIGNITE', 'GAS', 'ROR', 'ROR_WITH_PONDAGE', 'SPD'];

export const GENERATOR_SUBTYPE_LABELS = {
  SOLAR: 'Solar',
  WIND: 'Wind',
  HYBRID: 'Hybrid',
  STORAGE: 'Storage',
  PSP: 'Pumped Storage (PSP)',
  COAL: 'Coal',
  LIGNITE: 'Lignite',
  GAS: 'Gas',
  ROR: 'Run of River',
  ROR_WITH_PONDAGE: 'Run of River with Pondage',
  SPD: 'SPD',
};

/**
 * The signup types — the vocabulary the self-registration gate and the register's
 * "Type" column speak: the Utility Types plus RENEWABLE, the split for a
 * renewable regional entity. EMBEDDED_IN_STATE stays one bucket regardless of
 * generator. Mirrors server/utils/wbesTypes.js.
 */
export const SIGNUP_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'RENEWABLE', 'TRADER', 'PARENT_STATE', 'EMBEDDED_IN_STATE', 'QCA'];

export const SIGNUP_TYPE_LABELS = {
  ISGS: 'ISGS',
  REGIONAL_ENTITY: 'Regional Entity',
  RENEWABLE: 'Renewable',
  TRADER: 'Trader',
  PARENT_STATE: 'Parent State',
  EMBEDDED_IN_STATE: 'Embedded in State',
  QCA: 'QCA — Coordinating Agency',
};

/** The label for a stored utility type, falling back to the value itself. */
export function utilityTypeLabel(value) {
  return UTILITY_TYPE_LABELS[value] ?? value ?? '';
}

/** The label for a signup type, falling back to the value itself. */
export function signupTypeLabel(value) {
  return SIGNUP_TYPE_LABELS[value] ?? value ?? '';
}

/** The label for a generator sub-type, falling back to the value itself. */
export function generatorSubTypeLabel(value) {
  return GENERATOR_SUBTYPE_LABELS[value] ?? value ?? '';
}

// The embedded-in-state family — all fold to EMBEDDED_IN_STATE, none may
// self-register or file. Kept in sync with server/utils/wbesTypes.js.
const EMBEDDED_ALIASES = ['EMBEDDED', 'EMBEDDED_IN_DISCOM', 'DISCOM', 'STATE_UTIL', 'STATE_UTILITY', 'BENEFICIARY'];

/**
 * The signup type for a utility/generator pair — a renewable regional entity
 * becomes RENEWABLE; the embedded family folds to EMBEDDED_IN_STATE; a QCA keeps
 * QCA; everything else keeps its utility type. Empty when the row is
 * unclassified.
 */
export function deriveSignupType(utilityType, generatorType) {
  const u = String(utilityType || '').trim().toUpperCase();
  if (u === 'REGIONAL_ENTITY' && String(generatorType || '').trim().toUpperCase() === 'RENEWABLE') return 'RENEWABLE';
  if (EMBEDDED_ALIASES.includes(u)) return 'EMBEDDED_IN_STATE';
  return UTILITY_TYPES.includes(u) ? u : '';
}

/** True when a signup type is a QCA coordinating agency (not a plant). */
export function isQcaSignupType(signupType) {
  return String(signupType || '').trim().toUpperCase() === 'QCA';
}

/** Parse a stored `signupUtilityTypes` CSV into an array of canonical signup types. */
export function parseSignupTypes(csv) {
  return String(csv || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => SIGNUP_TYPES.includes(s));
}
