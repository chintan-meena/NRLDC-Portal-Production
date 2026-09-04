/**
 * Unit tests for utils/filingWindow.js — the three gates that decide when a
 * discrepancy may be filed and as what.
 *
 * `now` is pinned in every case so the calendar cutoff is deterministic and the
 * suite does not drift with the wall clock.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkFilingWindow, cutoffDateFor } = require('../../utils/filingWindow');
const { RESTRICTED_WINDOW_CATEGORIES } = require('../../utils/discrepancyTypes');

const NOW = new Date(2026, 5, 10); // 10 Jun 2026, local

const SETTINGS = {
  maxDays: '5',
  extendedMaxDays: '15',
  allowExtended: 'true',
  postFactoCutoffDay: '15',
};

test('a fresh filing inside maxDays is accepted and unrestricted', () => {
  const r = checkFilingWindow({
    correctionDate: '2026-06-08', daysOld: 2, selectedTypes: [], settings: SETTINGS, now: NOW,
  });
  assert.equal(r.ok, true);
  assert.equal(r.restricted, false);
});

test('a future correction date is refused', () => {
  const r = checkFilingWindow({
    correctionDate: '2026-06-12', daysOld: -2, selectedTypes: [], settings: SETTINGS, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /future/i);
});

test('the calendar cutoff closes the period regardless of the day count', () => {
  // April 2026 closed on 15 May 2026; by 10 Jun it can no longer be corrected.
  const r = checkFilingWindow({
    correctionDate: '2026-04-01', daysOld: 70, selectedTypes: [], settings: SETTINGS, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /closed|can no longer/i);
});

test('beyond maxDays but inside the extended window only restricted types are allowed', () => {
  const allowed = RESTRICTED_WINDOW_CATEGORIES[0];
  const disallowed = 'WBES Outage'; // a real type that is NOT in the restricted set
  assert.equal(RESTRICTED_WINDOW_CATEGORIES.includes(disallowed), false);

  const good = checkFilingWindow({
    correctionDate: '2026-05-31', daysOld: 10, selectedTypes: [allowed], settings: SETTINGS, now: NOW,
  });
  assert.equal(good.ok, true);
  assert.equal(good.restricted, true);

  const bad = checkFilingWindow({
    correctionDate: '2026-05-31', daysOld: 10, selectedTypes: [disallowed], settings: SETTINGS, now: NOW,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /no longer available|only/i);
});

test('beyond the extended window nothing is accepted', () => {
  const r = checkFilingWindow({
    correctionDate: '2026-05-20', daysOld: 21, selectedTypes: [RESTRICTED_WINDOW_CATEGORIES[0]], settings: SETTINGS, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /older than/i);
});

test('when the extended window is off, maxDays is the hard limit', () => {
  const r = checkFilingWindow({
    correctionDate: '2026-06-01', daysOld: 9,
    selectedTypes: [RESTRICTED_WINDOW_CATEGORIES[0]],
    settings: { ...SETTINGS, allowExtended: 'false' }, now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /older than 5 days/i);
});

test('cutoffDateFor clamps a cutoff day past a short month to its last day', () => {
  // Correction in January → cutoff is in February; day 31 clamps to 28/29.
  const cutoff = cutoffDateFor('2027-01-10', 31);
  assert.equal(cutoff.getMonth(), 1);          // February
  assert.ok(cutoff.getDate() <= 29);
});
