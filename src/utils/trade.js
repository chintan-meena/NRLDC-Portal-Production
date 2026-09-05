/**
 * utils/trade.js — What the screen needs to know about trades and consent.
 *
 * The rules themselves live on the server, in server/utils/trade.js, and this
 * is deliberately not a second copy of them: nothing here decides anything.
 * It answers only the questions the interface has to answer to draw itself —
 * which fields to show, what to call the state a ticket is in, and whose turn
 * it is — so the same wording is used everywhere rather than reinvented in
 * each component.
 *
 * Which region corrects and which consents is decided on the server, from the
 * seller plant's category, and carried on the row as correcting_region /
 * consenting_region. This file reads those, never buyer/seller directly.
 */

/** The load despatch centres, for the buyer/seller pickers. */
export const GRID_REGIONS = ['NRLDC', 'WRLDC', 'SRLDC', 'ERLDC', 'NERLDC'];

/** The two regulatory approval kinds a trade filing may quote. */
export const GNA_TYPES = ['GNA', 'T-GNA'];

/** Does this account file only against trades? (Traders.) */
export const isTraderCategory = (category) => category === 'Traders';

/** May this account attach a trade to a filing? (Traders and States.) */
export const isTradeCapableCategory = (category) => category === 'Traders' || category === 'States';

/** Does this record carry a trade? */
export const isTrade = (d) => !!(d && d.buyer_region && d.seller_region);

/** Does it cross a regional boundary — the only kind that needs consent? */
export const isInterRegional = (d) => isTrade(d) && d.buyer_region !== d.seller_region;

/**
 * What the consent step is currently doing, in words a user can act on.
 *
 * Returns null for everything that is not a trade awaiting/holding consent.
 */
export function consentSummary(d, viewerRegion) {
  if (!d || !d.consent_state) return null;

  const mine = (r) => r && r === viewerRegion;
  const consenter = d.consenting_region;
  const corrector = d.correcting_region;

  if (d.consent_state === 'Awaiting') {
    return {
      tone: 'pending',
      label: 'Awaiting consent',
      detail: mine(consenter)
        ? `This trade names your region to consent. Confirm the trade was yours, or deny it.`
        : `Waiting for ${consenter} to consent. It cannot be corrected until they do.`,
      yourMove: mine(consenter),
    };
  }

  if (d.consent_state === 'Refused') {
    return {
      tone: 'rejected',
      label: 'Consent denied',
      detail: `${consenter} denied consent, so the ticket is closed. No fix is applied.`,
      yourMove: false,
    };
  }

  // Consented. How it was obtained is worth being explicit about: a reader
  // should never have to guess whether the region answered here or whether the
  // correcting region wrote it down on their behalf.
  const offline = d.consent_mode === 'offline';
  return {
    tone: 'resolved',
    label: offline ? `Offline consent recorded (${consenter})` : `Consented for correction`,
    detail: offline
      ? `${consenter} does not use this portal. Consent was obtained elsewhere and recorded by ${d.consent_by}.`
      : `${consenter} consented. ${corrector} applies the scheduling fix.`,
    yourMove: mine(corrector),
  };
}

/** The one-line form, for a table cell. */
export function consentBadge(d) {
  if (!d || !d.consent_state) return null;
  if (d.consent_state === 'Awaiting') return { tone: 'pending', text: `Awaiting ${d.consenting_region}` };
  if (d.consent_state === 'Refused') return { tone: 'rejected', text: 'Consent denied' };
  return {
    tone: 'resolved',
    text: d.consent_mode === 'offline' ? 'Consented (offline)' : 'Consented for correction',
  };
}

/** How a trade reads in one line: who sold to whom, and across which centres. */
export function tradeRoute(d) {
  if (!isTrade(d)) return '';
  return `${d.seller_wbes_acronym} (${d.seller_region}) → ${d.buyer_wbes_acronym} (${d.buyer_region})`;
}
