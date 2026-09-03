/**
 * utils/discrepancyTypes.js — The one list of discrepancy types.
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
 * Keep this in sync with src/utils/discrepancyTypes.js.
 */

const DISCREPANCY_TYPES = [
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
/**
 * Categories added for the 2026 filing rules. They are *additional* to the
 * list above, not a replacement: 1,000 existing records carry the older tags,
 * and dropping those would leave historical filings unfilterable.
 *
 * Whether the older eight should be retired is a stakeholder decision — see the
 * note in the README. Retiring one only means removing it from this list;
 * stored records keep their tags either way, and typeMatchPattern still finds
 * them.
 */
const FILING_CATEGORIES_2026 = [
  'Type or contract missing',
  'Requisition Value incorrect (REMC)',
  'AVC correction',
  'Post facto revisions',
  'Schedule visible in REMC but not reflecting in WBES',
  'NOC breach issue - needs correction',
  'TRAS not applied',
];

/**
 * The category the day 6-15 restricted window still admits.
 *
 * Kept as a named list rather than a string comparison so the restricted set
 * can grow without hunting for the check. See the filing-window rules in
 * server/routes/discrepancies.js.
 */
const RESTRICTED_WINDOW_CATEGORIES = ['Post facto revisions'];

const MISC_TYPE = 'Miscellaneous';
const MISC_PREFIX = '<Misc';

/** Everything a filter dropdown should offer. */
const ALL_FILING_TYPES = [...DISCREPANCY_TYPES, ...FILING_CATEGORIES_2026];
const FILTERABLE_TYPES = [...ALL_FILING_TYPES, MISC_TYPE];

/**
 * The subset of types each kind of filer is offered when raising a discrepancy.
 *
 * Every entry here is one of the canonical labels above — this narrows what a
 * given category sees, it never invents a new tag, so historical records and the
 * filter lists (which still use ALL_FILING_TYPES) keep resolving every tag.
 * Keyed by the filer's energy_category; a QCA files for RE plants and so is
 * mapped to 'RE' by the caller. Traders and States share a starter set that can
 * be widened later. Kept in sync with src/utils/discrepancyTypes.js.
 */
const FILING_TYPES_BY_CATEGORY = {
  ISGS: [
    'Violation due to SCUC',
    'Violation due to SCED',
    'Violation due to Shortfall',
    'Violation due to Emergency',
    'Bilateral Schedule Discrepancy under GNA',
    'Real-Time Instructions Received from NLDC',
    'WBES Outage',
    'Post facto revisions',
  ],
  RE: [
    'Bilateral Schedule Discrepancy under GNA',
    'Real-Time Instructions Received from NLDC',
    'Schedule Loss Discrepancy',
    'WBES Outage',
    'Type or contract missing',
    'Requisition Value incorrect (REMC)',
    'AVC correction',
    'Post facto revisions',
    'Schedule visible in REMC but not reflecting in WBES',
    'NOC breach issue - needs correction',
    'TRAS not applied',
  ],
  Traders: [
    'Bilateral Schedule Discrepancy under GNA',
    'Post facto revisions',
  ],
  States: [
    'Bilateral Schedule Discrepancy under GNA',
    'Post facto revisions',
  ],
};

/**
 * The filing types a given category is offered, always ending in Miscellaneous.
 * Falls back to the full list for any category not in the map.
 */
function filingTypesFor(energyCategory) {
  const base = FILING_TYPES_BY_CATEGORY[energyCategory] || ALL_FILING_TYPES;
  return [...base, MISC_TYPE];
}

/**
 * The SQL pattern that matches one type inside the stored tag string.
 * The angle brackets matter: without them "Violation due to SCED" would also
 * match a remark that merely mentions it.
 */
function typeMatchPattern(type) {
  return type === MISC_TYPE ? `%${MISC_PREFIX}%` : `%<${type}>%`;
}

module.exports = {
  FILING_CATEGORIES_2026,
  RESTRICTED_WINDOW_CATEGORIES,
  FILING_TYPES_BY_CATEGORY, filingTypesFor,
  ALL_FILING_TYPES, DISCREPANCY_TYPES, MISC_TYPE, MISC_PREFIX, FILTERABLE_TYPES, typeMatchPattern };
