/**
 * discrepancyTypes.js — The one list of discrepancy types.
 *
 * Mirrors server/utils/discrepancyTypes.js.
 *
 * There were three different lists before this: what the filing form offered,
 * what the admin filter offered, and what the user filter offered. They did
 * not agree, so a filter could name a type nothing could ever be filed under.
 *
 * A request stores its types as concatenated tags, e.g.
 *
 *     <WBES Outage>
 *     <Violation due to SCED><Schedule Loss Discrepancy>
 *     <Misc: transformer differential relay operated>
 *
 * Keep this in sync with the server copy.
 */

export const DISCREPANCY_TYPES = [
  'Violation due to SCED',
  'Violation due to SCUC',
  'Violation due to Shortfall',
  'Violation due to Emergency',
  'Bilateral Schedule Discrepancy under GNA',
  'Real-Time Instructions Received from NLDC',
  'Schedule Loss Discrepancy',
  'WBES Outage',
];

/**
 * Free-text option. Stored as "<Misc: whatever the user typed>" when the user
 * supplied text, and "<Miscellaneous>" when they did not, so the shared prefix
 * is what a filter has to match.
 */
export const MISC_TYPE = 'Miscellaneous';
export const MISC_PREFIX = '<Misc';

/** Everything a filter dropdown should offer. */
export const FILTERABLE_TYPES = [...DISCREPANCY_TYPES, MISC_TYPE];

/**
 * The SQL pattern that matches one type inside the stored tag string.
 * The angle brackets matter: without them "Violation due to SCED" would also
 * match a remark that merely mentions it.
 */
export function typeMatchPattern(type) {
  return type === MISC_TYPE ? `%${MISC_PREFIX}%` : `%<${type}>%`;
}
