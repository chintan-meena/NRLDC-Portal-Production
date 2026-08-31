/**
 * utils/financialYear.js — Indian financial-year weeks.
 *
 * The financial year runs 1 April → 31 March. A week runs Monday → Sunday.
 * **Week 1 of FY(Y) is the Mon–Sun week that contains 1 April of year Y.**
 *
 * Because 1 April is rarely a Monday, Week 1 usually reaches back into March.
 * That is correct, not an off-by-one:
 *
 *   1 Apr 2026 is a Wednesday, so FY2026-27 Week 1 is Mon 30 Mar – Sun 5 Apr.
 *
 * The weeks tile the year exactly. The last week of one FY ends the day before
 * Week 1 of the next begins — FY2025-26 Week 52 ends Sun 29 Mar 2026, and
 * FY2026-27 Week 1 starts Mon 30 Mar 2026 — so no day belongs to two financial
 * years and none belongs to neither. That is what makes the count 52 or 53
 * depending on where the Mondays fall, rather than always 52.
 *
 * Everything here works in local calendar days and returns 'YYYY-MM-DD'
 * strings. Nothing goes near UTC: the portal already had a bug where DATE
 * columns shifted a day through toISOString(), and this would be a fresh way
 * to reintroduce it.
 *
 * Keep in sync with the server copy in server/utils/financialYear.js.
 */

const FY_START_MONTH = 3;   // April, zero-based
const FY_START_DAY = 1;

const pad = (n) => String(n).padStart(2, '0');

/** A Date at local midnight, free of any time component. */
export function localDate(year, month, day) {
  const d = new Date(year, month, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 'YYYY-MM-DD' from a Date, read in local time. */
export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse 'YYYY-MM-DD' as a local calendar day, never as UTC. */
export function fromISODate(value) {
  if (value instanceof Date) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  return localDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The Monday of the week containing `d`. Sunday belongs to the week before. */
export function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const daysSinceMonday = (x.getDay() + 6) % 7;   // Mon=0 … Sun=6
  x.setDate(x.getDate() - daysSinceMonday);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** The Monday that begins Week 1 of FY(fyStartYear). */
export function fyWeekOneStart(fyStartYear) {
  return mondayOf(localDate(fyStartYear, FY_START_MONTH, FY_START_DAY));
}

/**
 * How many weeks this financial year has — 52 or 53.
 *
 * Derived rather than assumed: it is exactly the number of whole weeks between
 * this year's Week 1 Monday and the next year's, which is what keeps the years
 * contiguous.
 */
export function weeksInFY(fyStartYear) {
  const thisYear = fyWeekOneStart(fyStartYear);
  const nextYear = fyWeekOneStart(fyStartYear + 1);
  return Math.round((nextYear - thisYear) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * The date range of one FY week.
 *
 * Returns { start, end, label } as 'YYYY-MM-DD', or null when the week number
 * does not exist in that year — asking for Week 53 of a 52-week year is a
 * question with no answer, and inventing one would silently return the wrong
 * seven days.
 */
export function fyWeekRange(fyStartYear, week) {
  const total = weeksInFY(fyStartYear);
  const n = Number(week);
  if (!Number.isInteger(n) || n < 1 || n > total) return null;

  const start = addDays(fyWeekOneStart(fyStartYear), (n - 1) * 7);
  const end = addDays(start, 6);
  return {
    start: toISODate(start),
    end: toISODate(end),
    week: n,
    fyStartYear,
    label: `Week ${n}, FY ${fyLabel(fyStartYear)}`,
  };
}

/**
 * Which FY week a given date falls in.
 *
 * A date in late March may belong to the *next* financial year, because Week 1
 * reaches back — 30 Mar 2026 is FY2026-27 Week 1, not FY2025-26 Week 53. The
 * comparison against the next year's Week 1 start is what gets that right.
 */
export function fyWeekForDate(value) {
  const d = fromISODate(value);
  if (!d) return null;

  // Start from the calendar year, then step to whichever FY actually contains
  // this date — it can be the year before or after, near the boundary.
  let fyStartYear = d.getFullYear();
  if (d < fyWeekOneStart(fyStartYear)) fyStartYear -= 1;
  if (d >= fyWeekOneStart(fyStartYear + 1)) fyStartYear += 1;

  const weekIndex = Math.floor((mondayOf(d) - fyWeekOneStart(fyStartYear)) / (7 * 24 * 60 * 60 * 1000));
  return { fyStartYear, week: weekIndex + 1, label: `Week ${weekIndex + 1}, FY ${fyLabel(fyStartYear)}` };
}

/** '2026-27' for fyStartYear 2026. */
export function fyLabel(fyStartYear) {
  return `${fyStartYear}-${pad((fyStartYear + 1) % 100)}`;
}

/** The financial year a date sits in, without the week. */
export function fyForDate(value) {
  const found = fyWeekForDate(value);
  return found ? found.fyStartYear : null;
}
