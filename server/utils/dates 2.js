/**
 * utils/dates.js — Date formatting for PostgreSQL DATE columns.
 *
 * node-postgres returns a DATE as a JS Date at *local* midnight. Calling
 * .toISOString() on that converts to UTC, which rolls the calendar day
 * backwards at any positive offset — in IST (UTC+5:30) a schedule dated
 * 28 Aug is reported as 27 Aug. These helpers read the local components
 * instead, so the calendar day survives the round trip.
 */

/** Matches a bare calendar date with no time or zone attached. */
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a value as YYYY-MM-DD in local time.
 *
 * DATE columns now arrive as plain 'YYYY-MM-DD' strings (see db.js), and those
 * are returned untouched — passing them through `new Date()` would parse them
 * as UTC midnight and shift the day at negative offsets.
 */
function toDateString(value) {
  if (!value) return '';
  if (typeof value === 'string' && PLAIN_DATE.test(value.trim())) {
    return value.trim();
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse a value into a Date at LOCAL midnight.
 *
 * `new Date('2026-12-31')` is midnight UTC, which is the previous evening in
 * the Americas and the same morning in India — either way the wrong instant
 * for day arithmetic. Splitting the parts avoids that entirely.
 */
function toLocalDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const str = String(value || '').trim();
  const m = str.match(PLAIN_DATE) || str.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Whole days between a calendar date and today, in local time.
 * Positive when the date is in the past, negative when it is in the future.
 */
function daysSince(value) {
  const target = toLocalDate(value);
  if (!target) return NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - target) / (1000 * 60 * 60 * 24));
}

/** Return YYYY-MM-DD for the day before the given date, in local time. */
function previousDayString(value) {
  const d = toLocalDate(value);
  if (!d) return '';
  d.setDate(d.getDate() - 1);
  return toDateString(d);
}

module.exports = { toDateString, previousDayString, toLocalDate, daysSince };
