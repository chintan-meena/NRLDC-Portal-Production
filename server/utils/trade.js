/**
 * utils/trade.js — Trades, and who has to agree before one is corrected.
 *
 * Every other filing in this portal belongs to exactly one region: a station
 * raises it, its own RLDC judges it, and no one else ever sees it. A trade
 * filing does not fit that shape. Power bought in one region and sold in
 * another produces a discrepancy that two centres have a claim on, and the one
 * that must change a schedule is not always the one that can confirm the trade.
 *
 * Which end applies the fix depends on the SELLER plant's category:
 *
 *   · seller is RE        → the SELLER'S region applies the fix (the RE plant is
 *                           despatched there); the BUYER'S region must consent.
 *   · seller is non-RE    → the BUYER'S region applies the fix; the SELLER'S
 *     (State / conventional) region must consent.
 *
 * So one side is the "correcting" region and the other the "consenting" region.
 * The split is decided once, at filing, from the seller's category, and stored
 * on the row (correcting_region / consenting_region) — the seller acronym may
 * belong to a region that is not on this portal, so it cannot be re-derived
 * later. Everything below reads those two columns, never buyer/seller directly.
 *
 *      trade filed  →  consenting region confirms the trade
 *                      ├── refuses  → closed, nothing further
 *                      └── consents → correcting region applies the fix
 *
 * An intra-regional trade — both ends inside one region — has nobody to ask and
 * takes the ordinary path (Pending, resolved by that region).
 *
 * The whole state machine is in this file rather than spread through the route,
 * so "who may do what, and when" can be read in one sitting and tested without
 * a database.
 */

/**
 * The five regional load despatch centres, plus the national one.
 * Fixed by the grid rather than by this portal.
 */
const GRID_REGIONS = ['NRLDC', 'WRLDC', 'SRLDC', 'ERLDC', 'NERLDC', 'NLDC'];

/** The categories that may file at all, in the order they are offered. */
const FILING_CATEGORIES = ['ISGS', 'RE', 'States', 'Traders'];

/** The two approval kinds a trade filing may quote. */
const GNA_TYPES = ['GNA', 'T-GNA'];

/** Is this account a trader? */
function isTrader(category) {
  return category === 'Traders';
}

/**
 * May this account file against a trade at all? Traders always do; States may
 * too, because a state buying or selling across a boundary produces exactly the
 * same two-region discrepancy a trader's does.
 */
function isTradeCapable(category) {
  return category === 'Traders' || category === 'States';
}

/**
 * Decide, from the seller's category, which region corrects and which consents.
 *
 * Returns { correctingRegion, consentingRegion }. For an intra-regional trade
 * there is nobody to ask: consentingRegion is null and the single region both
 * owns and corrects it.
 */
function resolveRouting({ sellerIsRE, buyerRegion, sellerRegion }) {
  if (buyerRegion === sellerRegion) {
    return { correctingRegion: buyerRegion, consentingRegion: null };
  }
  if (sellerIsRE) {
    // RE plant sits in the seller's region, which corrects it; the buyer agrees.
    return { correctingRegion: sellerRegion, consentingRegion: buyerRegion };
  }
  // Non-RE: the correction is applied at the buyer's end; the seller agrees.
  return { correctingRegion: buyerRegion, consentingRegion: sellerRegion };
}

/**
 * Check the routing data on a trade filing.
 *
 * Returns { ok: true, trade } or { ok: false, error }. `trade` is normalised —
 * upper-cased regions and acronyms, trimmed approval — so the caller stores
 * what was checked rather than what was typed.
 */
function validateTrade({ buyerRegion, sellerRegion, buyerAcronym, sellerAcronym, gnaTgnaType, gnaTgnaNumber }, knownRegions = []) {
  const up = (v) => String(v || '').trim().toUpperCase();
  const trade = {
    buyerRegion: up(buyerRegion),
    sellerRegion: up(sellerRegion),
    buyerAcronym: up(buyerAcronym),
    sellerAcronym: up(sellerAcronym),
    gnaTgnaType: String(gnaTgnaType || '').trim().toUpperCase().replace(/\s+/g, ''),
    gnaTgnaNumber: String(gnaTgnaNumber || '').trim(),
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

  if (trade.buyerAcronym === trade.sellerAcronym) {
    return { ok: false, error: 'The buyer and the seller cannot be the same entity.' };
  }

  // Normalise a couple of common ways of writing T-GNA before checking.
  if (['TGNA', 'T-GNA'].includes(trade.gnaTgnaType)) trade.gnaTgnaType = 'T-GNA';
  if (!GNA_TYPES.includes(trade.gnaTgnaType)) {
    return { ok: false, error: 'Choose the approval type — GNA or T-GNA.' };
  }
  if (!trade.gnaTgnaNumber) {
    return { ok: false, error: 'Enter the GNA / T-GNA approval number for this trade.' };
  }
  if (trade.gnaTgnaNumber.length > 50) {
    return { ok: false, error: 'The GNA / T-GNA approval number is too long.' };
  }

  return { ok: true, trade };
}

/** Does this trade cross a regional boundary? */
function isInterRegional(trade) {
  return !!trade && trade.buyerRegion !== trade.sellerRegion;
}

/**
 * Where a trade filing starts.
 *
 * Inter-regional work waits on the consenting region. Everything else is
 * Pending from the outset, exactly as a station's filing is.
 */
function openingState(trade) {
  if (!trade || !isInterRegional(trade)) {
    return { status: 'Pending', consentState: null };
  }
  return { status: 'Awaiting Consent', consentState: 'Awaiting' };
}

/**
 * Which regions may see this record. A trade is visible to both ends; an
 * ordinary filing to its own region only.
 */
function regionsInvolved(row) {
  return [...new Set([row.region, row.buyer_region, row.seller_region].filter(Boolean))];
}

/** The seller / buyer party checks — used for plain "is this region involved". */
function isSellerRegion(row, region) {
  return !!row.seller_region && row.seller_region === region;
}
function isBuyerRegion(row, region) {
  return !!row.buyer_region && row.buyer_region === region;
}

/** The region that must consent (the one NOT applying the correction). */
function isConsentingRegion(row, region) {
  return !!row.consenting_region && row.consenting_region === region;
}
/** The region that applies the fix and closes the ticket. */
function isCorrectingRegion(row, region) {
  return !!row.correcting_region && row.correcting_region === region;
}

/**
 * Whether the region being asked to consent can answer for itself here.
 * "Not on the portal" is the observable fact that it has no administrator.
 */
function consenterCanAnswer(adminCount) {
  return Number(adminCount) > 0;
}

/**
 * Who may answer the consent step — the consenting region, or the national
 * administrator acting for it (the only way a ticket against an unresponsive
 * centre ever moves on the portal).
 */
function mayConsent({ isNational, actingRegion, row }) {
  if (row.consent_state !== 'Awaiting') {
    return { ok: false, error: 'This discrepancy is not waiting on anyone’s consent.' };
  }
  if (isNational) return { ok: true };
  if (!isConsentingRegion(row, actingRegion)) {
    return { ok: false, error: `${row.consenting_region} is the region that must consent to this trade.` };
  }
  return { ok: true };
}

/**
 * Who may bypass the on-portal consent step by recording consent obtained
 * offline: the correcting region (the one that applies the fix), or national.
 *
 * The consenting region is unavailable — no administrator, or simply one who
 * has not answered — so the correcting region documents how consent was
 * obtained off the portal (phone, message) and closes the ticket in one step.
 * What keeps this honest is the mandatory remark, the 'offline' mode, and the
 * warn-level log in both regions. The consenting region itself is not offered
 * this path — it consents through /consent.
 */
function mayRecordOfflineConsent({ isNational, actingRegion, row }) {
  if (row.consent_state !== 'Awaiting') {
    return { ok: false, error: 'This discrepancy is not waiting on anyone’s consent.' };
  }
  if (isNational) return { ok: true };
  if (!isCorrectingRegion(row, actingRegion)) {
    return { ok: false, error: 'Only the region applying the correction can bypass the other’s consent.' };
  }
  return { ok: true };
}

/**
 * Who may apply the fix and close the ticket: the correcting region, and only
 * once the consenting region has agreed. Before consent there is nothing to
 * apply; without it there is no authority to.
 */
function mayResolveTrade({ isNational, actingRegion, row }) {
  if (row.consent_state === 'Awaiting') {
    return {
      ok: false,
      error: `This trade is waiting on ${row.consenting_region}’s consent and cannot be resolved yet.`,
    };
  }
  if (row.consent_state === 'Refused') {
    return { ok: false, error: `${row.consenting_region} refused this trade, so the ticket is closed.` };
  }
  if (isNational) return { ok: true };
  if (!isCorrectingRegion(row, actingRegion)) {
    return { ok: false, error: `${row.correcting_region} applies the scheduling fix for this trade.` };
  }
  return { ok: true };
}

module.exports = {
  GRID_REGIONS,
  FILING_CATEGORIES,
  GNA_TYPES,
  isTrader,
  isTradeCapable,
  resolveRouting,
  validateTrade,
  isInterRegional,
  openingState,
  regionsInvolved,
  isSellerRegion,
  isBuyerRegion,
  isConsentingRegion,
  isCorrectingRegion,
  consenterCanAnswer,
  mayConsent,
  mayRecordOfflineConsent,
  mayResolveTrade,
};
