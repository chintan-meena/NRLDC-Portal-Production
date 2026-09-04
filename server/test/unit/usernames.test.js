/**
 * Unit tests for utils/usernames.js — the account-naming convention that keeps
 * self-registration, the add-user form and the approval screen from drifting.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultUsernameFor, usernameFromAcronym, usernameForRegion, isInRegionNamespace, ACRONYM_RULE,
} = require('../../utils/usernames');

test('the default username is the lowercased acronym at @nrldc', () => {
  assert.equal(defaultUsernameFor('DADRI'), 'dadri@nrldc');
});

test('acronym separators are preserved so the name reads as the acronym', () => {
  assert.equal(defaultUsernameFor('DADRI_THERMAL'), 'dadri_thermal@nrldc');
  assert.equal(defaultUsernameFor('unit-1.a'), 'unit-1.a@nrldc');
});

test('spaces and stray characters collapse to a dot and trim', () => {
  assert.equal(defaultUsernameFor('DADRI THERMAL'), 'dadri.thermal@nrldc');
  assert.equal(defaultUsernameFor('  X#Y  '), 'x.y@nrldc');
});

test('an unusable acronym yields an empty string so the caller can fall back', () => {
  assert.equal(defaultUsernameFor(''), '');
  assert.equal(defaultUsernameFor('###'), '');
});

test('usernameFromAcronym names the account for the despatching region', () => {
  assert.equal(usernameFromAcronym('BIKANER_RE3', 'ERLDC'), 'bikaner_re3@erldc');
  assert.equal(usernameFromAcronym('X', ''), '');
  assert.equal(usernameFromAcronym('', 'ERLDC'), '');
});

test('usernameForRegion drops any typed namespace and applies the region', () => {
  assert.equal(usernameForRegion('user1', 'ERLDC'), 'user1@erldc');
  assert.equal(usernameForRegion('USER1@NRLDC', 'ERLDC'), 'user1@erldc');
  assert.equal(usernameForRegion('user1@erldc', 'NRLDC'), 'user1@nrldc');
});

test('isInRegionNamespace matches only the exact namespace', () => {
  assert.equal(isInRegionNamespace('dadri@nrldc', 'NRLDC'), true);
  assert.equal(isInRegionNamespace('dadri@nrldc', 'ERLDC'), false);
  assert.equal(isInRegionNamespace('', 'NRLDC'), false);
});

test('the acronym rule is 2..10 alphanumerics only', () => {
  assert.equal(ACRONYM_RULE.test('AB'), true);
  assert.equal(ACRONYM_RULE.test('ABC123'), true);
  assert.equal(ACRONYM_RULE.test('A'), false);
  assert.equal(ACRONYM_RULE.test('ABCDEFGHIJK'), false); // 11
  assert.equal(ACRONYM_RULE.test('AB_CD'), false);
  assert.equal(ACRONYM_RULE.test('AB CD'), false);
});
