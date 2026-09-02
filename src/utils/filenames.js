/**
 * filenames.js — Recover the name a user actually uploaded.
 *
 * Mirrors server/utils/filenames.js.
 *
 * Uploads are stored as `<timestamp>-<random>-<original name>` so two people
 * uploading "summary.xlsx" do not collide. Displaying that raw is unfriendly,
 * and stripping only up to the first dash — as the portal used to — leaves the
 * random number stuck to the front:
 *
 *   1780000179519-200000018-NetSchdReportSummary.xlsx
 *   → was shown as  200000018-NetSchdReportSummary.xlsx
 *   → now shown as  NetSchdReportSummary.xlsx
 *
 * Names that do not carry the prefix are returned untouched, so anything
 * stored before this convention still displays sensibly.
 */

const STORED_PREFIX = /^\d+-\d+-/;

export function originalFilename(stored) {
  const name = String(stored || '');
  if (STORED_PREFIX.test(name)) return name.replace(STORED_PREFIX, '');
  // Legacy fall-back: a single "<something>-name" prefix.
  const dash = name.indexOf('-');
  return dash !== -1 ? name.slice(dash + 1) : name;
}

/**
 * Is this the Net Schedule Report Summary a station downloads from WBES?
 *
 * Tolerant of the variable middle — one segment or two — before the revision:
 *   NetSchdReportSummary@AAPL_BKN2@rev(121)@01-09-2026@..._18-03-54.xlsx
 *   NetSchdReportSummary@DADRI@DADRI_CRF@rev(109)@02-09-2026@..._15-10-01.xlsx
 *
 * Mirror of isNetScheduleSummary in server/utils/filenames.js.
 */
const NET_SCHEDULE_SUMMARY = /^NetSchdReportSummary@.+@rev\(\d+\)@.*\.xls[x]?$/i;

export function isNetScheduleSummary(name) {
  return NET_SCHEDULE_SUMMARY.test(String(name || '').trim());
}
