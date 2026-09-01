/**
 * utils/filingWindow.js — When a discrepancy may be filed, and as what.
 *
 * Three gates, in order of severity:
 *
 *   1. The calendar cutoff. A correction period closes for good on a fixed day
 *      of the following month — the 15th by default. This is absolute: nothing
 *      may be filed for that period afterwards, whatever the day count says.
 *   2. The day limit. How many days after the correction date a filing is
 *      still accepted at all (maxDays, extended to extendedMaxDays).
 *   3. The category restriction. Inside the first window every category is
 *      available; in the extended window only a named few are.
 *
 * All three are settings, and settings are per region — so one despatch centre
 * can run a tighter window than another without touching code.
 *
 * Enforced on the server. The form greys out what it can, but the form is not
 * what decides.
 */

const { RESTRICTED_WINDOW_CATEGORIES } = require('./discrepancyTypes');

/**
 * The last calendar day a filing for `correctionDate` is accepted.
 *
 * `cutoffDay` is a day of the *following* month: 15 means "the 15th of the
 * month after the one the correction falls in". A day past the end of a short
 * month clamps to its last day rather than rolling into the next.
 */
function cutoffDateFor(correctionDate, cutoffDay) {
  const d = parseDate(correctionDate);
  if (!d) return null;

  const year = d.getFullYear();
  const month = d.getMonth() + 1;              // the following month
  const lastDayOfNextMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(Math.max(1, cutoffDay), lastDayOfNextMonth);

  const cutoff = new Date(year, month, day);
  cutoff.setHours(23, 59, 59, 999);            // the whole of that day counts
  return cutoff;
}

/** Parse 'YYYY-MM-DD' as a local calendar day. */
function parseDate(value) {
  if (value instanceof Date) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Which categories may be selected for a filing this old.
 *
 * Returns { all: true } inside the full window, or { all: false, allowed: [...] }
 * in the restricted one.
 */
function categoriesFor(daysOld, maxDays) {
  if (daysOld <= maxDays) return { all: true, allowed: null };
  return { all: false, allowed: RESTRICTED_WINDOW_CATEGORIES };
}

/**
 * The whole decision, in one call.
 *
 * @returns {{ok: true, restricted: boolean}} or {{ok: false, error: string}}
 */
function checkFilingWindow({ correctionDate, daysOld, selectedTypes, settings, now = new Date() }) {
  const maxDays = num(settings.maxDays, 5);
  const extendedMaxDays = num(settings.extendedMaxDays, 15);
  const allowExtended = String(settings.allowExtended) === 'true';
  const cutoffDay = num(settings.postFactoCutoffDay, 15);

  if (daysOld < 0) {
    return { ok: false, error: 'The correction date cannot be in the future.' };
  }

  // 1. The calendar cutoff closes the period regardless of the day count.
  const cutoff = cutoffDateFor(correctionDate, cutoffDay);
  if (cutoff && now > cutoff) {
    return {
      ok: false,
      error: `Filing for ${monthName(correctionDate)} closed on ${cutoff.getDate()} ${monthName(cutoff)} `
           + `(the ${ordinal(cutoffDay)} of the following month). That period can no longer be corrected.`,
    };
  }

  // 2. The day limit.
  const limit = allowExtended ? extendedMaxDays : maxDays;
  if (daysOld > limit) {
    return { ok: false, error: `Cannot file discrepancy older than ${limit} days.` };
  }

  // 3. Which categories this window admits.
  const cats = categoriesFor(daysOld, maxDays);
  if (!cats.all) {
    const chosen = extractTypes(selectedTypes);
    const disallowed = chosen.filter(c => !cats.allowed.includes(c));
    if (chosen.length === 0) {
      return { ok: false, error: `Choose a discrepancy type. After ${maxDays} days only ${list(cats.allowed)} may be filed.` };
    }
    if (disallowed.length > 0) {
      return {
        ok: false,
        error: `This filing is ${daysOld} days old. Beyond ${maxDays} days only ${list(cats.allowed)} may be filed — `
             + `${list(disallowed)} ${disallowed.length === 1 ? 'is' : 'are'} no longer available for this date.`,
      };
    }
  }

  return { ok: true, restricted: !cats.all };
}

/** The stored tag string back into plain category names. */
function extractTypes(stored) {
  if (Array.isArray(stored)) return stored;
  return [...String(stored || '').matchAll(/<([^>]+)>/g)]
    .map(m => m[1].trim())
    .filter(Boolean);
}

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (a) => a.map(x => `"${x}"`).join(' or ');
function ordinal(n) {
  // 11th, 12th and 13th are the exceptions; otherwise the last digit decides.
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}
const monthName = (d) => {
  const x = d instanceof Date ? d : parseDate(d);
  return x ? x.toLocaleString('en-GB', { month: 'long', year: 'numeric' }) : '';
};

module.exports = { checkFilingWindow, cutoffDateFor, categoriesFor, extractTypes };
