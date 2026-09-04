/**
 * Unit tests for utils/timeBlocks.js — the 15-minute block field parser.
 * Pure functions, no database. Run with `npm run test:unit`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTimeBlocks, condense, MIN_BLOCK, MAX_BLOCK } = require('../../utils/timeBlocks');

test('parses a single block', () => {
  const r = parseTimeBlocks('4');
  assert.equal(r.ok, true);
  assert.deepEqual(r.blocks, [4]);
  assert.equal(r.normalised, '4');
});

test('parses a mixed list and range, normalising to compact text', () => {
  const r = parseTimeBlocks('1-4, 20, 55-60');
  assert.equal(r.ok, true);
  assert.deepEqual(r.blocks, [1, 2, 3, 4, 20, 55, 56, 57, 58, 59, 60]);
  assert.equal(r.normalised, '1-4, 20, 55-60');
});

test('deduplicates overlapping blocks', () => {
  const r = parseTimeBlocks('4,4,5, 4-5');
  assert.equal(r.ok, true);
  assert.deepEqual(r.blocks, [4, 5]);
});

test('tolerates empty segments and trailing commas', () => {
  const r = parseTimeBlocks('4,,5,');
  assert.equal(r.ok, true);
  assert.deepEqual(r.blocks, [4, 5]);
});

test('honours the 1..96 boundary exactly', () => {
  assert.equal(parseTimeBlocks(String(MIN_BLOCK)).ok, true);
  assert.equal(parseTimeBlocks(String(MAX_BLOCK)).ok, true);
  assert.equal(parseTimeBlocks('0').ok, false);
  assert.equal(parseTimeBlocks(String(MAX_BLOCK + 1)).ok, false);
});

test('rejects an empty entry', () => {
  assert.equal(parseTimeBlocks('').ok, false);
  assert.equal(parseTimeBlocks('   ').ok, false);
  assert.equal(parseTimeBlocks(null).ok, false);
});

test('rejects illegal characters', () => {
  assert.equal(parseTimeBlocks('4;5').ok, false);
  assert.equal(parseTimeBlocks('1 to 4').ok, false);
});

test('rejects a backwards range with a helpful message', () => {
  const r = parseTimeBlocks('5-1');
  assert.equal(r.ok, false);
  assert.match(r.error, /backwards/);
});

test('rejects a malformed range', () => {
  assert.equal(parseTimeBlocks('1-').ok, false);
  assert.equal(parseTimeBlocks('1-2-3').ok, false);
});

test('condense collapses runs and keeps singletons', () => {
  assert.equal(condense([1, 2, 3, 7]), '1-3, 7');
  assert.equal(condense([1, 2, 3, 4]), '1-4');
  assert.equal(condense([5]), '5');
  assert.equal(condense([1, 3, 5]), '1, 3, 5');
});
