/**
 * utils/wbesTypes.js — The WBES entity classification the portal gates on.
 *
 * The source WBES_Utility.xlsx carries a "Utility Type" column far finer than
 * the portal's four energy categories: it separates PARENT_STATE (the state
 * utility itself) from EMBEDDED_IN_STATE (the thousands of captive/industrial
 * consumers embedded in a state's schedule) — a distinction 'States' alone
 * cannot make, and the one the self-registration gate turns on. It also carries
 * a "Generator Type" that tells a renewable regional entity from a conventional
 * one, which is what recovers RE vs ISGS.
 *
 * energy_category (ISGS / RE / States / Traders) stays the portal's working
 * category — filing rules, QCA-is-RE, the outage switches all read it — but it
 * is now *derived* from these two rather than defaulted to 'RE' at upload.
 *
 * Keep in sync with src/utils/wbesTypes.js.
 */

// The canonical Utility Types, in the order they should be offered on screen.
const UTILITY_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'TRADER', 'PARENT_STATE', 'EMBEDDED_IN_STATE'];

const UTILITY_TYPE_LABELS = {
  ISGS: 'ISGS',
  REGIONAL_ENTITY: 'Regional Entity',
  TRADER: 'Trader',
  PARENT_STATE: 'Parent State',
  EMBEDDED_IN_STATE: 'Embedded in State',
};

// Everything but EMBEDDED_IN_STATE — the default a region self-registers with
// until its administrator narrows or widens it in System Parameters.
const DEFAULT_SIGNUP_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'TRADER', 'PARENT_STATE'];

const GENERATOR_TYPES = ['RENEWABLE', 'THERMAL', 'HYDRO', 'GAS', 'NUCLEAR'];

/**
 * Fold a raw cell value onto a canonical Utility Type, or null if unrecognised.
 * Tolerant of spacing and punctuation ("Embedded in State", "embedded-in-state").
 */
function normalizeUtilityType(raw) {
  const key = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if (UTILITY_TYPES.includes(key)) return key;
  // A couple of spellings the WBES exports have used.
  if (key === 'REGIONAL_ENTITIES') return 'REGIONAL_ENTITY';
  if (key === 'STATE' || key === 'PARENT') return 'PARENT_STATE';
  if (key === 'EMBEDDED') return 'EMBEDDED_IN_STATE';
  return null;
}

/** Fold a raw generator value onto a canonical Generator Type, or null. */
function normalizeGeneratorType(raw) {
  const key = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return GENERATOR_TYPES.includes(key) ? key : null;
}

/**
 * The working energy_category for a utility/generator pair. Always one of the
 * four the schema's CHECK allows. Unknown falls back to 'RE' — the column's own
 * historical default — so nothing regresses on a row we cannot classify.
 */
function deriveEnergyCategory(utilityType, generatorType) {
  switch (normalizeUtilityType(utilityType)) {
    case 'ISGS': return 'ISGS';
    case 'REGIONAL_ENTITY': return normalizeGeneratorType(generatorType) === 'RENEWABLE' ? 'RE' : 'ISGS';
    case 'PARENT_STATE':
    case 'EMBEDDED_IN_STATE': return 'States';
    case 'TRADER': return 'Traders';
    default: return 'RE';
  }
}

/** Parse a stored `signupUtilityTypes` CSV into a Set of canonical types. */
function parseSignupTypes(csv) {
  return new Set(String(csv || '')
    .split(',')
    .map(s => normalizeUtilityType(s))
    .filter(Boolean));
}

module.exports = {
  UTILITY_TYPES, UTILITY_TYPE_LABELS, DEFAULT_SIGNUP_TYPES, GENERATOR_TYPES,
  normalizeUtilityType, normalizeGeneratorType, deriveEnergyCategory, parseSignupTypes,
};
