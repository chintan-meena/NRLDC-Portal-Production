/**
 * Unit tests for utils/password.js — the password policy the profile form
 * advertises and the server now enforces.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PASSWORD, validatePassword, generateCompliantPassword } = require('../../utils/password');

test('a compliant password passes', () => {
  assert.equal(validatePassword('Password@123'), null);
  assert.equal(validatePassword('Str0ng!pass'), null);
});

test('the shipped default password satisfies its own policy', () => {
  assert.equal(validatePassword(DEFAULT_PASSWORD), null);
});

test('each rule is enforced independently', () => {
  assert.match(validatePassword('short1@A'.slice(0, 6)), /requirements/); // too short
  assert.notEqual(validatePassword('alllowercase1@'), null);             // no uppercase
  assert.notEqual(validatePassword('NoSpecial123'), null);               // no special
  assert.notEqual(validatePassword('NoNumber@abcD'), null);              // no digit
});

test('an empty or non-string password is rejected', () => {
  assert.match(validatePassword(''), /required/);
  assert.match(validatePassword(null), /required/);
  assert.match(validatePassword(12345678), /required/);
});

test('generated passwords always satisfy the policy', () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(validatePassword(generateCompliantPassword()), null);
  }
});

test('generated passwords honour a requested length', () => {
  assert.equal(generateCompliantPassword(20).length, 20);
  // shorter-than-minimum requests are floored at the minimum, never returned weak
  assert.ok(generateCompliantPassword(4).length >= 8);
});
