/**
 * Unit tests for utils/pagination.js — safe LIMIT/OFFSET bounds.
 *
 * The point of the module is that no caller-supplied value can reach SQL as a
 * NaN, a negative, or an unbounded number, so these tests exercise exactly those.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampPagination, DEFAULT_LIMIT, MAX_LIMIT } = require('../../utils/pagination');

test('sensible values pass through', () => {
  assert.deepEqual(clampPagination({ page: 2, limit: 25 }), { page: 2, limit: 25, offset: 25 });
});

test('missing values fall back to the defaults', () => {
  assert.deepEqual(clampPagination({}), { page: 1, limit: DEFAULT_LIMIT, offset: 0 });
});

test('string query values (how Express delivers them) are parsed', () => {
  assert.deepEqual(clampPagination({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 });
});

test('a non-numeric limit or page falls back rather than becoming NaN', () => {
  const r = clampPagination({ page: 'abc', limit: 'xyz' });
  assert.equal(r.page, 1);
  assert.equal(r.limit, DEFAULT_LIMIT);
  assert.equal(Number.isFinite(r.offset), true);
});

test('an over-large limit is capped', () => {
  assert.equal(clampPagination({ limit: 100000 }).limit, MAX_LIMIT);
});

test('zero and negative values are floored to safe bounds', () => {
  assert.equal(clampPagination({ page: 0 }).page, 1);
  assert.equal(clampPagination({ page: -5 }).page, 1);
  assert.equal(clampPagination({ limit: 0 }).limit, 1);
  assert.equal(clampPagination({ limit: -20 }).limit, 1);
  assert.ok(clampPagination({ page: -5, limit: -20 }).offset >= 0);
});

test('a custom cap is honoured', () => {
  assert.equal(clampPagination({ limit: 500 }, { maxLimit: 100 }).limit, 100);
});
