/**
 * utils/trade.js — What the screen needs to know about trades and consent.
 *
 * The rules themselves live on the server, in server/utils/trade.js, and this
 * is deliberately not a second copy of them: nothing here decides anything.
 * It answers only the questions the interface has to answer to draw itself —
 * which fields to show, what to call the state a ticket is in, and whose turn
 * it is — so the same wording is used everywhere rather than reinvented in
 * each component.
 */

/** The load despatch centres, for the buyer/seller pickers. */
export const GRID_REGIONS = ['NRLDC', 'WRLDC', 'SRLDC', 'ERLDC', 'NERLDC'];

/** Does this account file against trades? */
export const isTraderCategory = (category) => category === 'Traders';

/** Does this record carry a trade? */
export const isTrade = (d) => !!(d && d.buyer_region && d.seller_region);

/** Does it cross a regional boundary — the only kind that needs consent? */
export const isInterRegional = (d) => isTrade(d) && d.buyer_region !== d.seller_region;

/**
 * What the consent step is currently doing, in words a user can act on.
 *
 * Returns null for everything that is not an inter-regional trade, which is
 * almost every record — callers render nothing in that case.
 */
export function consentSummary(d, viewerRegion) {
  if (!d || !d.consent_state) return null;

  const mine = (r) => r && r === viewerRegion;
  const seller = d.seller_region;
  const buyer = d.buyer_region;

  if (d.consent_state === 'Awaiting') {
    return {
      tone: 'pending',
      label: 'Awaiting consent',
      detail: mine(seller)
        ? `${buyer} has filed against a trade sold from your region. Confirm the trade was yours, or refuse it.`
        : `Waiting for ${seller} to confirm the trade was theirs. It cannot be resolved until they do.`,
      yourMove: mine(seller),
    };
  }

  if (d.consent_state === 'Refused') {
    return {
      tone: 'rejected',
      label: `Refused by ${seller}`,
      detail: `${seller} says the trade was not theirs, so the ticket is closed. No fix is applied.`,
      yourMove: false,
    };
  }

  // Consented. How it was obtained is the part worth being explicit about: a
  // reader should never have to guess whether the seller answered here or
  // whether the buyer wrote it down on their behalf.
  const offline = d.consent_mode === 'offline';
  return {
    tone: 'resolved',
    label: offline ? `Offline consent recorded (${seller})` : `Consented by ${seller}`,
    detail: offline
      ? `${seller} does not use this portal. Consent was obtained elsewhere and recorded by ${d.consent_by}.`
      : `${seller} confirmed the trade. ${buyer} applies the scheduling fix.`,
    yourMove: mine(buyer),
  };
}

/** The one-line form, for a table cell. */
export function consentBadge(d) {
  if (!d || !d.consent_state) return null;
  if (d.consent_state === 'Awaiting') return { tone: 'pending', text: `Awaiting ${d.seller_region}` };
  if (d.consent_state === 'Refused') return { tone: 'rejected', text: `Refused by ${d.seller_region}` };
  return {
    tone: 'resolved',
    text: d.consent_mode === 'offline' ? `Consent (offline)` : `Consented`,
  };
}

/** How a trade reads in one line: who sold to whom, and across which centres. */
export function tradeRoute(d) {
  if (!isTrade(d)) return '';
  return `${d.seller_wbes_acronym} (${d.seller_region}) → ${d.buyer_wbes_acronym} (${d.buyer_region})`;
}
