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
