/**
 * format.js — Display formatting shared by the dashboards.
 *
 * These helpers were previously defined identically in both AdminDashboard and
 * UserDashboard; keeping one copy means the two screens cannot drift apart.
 */

/** Format an ISO date (or YYYY-MM-DD string) as DD-MM-YYYY. */
export function formatDateDMY(dateStr) {
  if (!dateStr) return '';
  const cleanDate = String(dateStr).slice(0, 10);
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

/** Format a timestamp as DD-MM-YYYY HH:MM in the viewer's local time. */
export function formatDateDMYHM(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sort weight for a status: Pending first, then Returned, Resolved, Rejected. */
export function getStatusPriority(status) {
  const s = status ? status.toLowerCase() : '';
  if (s === 'pending') return 1;
  if (s === 'returned') return 2;
  if (s === 'resolved') return 3;
  if (s === 'rejected') return 4;
  return 5;
}

/** Today as YYYY-MM-DD in local time (never UTC — see server/utils/dates.js). */
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Shift a YYYY-MM-DD string by a number of days, staying in local time.
 * `new Date('2026-08-29')` parses as UTC midnight, so naive arithmetic plus
 * toISOString() can land on the wrong calendar day; this parses the parts
 * explicitly instead.
 */
export function shiftDaysISO(isoDate, delta) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** N days ago as YYYY-MM-DD in local time. */
export function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Now, as the `YYYY-MM-DDTHH:MM` value a <input type="datetime-local"> expects.
 * The offset subtraction keeps it in the viewer's local time — used for `max`
 * on inputs that must not accept a future moment.
 */
export function nowDatetimeLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
