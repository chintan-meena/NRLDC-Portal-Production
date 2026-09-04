/**
 * Unit tests for utils/html.js — HTML escaping for email bodies.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../../utils/html');

test('escapes the five HTML-significant characters', () => {
  assert.equal(escapeHtml('<b>'), '&lt;b&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('neutralises a script payload in a name', () => {
  assert.equal(
    escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
});

test('leaves ordinary text untouched', () => {
  assert.equal(escapeHtml('Dadri Thermal Unit 1'), 'Dadri Thermal Unit 1');
});

test('handles null and undefined as empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
