/**
 * Unit tests for the trade / consent state machine (utils/trade.js).
 * Pure functions, no database. Run with `npm test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isTradeCapable, resolveRouting, validateTrade, isInterRegional, openingState,
  mayConsent, mayResolveTrade, mayRecordOfflineConsent,
} = require('../../utils/trade');

test('isTradeCapable admits Traders and States only', () => {
  assert.equal(isTradeCapable('Traders'), true);
  assert.equal(isTradeCapable('States'), true);
  assert.equal(isTradeCapable('RE'), false);
  assert.equal(isTradeCapable('ISGS'), false);
});

test('resolveRouting — RE seller: seller corrects, buyer consents', () => {
  const r = resolveRouting({ sellerIsRE: true, buyerRegion: 'ERLDC', sellerRegion: 'NRLDC' });
  assert.equal(r.correctingRegion, 'NRLDC');
  assert.equal(r.consentingRegion, 'ERLDC');
});

test('resolveRouting — non-RE seller: buyer corrects, seller consents', () => {
  const r = resolveRouting({ sellerIsRE: false, buyerRegion: 'ERLDC', sellerRegion: 'NRLDC' });
  assert.equal(r.correctingRegion, 'ERLDC');
  assert.equal(r.consentingRegion, 'NRLDC');
});

test('resolveRouting — intra-regional: one region corrects, nobody consents', () => {
  const r = resolveRouting({ sellerIsRE: false, buyerRegion: 'NRLDC', sellerRegion: 'NRLDC' });
  assert.equal(r.correctingRegion, 'NRLDC');
  assert.equal(r.consentingRegion, null);
});

test('validateTrade requires a GNA/T-GNA type and number', () => {
  const base = { buyerRegion: 'ERLDC', sellerRegion: 'NRLDC', buyerAcronym: 'B', sellerAcronym: 'S' };
  assert.equal(validateTrade({ ...base }).ok, false);                                   // no approval
  assert.equal(validateTrade({ ...base, gnaTgnaType: 'GNA' }).ok, false);               // no number
  assert.equal(validateTrade({ ...base, gnaTgnaNumber: 'X/1' }).ok, false);             // no type
  const ok = validateTrade({ ...base, gnaTgnaType: 'GNA', gnaTgnaNumber: 'GNA/2026/1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.trade.gnaTgnaType, 'GNA');
});

test('validateTrade normalises TGNA to T-GNA and upper-cases regions', () => {
  const r = validateTrade({
    buyerRegion: 'erldc', sellerRegion: 'nrldc', buyerAcronym: 'b', sellerAcronym: 's',
    gnaTgnaType: 'tgna', gnaTgnaNumber: 'x/1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.trade.gnaTgnaType, 'T-GNA');
  assert.equal(r.trade.buyerRegion, 'ERLDC');
  assert.equal(r.trade.sellerAcronym, 'S');
});

test('validateTrade rejects the same entity on both ends', () => {
  const r = validateTrade({
    buyerRegion: 'ERLDC', sellerRegion: 'NRLDC', buyerAcronym: 'X', sellerAcronym: 'X',
    gnaTgnaType: 'GNA', gnaTgnaNumber: '1',
  });
  assert.equal(r.ok, false);
});

test('openingState — inter-regional waits on consent, intra-regional does not', () => {
  assert.equal(openingState({ buyerRegion: 'A', sellerRegion: 'B' }).status, 'Awaiting Consent');
  assert.equal(openingState({ buyerRegion: 'A', sellerRegion: 'A' }).status, 'Pending');
  assert.equal(isInterRegional({ buyerRegion: 'A', sellerRegion: 'B' }), true);
});

// Row as stored after routing is settled.
const awaitingRow = { consent_state: 'Awaiting', consenting_region: 'ERLDC', correcting_region: 'NRLDC' };

test('mayConsent — only the consenting region (or national) answers', () => {
  assert.equal(mayConsent({ isNational: false, actingRegion: 'ERLDC', row: awaitingRow }).ok, true);
  assert.equal(mayConsent({ isNational: false, actingRegion: 'NRLDC', row: awaitingRow }).ok, false);
  assert.equal(mayConsent({ isNational: true, actingRegion: null, row: awaitingRow }).ok, true);
  assert.equal(mayConsent({ isNational: false, actingRegion: 'ERLDC', row: { ...awaitingRow, consent_state: 'Consented' } }).ok, false);
});

test('mayRecordOfflineConsent — only the correcting region (or national) bypasses', () => {
  assert.equal(mayRecordOfflineConsent({ isNational: false, actingRegion: 'NRLDC', row: awaitingRow }).ok, true);
  assert.equal(mayRecordOfflineConsent({ isNational: false, actingRegion: 'ERLDC', row: awaitingRow }).ok, false);
  assert.equal(mayRecordOfflineConsent({ isNational: true, actingRegion: null, row: awaitingRow }).ok, true);
});

test('mayResolveTrade — correcting region, only after consent', () => {
  const consented = { consent_state: 'Consented', consenting_region: 'ERLDC', correcting_region: 'NRLDC' };
  assert.equal(mayResolveTrade({ isNational: false, actingRegion: 'NRLDC', row: consented }).ok, true);
  assert.equal(mayResolveTrade({ isNational: false, actingRegion: 'ERLDC', row: consented }).ok, false);
  assert.equal(mayResolveTrade({ isNational: false, actingRegion: 'NRLDC', row: awaitingRow }).ok, false); // not yet consented
  assert.equal(mayResolveTrade({ isNational: false, actingRegion: 'NRLDC', row: { ...consented, consent_state: 'Refused' } }).ok, false);
});
