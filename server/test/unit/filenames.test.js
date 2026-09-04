/**
 * Unit tests for utils/filenames.js — stored-name recovery and the Net Schedule
 * Report Summary check the filing gate depends on.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { originalFilename, isNetScheduleSummary } = require('../../utils/filenames');

test('strips the <timestamp>-<random>- storage prefix', () => {
  assert.equal(
    originalFilename('1780000179519-200000018-NetSchdReportSummary.xlsx'),
    'NetSchdReportSummary.xlsx'
  );
});

test('keeps @ and () in the recovered name (the Net Schedule case)', () => {
  assert.equal(
    originalFilename('1788434858605-44979134-NetSchdReportSummary@DADRI@DADRI_CRF@rev(137)@02-09-2026.xlsx'),
    'NetSchdReportSummary@DADRI@DADRI_CRF@rev(137)@02-09-2026.xlsx'
  );
});

test('falls back to a single-dash legacy prefix', () => {
  assert.equal(originalFilename('foo-bar.xlsx'), 'bar.xlsx');
});

test('returns a prefix-free name untouched', () => {
  assert.equal(originalFilename('plain.xlsx'), 'plain.xlsx');
  assert.equal(originalFilename(''), '');
});

test('recognises a real Net Schedule Summary name (one or two middle segments)', () => {
  assert.equal(isNetScheduleSummary('NetSchdReportSummary@AAPL_BKN2@rev(121)@01-09-2026@x_18-03-54.xlsx'), true);
  assert.equal(isNetScheduleSummary('NetSchdReportSummary@DADRI@DADRI_CRF@rev(109)@02-09-2026@x_15-10-01.xlsx'), true);
});

test('accepts .xls as well as .xlsx', () => {
  assert.equal(isNetScheduleSummary('NetSchdReportSummary@X@rev(1)@d.xls'), true);
});

test('rejects a non-Net-Schedule file', () => {
  assert.equal(isNetScheduleSummary('random_supporting_notes.pdf'), false);
  assert.equal(isNetScheduleSummary('NetSchdReportBreakup@X@rev(1)@d.xlsx'), false);
  assert.equal(isNetScheduleSummary('summary.xlsx'), false);
  assert.equal(isNetScheduleSummary(''), false);
});
