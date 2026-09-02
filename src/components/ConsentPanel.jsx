import { useState } from 'react';
import { decideConsent, recordOfflineConsent, uploadFiles } from '../services/db';
import { consentSummary, isTrade } from '../utils/trade';
import { originalFilename } from '../utils/filenames';
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_MB, validateFiles } from '../utils/uploads';
import { Handshake, Clock, XCircle, PhoneOutgoing, Paperclip, ArrowRight } from 'lucide-react';
import { formatDateDMYHM } from '../utils/format';

/**
 * ConsentPanel — the step where two regions have to agree.
 *
 * Shown on any discrepancy raised against a trade. It has to answer three
 * questions at a glance, because the reader may be either region or neither:
 * what the trade was, where the consent has got to, and whether the person
 * looking at it is the one holding it up.
 *
 * The three states are the seller deciding, the seller having refused, and the
 * seller having consented. Only the first has actions, and which actions
 * depend on who is looking.
 */
export default function ConsentPanel({ request, currentUser, onDone, notify }) {
  const [mode, setMode] = useState(null);      // 'refuse' | 'offline'
  const [remark, setRemark] = useState('');
  const [proof, setProof] = useState([]);
  const [busy, setBusy] = useState(false);

  if (!isTrade(request)) return null;

  const viewerRegion = currentUser.region;
  const isNational = currentUser.role === 'SUPERADMIN';
  const summary = consentSummary(request, viewerRegion);

  // An intra-regional trade carries no consent state at all: there is nobody
  // to ask. The route is still worth showing, so the reader can see why a
  // filing from a trader names two entities.
  if (!summary) {
    return (
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
          Trade
        </span>
        <span className="trade-route">
          <span className="mono">{request.seller_wbes_acronym}</span>
          <ArrowRight size={13} />
          <span className="mono">{request.buyer_wbes_acronym}</span>
          <span className="region-badge">{request.buyer_region}</span>
        </span>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
          Both ends are inside {request.buyer_region}, so no other region has to consent.
        </p>
      </div>
    );
  }

  const awaiting = request.consent_state === 'Awaiting';
  const iAmSeller = viewerRegion === request.seller_region;
  const iAmBuyer = viewerRegion === request.buyer_region;
  // A seller that has no administrator here cannot answer at all, which is the
  // only thing that makes recording consent for them legitimate.
  const sellerCanAnswer = request.seller_on_portal !== false;
  const mayRecordOffline = awaiting && (isNational || (iAmBuyer && !sellerCanAnswer));

  const Icon = summary.tone === 'pending' ? Clock : summary.tone === 'rejected' ? XCircle : Handshake;

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      notify('success', success);
      setMode(null); setRemark(''); setProof([]);
      await onDone();
    } catch (err) {
      notify('error', err.message || 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  const submitOffline = async () => {
    if (!remark.trim()) { notify('error', 'Record who agreed, and when. This is the only evidence the ticket will carry.'); return; }
    const badFile = validateFiles(proof);   // returns the message, or null
    if (badFile) { notify('error', badFile); return; }

    let names = [];
    if (proof.length > 0) {
      const form = new FormData();
      proof.forEach(f => form.append('files', f));
      const res = await uploadFiles(form);
      if (res.success) names = res.filenames;
    }
    await run(
      () => recordOfflineConsent(request.req_no, remark.trim(), names),
      `Offline consent from ${request.seller_region} recorded. ${request.buyer_region} can now apply the fix.`
    );
  };

  return (
    <div className={`consent-panel ${summary.tone}`}>
      <Icon size={17} />
      <div style={{ flex: 1 }}>
        <strong>
          {summary.label}
          {request.consent_mode === 'offline' && (
            <span className="consent-offline-mark"><PhoneOutgoing size={10} /> off-portal</span>
          )}
        </strong>
        <p>{summary.detail}</p>

        <p style={{ marginTop: '8px' }}>
          <span className="trade-route">
            <span className="mono">{request.seller_wbes_acronym}</span>
            <span className="region-badge">{request.seller_region}</span>
            <ArrowRight size={13} />
            <span className="mono">{request.buyer_wbes_acronym}</span>
            <span className="region-badge">{request.buyer_region}</span>
          </span>
        </p>

        {/* What was actually agreed, once it has been. Kept visible after the
            ticket moves on, because by then the status says only "Pending". */}
        {request.consent_state !== 'Awaiting' && request.consent_remark && (
          <p style={{ marginTop: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              {request.consent_by} · {formatDateDMYHM(request.consent_at)}
            </span>
            <br />“{request.consent_remark}”
          </p>
        )}

        {request.consent_files?.length > 0 && (
          <p style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {request.consent_files.map((f, i) => (
              <a key={i} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                href={`/upload/${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">
                <Paperclip size={11} /> {originalFilename(f)}
              </a>
            ))}
          </p>
        )}

        {/* ── The seller's decision ─────────────────────────────────────── */}
        {awaiting && (iAmSeller || isNational) && mode !== 'offline' && (
          mode === 'refuse' ? (
            <div style={{ marginTop: '11px' }}>
              <label htmlFor="consent-refuse-why" style={{ fontSize: '0.8rem' }}>
                Why is this not your trade?
              </label>
              <textarea id="consent-refuse-why" className="form-control" rows={2} value={remark}
                placeholder="The filer reads this, and the ticket closes on it."
                onChange={(e) => setRemark(e.target.value)} />
              <div className="consent-actions">
                <button type="button" className="btn btn-danger" disabled={busy || !remark.trim()}
                  onClick={() => run(
                    () => decideConsent(request.req_no, 'refuse', remark.trim()),
                    'Refused. The ticket is closed and the filer has been told why.'
                  )}>
                  {busy ? 'Recording…' : 'Refuse the trade'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setMode(null); setRemark(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="consent-actions">
              <button type="button" className="btn btn-primary" disabled={busy}
                onClick={() => run(
                  () => decideConsent(request.req_no, 'consent', remark.trim()),
                  `Consent recorded. ${request.buyer_region} can now apply the fix.`
                )}>
                <Handshake size={14} /> Yes, this was our trade
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setMode('refuse')}>
                <XCircle size={14} /> Refuse
              </button>
            </div>
          )
        )}

        {/* ── The buyer, when the seller is not here to ask ─────────────── */}
        {mayRecordOffline && mode !== 'refuse' && (
          mode === 'offline' ? (
            <div style={{ marginTop: '11px' }}>
              <label htmlFor="consent-offline-remark" style={{ fontSize: '0.8rem' }}>
                How was consent obtained? <span style={{ color: 'var(--danger-text)' }}>*</span>
              </label>
              <textarea id="consent-offline-remark" className="form-control" rows={2} value={remark}
                placeholder="e.g. Consented by Shri A. Ghosh, ERLDC, by telephone on 02-09-2026 at 11:40."
                onChange={(e) => setRemark(e.target.value)} />
              <span className="settings-field-hint">
                Name who agreed and when. This stands in place of {request.seller_region}’s own
                answer, so it is the only record that consent was ever given.
              </span>

              <label htmlFor="consent-offline-proof" style={{ fontSize: '0.8rem', marginTop: '10px', display: 'block' }}>
                Proof (optional)
              </label>
              <input id="consent-offline-proof" type="file" className="form-control" multiple
                accept={ACCEPT_ATTRIBUTE}
                onChange={(e) => setProof(Array.from(e.target.files || []))} />
              <span className="settings-field-hint">
                An email or a screenshot, up to {MAX_UPLOAD_MB}MB each. Better evidence than a
                sentence, but a sentence is enough.
              </span>

              <div className="consent-actions">
                <button type="button" className="btn btn-primary" disabled={busy || !remark.trim()}
                  onClick={submitOffline}>
                  {busy ? 'Recording…' : 'Record consent and continue'}
                </button>
                <button type="button" className="btn btn-secondary"
                  onClick={() => { setMode(null); setRemark(''); setProof([]); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="consent-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setMode('offline')}>
                <PhoneOutgoing size={14} /> Record consent obtained offline
              </button>
            </div>
          )
        )}

        {/* The buyer, waiting on a seller who can answer for themselves. */}
        {awaiting && iAmBuyer && !isNational && sellerCanAnswer && (
          <p style={{ marginTop: '9px', color: 'var(--text-muted)' }}>
            {request.seller_region} has an administrator on this portal, so the consent is
            theirs to give here. Offline consent is only for a centre that does not use
            the system.
          </p>
        )}
      </div>
    </div>
  );
}
