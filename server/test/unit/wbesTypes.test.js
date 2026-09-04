/**
 * Unit tests for utils/wbesTypes.js — the classification the self-registration
 * gate turns on, and the energy_category derivation.
 *
 * The security-relevant invariant here is that EMBEDDED_IN_STATE (and its
 * aliases) is never in the default self-registration set: with no account it can
 * file nothing. A regression that admitted it by default would open the filing
 * surface to thousands of embedded consumers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SIGNUP_TYPES,
  normalizeUtilityType, normalizeGeneratorType,
  deriveEnergyCategory, deriveSignupType, parseSignupTypes,
} = require('../../utils/wbesTypes');

test('EMBEDDED_IN_STATE is never a default signup type', () => {
  assert.equal(DEFAULT_SIGNUP_TYPES.includes('EMBEDDED_IN_STATE'), false);
});

test('the embedded-in-state family all folds onto EMBEDDED_IN_STATE', () => {
  for (const raw of ['Embedded in State', 'embedded-in-state', 'discom', 'STATE_UTIL', 'beneficiary', 'embedded_in_discom']) {
    assert.equal(normalizeUtilityType(raw), 'EMBEDDED_IN_STATE', raw);
  }
});

test('normalizeUtilityType accepts known spellings and rejects the unknown', () => {
  assert.equal(normalizeUtilityType('REGIONAL_ENTITIES'), 'REGIONAL_ENTITY');
  assert.equal(normalizeUtilityType('state'), 'PARENT_STATE');
  assert.equal(normalizeUtilityType('ISGS'), 'ISGS');
  assert.equal(normalizeUtilityType('nonsense'), null);
  assert.equal(normalizeUtilityType(''), null);
});

test('energy_category is derived, not defaulted', () => {
  assert.equal(deriveEnergyCategory('ISGS', null), 'ISGS');
  assert.equal(deriveEnergyCategory('REGIONAL_ENTITY', 'RENEWABLE'), 'RE');
  assert.equal(deriveEnergyCategory('REGIONAL_ENTITY', 'THERMAL'), 'ISGS');
  assert.equal(deriveEnergyCategory('PARENT_STATE', null), 'States');
  assert.equal(deriveEnergyCategory('EMBEDDED_IN_STATE', null), 'States');
  assert.equal(deriveEnergyCategory('TRADER', null), 'Traders');
  assert.equal(deriveEnergyCategory('QCA', null), 'RE'); // keeps qca_is_renewable_only satisfied
});

test('an unclassifiable row falls back to RE, matching the column default', () => {
  assert.equal(deriveEnergyCategory('nonsense', 'nonsense'), 'RE');
});

test('a renewable regional entity is its own signup type', () => {
  assert.equal(deriveSignupType('REGIONAL_ENTITY', 'RENEWABLE'), 'RENEWABLE');
  assert.equal(deriveSignupType('REGIONAL_ENTITY', 'THERMAL'), 'REGIONAL_ENTITY');
  assert.equal(deriveSignupType('ISGS', null), 'ISGS');
});

test('normalizeGeneratorType folds known types', () => {
  assert.equal(normalizeGeneratorType('renewable'), 'RENEWABLE');
  assert.equal(normalizeGeneratorType('Thermal'), 'THERMAL');
  assert.equal(normalizeGeneratorType('windmill'), null);
});

test('parseSignupTypes yields a canonical set from CSV', () => {
  const s = parseSignupTypes('ISGS, QCA , RENEWABLE, nonsense');
  assert.equal(s.has('ISGS'), true);
  assert.equal(s.has('QCA'), true);
  assert.equal(s.has('RENEWABLE'), true);
  assert.equal(s.has('nonsense'), false);
});
