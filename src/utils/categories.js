/**
 * utils/categories.js — What each energy category is called on screen.
 *
 * **Display only.** The stored values are still 'ISGS', 'RE' and 'States':
 * every API payload, database column, CSV export and CHECK constraint uses
 * those, and nothing here changes them. This file exists so the words a user
 * reads can be changed in one place without touching any of that.
 *
 * Under the IEGC both inter-state generating stations and renewable generators
 * are regional entities. ISGS keeps the plain "Regional Entity" label; RE is
 * shown as "Renewable (RE)" rather than "Regional Entity (RE)" so the two are
 * not two labels that differ only by a suffix — that was easy to misread in a
 * dense table. The "(RE)" token is kept so the stored value is still legible.
 */

/** Stored value → what the user sees. */
export const CATEGORY_LABELS = {
  ISGS: 'Regional Entity',
  RE: 'Renewable (RE)',
  States: 'States',
  Traders: 'Traders',
  QCA: 'QCA',
};

/**
 * A shorter form, for table cells and badges where the full label would wrap.
 * Still unambiguous — the distinguishing token is kept.
 */
export const CATEGORY_SHORT = {
  ISGS: 'Reg. Entity',
  RE: 'Renewable',
  States: 'States',
  Traders: 'Traders',
  QCA: 'QCA',
};

/** The label for a stored category, falling back to the value itself. */
export function categoryLabel(value) {
  return CATEGORY_LABELS[value] ?? value ?? '';
}

/** The compact label, for badges and narrow columns. */
export function categoryShort(value) {
  return CATEGORY_SHORT[value] ?? value ?? '';
}

/**
 * The filing categories, in the order they should be offered.
 *
 * Traders sit alongside the others rather than under Regional Entity: a trader
 * is not a generator and despatches nothing. What they file is a discrepancy
 * in a *trade*, which is why theirs is the only category whose filing form
 * asks who bought and who sold — see utils/trade.js.
 */
export const CATEGORIES = ['ISGS', 'RE', 'States', 'Traders'];
