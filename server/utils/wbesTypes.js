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

const GENERATOR_TYPES = ['RENEWABLE', 'THERMAL', 'HYDRO', 'GAS', 'NUCLEAR'];

/**
 * The signup types — the vocabulary the self-registration gate and the register's
 * "Type" column speak. It is the Utility Types with one extra split: a
 * REGIONAL_ENTITY whose generator is renewable is its own type, RENEWABLE, so a
 * region can admit renewable and conventional regional entities separately.
 * EMBEDDED_IN_STATE stays one bucket whether or not it is renewable.
 */
const SIGNUP_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'RENEWABLE', 'TRADER', 'PARENT_STATE', 'EMBEDDED_IN_STATE'];

const SIGNUP_TYPE_LABELS = {
  ISGS: 'ISGS',
  REGIONAL_ENTITY: 'Regional Entity',
  RENEWABLE: 'Renewable',
  TRADER: 'Trader',
  PARENT_STATE: 'Parent State',
  EMBEDDED_IN_STATE: 'Embedded in State',
};

// Everything but EMBEDDED_IN_STATE — the default a region self-registers with
// until its administrator narrows or widens it in System Parameters. Renewable
// regional entities register by default, alongside conventional ones.
const DEFAULT_SIGNUP_TYPES = ['ISGS', 'REGIONAL_ENTITY', 'RENEWABLE', 'TRADER', 'PARENT_STATE'];

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

/** Fold a raw cell value onto a canonical Signup Type, or null if unrecognised. */
function normalizeSignupType(raw) {
  const key = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (SIGNUP_TYPES.includes(key)) return key;
  // RENEWABLE is a signup type of its own; anything else folds onto a utility type.
  return key === 'RENEWABLE' ? 'RENEWABLE' : normalizeUtilityType(key);
}

/**
 * The signup type for a utility/generator pair — what the register's Type column
 * shows and what the self-registration gate matches on. A renewable regional
 * entity becomes RENEWABLE; everything else keeps its utility type. Null when the
 * row is unclassified (which the gate treats as allowed).
 */
function deriveSignupType(utilityType, generatorType) {
  const u = normalizeUtilityType(utilityType);
  if (u === 'REGIONAL_ENTITY' && normalizeGeneratorType(generatorType) === 'RENEWABLE') return 'RENEWABLE';
  return u;
}

/** Parse a stored `signupUtilityTypes` CSV into a Set of canonical signup types. */
function parseSignupTypes(csv) {
  return new Set(String(csv || '')
    .split(',')
    .map(s => normalizeSignupType(s))
    .filter(Boolean));
}

module.exports = {
  UTILITY_TYPES, UTILITY_TYPE_LABELS, DEFAULT_SIGNUP_TYPES, GENERATOR_TYPES,
  SIGNUP_TYPES, SIGNUP_TYPE_LABELS,
  normalizeUtilityType, normalizeGeneratorType, normalizeSignupType,
  deriveEnergyCategory, deriveSignupType, parseSignupTypes,
};
