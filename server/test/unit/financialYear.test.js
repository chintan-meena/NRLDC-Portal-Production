/**
 * Unit tests for utils/financialYear.js — Indian FY week arithmetic.
 *
 * The anchor case is the one spelled out in the module's own header:
 * 1 Apr 2026 is a Wednesday, so FY2026-27 Week 1 is Mon 30 Mar – Sun 5 Apr.
 * These tests pin that boundary because it is exactly where an off-by-one or a
 * UTC slip would show up.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fyWeekOneStart, weeksInFY, fyWeekRange, fyWeekForDate, fyForDate, fyLabel, toISODate,
} = require('../../utils/financialYear');

test('Week 1 begins on the Monday of the week containing 1 April', () => {
  assert.equal(toISODate(fyWeekOneStart(2026)), '2026-03-30');
});

test('Week 1 spans Mon 30 Mar to Sun 5 Apr for FY2026-27', () => {
  const w = fyWeekRange(2026, 1);
  assert.equal(w.start, '2026-03-30');
  assert.equal(w.end, '2026-04-05');
  assert.equal(w.week, 1);
});

test('a late-March date belongs to the *next* financial year', () => {
  const f = fyWeekForDate('2026-03-30');
  assert.equal(f.fyStartYear, 2026);
  assert.equal(f.week, 1);
});

test('the day before Week 1 belongs to the previous FY, keeping years contiguous', () => {
  assert.equal(fyForDate('2026-03-29'), 2025);
  assert.equal(fyForDate('2026-03-30'), 2026);
});

test('a financial year has 52 or 53 whole weeks', () => {
  for (const y of [2023, 2024, 2025, 2026, 2027]) {
    const n = weeksInFY(y);
    assert.ok(n === 52 || n === 53, `FY${y} has ${n} weeks`);
  }
});

test('an out-of-range week number returns null rather than inventing days', () => {
  assert.equal(fyWeekRange(2026, 0), null);
  assert.equal(fyWeekRange(2026, weeksInFY(2026) + 1), null);
  assert.equal(fyWeekRange(2026, 'x'), null);
});

test('the FY label is the two-year form', () => {
  assert.equal(fyLabel(2026), '2026-27');
  assert.equal(fyLabel(1999), '1999-00');
});

test('an unparseable date returns null', () => {
  assert.equal(fyWeekForDate('not-a-date'), null);
  assert.equal(fyForDate(''), null);
});
