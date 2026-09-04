/**
 * Unit tests for utils/uploadSweep.js — which files are safe to delete.
 *
 * The rule: delete only what is unreferenced AND older than the cutoff. The
 * dangerous failure is deleting a file a user is about to attach, so the grace
 * cutoff is tested explicitly.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectOrphans } = require('../../utils/uploadSweep');

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const cutoff = NOW - 5 * DAY; // 5-day grace

test('an old, unreferenced file is an orphan', () => {
  const files = [{ name: 'old-orphan.xlsx', mtimeMs: NOW - 6 * DAY }];
  assert.deepEqual(selectOrphans(files, new Set(), cutoff), ['old-orphan.xlsx']);
});

test('a referenced file is never an orphan, however old', () => {
  const files = [{ name: 'in-use.xlsx', mtimeMs: NOW - 100 * DAY }];
  assert.deepEqual(selectOrphans(files, new Set(['in-use.xlsx']), cutoff), []);
});

test('a recent unreferenced file is protected by the grace period', () => {
  const files = [{ name: 'just-uploaded.xlsx', mtimeMs: NOW - 1 * DAY }];
  assert.deepEqual(selectOrphans(files, new Set(), cutoff), []);
});

test('a file exactly at the cutoff is kept (strictly older is required)', () => {
  const files = [{ name: 'edge.xlsx', mtimeMs: cutoff }];
  assert.deepEqual(selectOrphans(files, new Set(), cutoff), []);
});

test('a mixed directory selects only the true orphans', () => {
  const files = [
    { name: 'keep-referenced.xlsx', mtimeMs: NOW - 30 * DAY },
    { name: 'keep-recent.xlsx', mtimeMs: NOW - 1 * DAY },
    { name: 'delete-me.pdf', mtimeMs: NOW - 10 * DAY },
    { name: 'delete-me-too.csv', mtimeMs: NOW - 6 * DAY },
  ];
  const referenced = new Set(['keep-referenced.xlsx']);
  assert.deepEqual(selectOrphans(files, referenced, cutoff).sort(), ['delete-me-too.csv', 'delete-me.pdf']);
});
