/**
 * timeBlocks.js — Parsing and validation for the 15-minute block field.
 *
 * Mirrors server/utils/timeBlocks.js so the form can flag a bad entry as it is
 * typed. The server validates independently — this is convenience only. Keep
 * the two in sync.
 *
 * A scheduling day has 96 blocks of 15 minutes (block 1 = 00:00–00:15,
 * block 96 = 23:45–24:00). Users type them as a list, a range, or a mix:
 *
 *     4,5,84            individual blocks
 *     1-4               a range
 *     1-4, 20, 55-60    both together
 *
 * Only digits, commas, hyphens and spaces are accepted. Hyphens have to be
 * allowed because ranges are how operators normally write a long stretch of
 * blocks, and the Excel export already expands them.
 */

export const MIN_BLOCK = 1;
export const MAX_BLOCK = 96;

/** Characters a valid entry may contain — anything else is a typo or paste error. */
const ALLOWED_CHARS = /^[0-9,\-\s]+$/;

/**
 * Validate and normalise a time-block string.
 *
 * Returns { ok: true, blocks: [numbers], normalised: '1-4, 20' }
 *      or { ok: false, error: 'reason to show the user' }.
 */
export function parseTimeBlocks(input) {
  const raw = String(input == null ? '' : input).trim();

  if (!raw) {
    return { ok: false, error: 'Enter the affected time blocks, for example 4,5,84 or 1-4.' };
  }
  if (!ALLOWED_CHARS.test(raw)) {
    return { ok: false, error: 'Time blocks may contain only numbers, commas and hyphens — for example 4,5,84 or 1-4.' };
  }

  const blocks = new Set();

  for (const part of raw.split(',')) {
    const piece = part.trim();
    if (!piece) continue;                       // tolerate "4,,5" and a trailing comma

    const range = piece.split('-').map(x => x.trim());

    if (range.length === 1) {
      const n = Number(range[0]);
      if (!Number.isInteger(n)) {
        return { ok: false, error: `"${piece}" is not a valid block number.` };
      }
      if (n < MIN_BLOCK || n > MAX_BLOCK) {
        return { ok: false, error: `Block ${n} is out of range — blocks run from ${MIN_BLOCK} to ${MAX_BLOCK}.` };
      }
      blocks.add(n);
      continue;
    }

    if (range.length !== 2 || range[0] === '' || range[1] === '') {
      return { ok: false, error: `"${piece}" is not a valid range. Write a range as 1-4.` };
    }

    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return { ok: false, error: `"${piece}" is not a valid range. Write a range as 1-4.` };
    }
    if (start < MIN_BLOCK || start > MAX_BLOCK || end < MIN_BLOCK || end > MAX_BLOCK) {
      return { ok: false, error: `"${piece}" is out of range — blocks run from ${MIN_BLOCK} to ${MAX_BLOCK}.` };
    }
    if (start > end) {
      return { ok: false, error: `"${piece}" runs backwards — write it as ${end}-${start}.` };
    }
    for (let i = start; i <= end; i++) blocks.add(i);
  }

  if (blocks.size === 0) {
    return { ok: false, error: 'Enter at least one time block, for example 4,5,84 or 1-4.' };
  }

  const sorted = [...blocks].sort((a, b) => a - b);
  return { ok: true, blocks: sorted, normalised: condense(sorted) };
}

/** Collapse a sorted block list back into compact text: [1,2,3,7] → "1-3, 7". */
export function condense(sorted) {
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  return parts.join(', ');
}
