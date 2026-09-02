/**
 * utils/trade.js — Traders, and who has to agree before a trade is corrected.
 *
 * Every other filing in this portal belongs to exactly one region: a station
 * raises it, its own RLDC judges it, and no one else ever sees it. A trader's
 * filing is the first thing here that does not fit that shape. Power bought in
 * one region and sold in another produces a discrepancy that two centres have
 * a claim on, and the one that must change a schedule is not the one that can
 * confirm the trade took place.
 *
 * So an inter-regional filing has a step the others do not:
 *
 *      trader files  →  seller's region confirms the trade is theirs
 *                       ├── refuses  → closed, nothing further
 *                       └── consents → buyer's region applies the fix
 *
 * An intra-regional trade — both ends inside one region — has nobody to ask,
 * and takes the ordinary path.
 *
 * The whole state machine is in this file rather than spread through the
 * route, so that "who may do what, and when" can be read in one sitting and
 * tested without a database.
 */

/**
 * The five regional load despatch centres, plus the national one.
 *
 * Fixed by the grid rather than by this portal, and named here because a
 * counterpart region must be nameable whether or not it has an account — the
 * override path exists precisely for regions that are not on the portal, and
 * validating against the `regions` table alone would make them unnameable.
 */
const GRID_REGIONS = ['NRLDC', 'WRLDC', 'SRLDC', 'ERLDC', 'NERLDC', 'NLDC'];

/** The categories that may file at all, in the order they are offered. */
const FILING_CATEGORIES = ['ISGS', 'RE', 'States', 'Traders'];

/** Is this account a trader? */
function isTrader(category) {
  return category === 'Traders';
}

/**
 * Check the routing data on a trader's filing.
 *
 * Returns { ok: true, trade } or { ok: false, error }. `trade` is normalised —
 * upper-cased regions and acronyms — so the caller stores what was checked
 * rather than what was typed.
 *
 * `knownRegions` is the portal's own region list. A region outside it is still
 * accepted if it is one of the grid's, because that is exactly the case the
 * offline consent path is for.
 */
function validateTrade({ buyerRegion, sellerRegion, buyerAcronym, sellerAcronym }, knownRegions = []) {
  const up = (v) => String(v || '').trim().toUpperCase();
  const trade = {
    buyerRegion: up(buyerRegion),
    sellerRegion: up(sellerRegion),
    buyerAcronym: up(buyerAcronym),
    sellerAcronym: up(sellerAcronym),
  };

  if (!trade.buyerRegion || !trade.sellerRegion) {
    return { ok: false, error: 'A trade needs both a buyer region and a seller region.' };
  }
  if (!trade.buyerAcronym || !trade.sellerAcronym) {
    return { ok: false, error: 'A trade needs both the buyer’s and the seller’s WBES acronym.' };
  }

  const permitted = new Set([...knownRegions.map(up), ...GRID_REGIONS]);
  for (const [label, value] of [['buyer', trade.buyerRegion], ['seller', trade.sellerRegion]]) {
    if (!permitted.has(value)) {
      return { ok: false, error: `"${value}" is not a load despatch centre. Choose the ${label}’s region.` };
    }
  }

  // Both ends of a trade being the same plant is a typing mistake, not a
  // trade. Caught here because the consent step would otherwise ask a region
  // to confirm a sale it made to itself.
  if (trade.buyerAcronym === trade.sellerAcronym) {
    return { ok: false, error: 'The buyer and the seller cannot be the same entity.' };
  }

  return { ok: true, trade };
}

/** Does this trade cross a regional boundary? */
function isInterRegional(trade) {
  return !!trade && trade.buyerRegion !== trade.sellerRegion;
}

/**
 * Where a trader's filing starts.
 *
 * Inter-regional work waits on the seller's region. Everything else is Pending
 * from the outset, exactly as a station's filing is.
 */
function openingState(trade) {
  if (!trade || !isInterRegional(trade)) {
    return { status: 'Pending', consentState: null };
  }
  return { status: 'Awaiting Consent', consentState: 'Awaiting' };
}

/**
 * Which regions may see this record.
 *
 * An ordinary filing is visible to its own region and no other. A trade is
 * visible to both ends — that is not a hole in the isolation model but the
 * feature itself: a seller asked to confirm a trade must be able to read what
 * they are confirming. Nothing wider than these three ever applies, and a
 * region absent from the list sees the row no differently than if it did not
 * exist.
 */
function regionsInvolved(row) {
  return [...new Set([row.region, row.buyer_region, row.seller_region].filter(Boolean))];
}

/** May this region act as the seller — the one being asked to consent? */
function isSellerRegion(row, region) {
  return !!row.seller_region && row.seller_region === region;
}

/** May this region act as the buyer — the one that applies the fix? */
function isBuyerRegion(row, region) {
  return !!row.buyer_region && row.buyer_region === region;
}

/**
 * Whether the seller's region can answer for itself in this portal.
 *
 * "Not on the portal" is not a flag anyone sets: it is the observable fact
 * that the region has nobody who could act on the ticket. A region with no
 * administrator cannot consent, cannot refuse, and cannot be waited on — so
 * the offline path is the only way that ticket ever closes.
 */
function sellerCanAnswer(adminCount) {
  return Number(adminCount) > 0;
}

/**
 * Who may bypass the on-portal consent step by recording consent obtained
 * offline, and when.
 *
 * The seller's region is meant to approve the trade here on the portal. But a
 * seller that is unavailable — no administrator, or simply one who has not
 * answered — would otherwise leave the ticket stuck forever. So the buyer's
 * region (the one that applies the fix) is allowed to bypass that step by
 * documenting how consent was obtained off the portal:
 *
 *   · the buyer's region, on any trade still awaiting the seller; or
 *   · the national administrator, for the same.
 *
 * What stops this from becoming "consent to your own trade" is not who may do
 * it but what it costs: the bypass carries a mandatory remark naming who
 * agreed and when, it is stored as an offline consent (never a portal one),
 * and it is logged at warn level in both regions. The remark is the record.
 *
 * The seller's region itself is not offered this path — it consents through
 * /consent, not by recording its own offline agreement.
 */
function mayRecordOfflineConsent({ isNational, actingRegion, row }) {
  if (row.consent_state !== 'Awaiting') {
    return { ok: false, error: 'This discrepancy is not waiting on anyone’s consent.' };
  }
  if (isNational) return { ok: true };
  if (!isBuyerRegion(row, actingRegion)) {
    return { ok: false, error: 'Only the buyer’s region can bypass the seller’s consent.' };
  }
  return { ok: true };
}

/**
 * Who may apply the fix and close the ticket.
 *
 * The buyer's region does that, and only once the seller has agreed. Before
 * consent there is nothing to apply; without it there is no authority to.
 */
function mayResolveTrade({ isNational, actingRegion, row }) {
  if (row.consent_state === 'Awaiting') {
    return {
      ok: false,
      error: `This trade is waiting on ${row.seller_region}’s consent and cannot be resolved yet.`,
    };
  }
  if (row.consent_state === 'Refused') {
    return { ok: false, error: `${row.seller_region} refused this trade, so the ticket is closed.` };
  }
  if (isNational) return { ok: true };
  if (!isBuyerRegion(row, actingRegion)) {
    return { ok: false, error: `${row.buyer_region} applies the scheduling fix for this trade.` };
  }
  return { ok: true };
}

module.exports = {
  GRID_REGIONS,
  FILING_CATEGORIES,
  isTrader,
  validateTrade,
  isInterRegional,
  openingState,
  regionsInvolved,
  isSellerRegion,
  isBuyerRegion,
  sellerCanAnswer,
  mayRecordOfflineConsent,
  mayResolveTrade,
};
