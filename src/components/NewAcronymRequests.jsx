import { useState, useEffect, useCallback } from 'react';
import { getNewAcronymRequests, processNewAcronymRequest } from '../services/db';
import { Banner, EmptyState } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';
import { signupTypeLabel, deriveSignupType, generatorSubTypeLabel } from '../utils/wbesTypes';
import { formatDateDMYHM } from '../utils/format';
import { FilePlus2, X, Check, Ban } from 'lucide-react';

/**
 * NewAcronymRequests — the admin queue for brand-new plants asking to be added
 * to the WBES register and, optionally, placed under a chosen QCA.
 *
 * Approving creates the wbes_entities row (deriving its working category from
 * the utility/generator type) and, when a QCA was chosen, opens its assignment —
 * all in one transaction on the server. Nothing takes effect until then.
 */
export default function NewAcronymRequests() {
  const { notice, notify } = useFeedback();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [busy, setBusy] = useState(false);

  // Rejecting needs a reason, so it gets a small modal.
  const [rejecting, setRejecting] = useState(null);   // the request being rejected
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList((await getNewAcronymRequests(statusFilter)) || []);
    } catch (err) {
      notify('error', err.message || 'Could not load new-acronym requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, notify]);

  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const approve = async (r) => {
    setBusy(true);
    try {
      await processNewAcronymRequest(r.id, 'Approved');
      notify('success', `${r.wbes_acronym} registered${r.requested_qca_username ? ` and assigned to ${r.requested_qca_name || r.requested_qca_username}` : ''}.`);
      await load();
    } catch (err) {
      notify('error', err.message || 'Could not approve the request.');
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async (e) => {
    e.preventDefault();
    if (!rejectNote.trim()) { notify('error', 'Give a reason for the rejection.'); return; }
    setBusy(true);
    try {
      await processNewAcronymRequest(rejecting.id, 'Rejected', rejectNote.trim());
      setRejecting(null);
      setRejectNote('');
      notify('success', `Request for ${rejecting.wbes_acronym} rejected.`);
      await load();
    } catch (err) {
      notify('error', err.message || 'Could not reject the request.');
    } finally {
      setBusy(false);
    }
  };

  const typeLabel = (r) => {
    const st = deriveSignupType(r.utility_type, r.generator_type);
    const bits = [st ? signupTypeLabel(st) : '—'];
    if (r.generator_subtype) bits.push(generatorSubTypeLabel(r.generator_subtype));
    return bits.join(' · ');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><FilePlus2 size={20} /> New Acronym Requests</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            Requests to register a brand-new plant / WBES id. Approving adds it to the register and,
            when a QCA was chosen, places it under that QCA.
          </p>
        </div>
        <select className="form-control" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>

      <Banner type={notice?.type} message={notice?.message} />

      <div className="glass-panel" style={{ padding: '25px' }}>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
        ) : list.length === 0 ? (
          <EmptyState title="No requests" hint="New-acronym requests will appear here." icon={FilePlus2} />
        ) : (
          <div className="table-container">
            <table className="custom-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>WBES Acronym</th>
                  <th>Plant</th>
                  <th>Region</th>
                  <th>Type</th>
                  <th>Requested QCA</th>
                  <th>Requested By</th>
                  <th>Filed</th>
                  <th>Status</th>
                  <th style={{ width: '150px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>#{r.id}</td>
                    <td className="mono" style={{ fontWeight: 'bold' }}>{r.wbes_acronym}</td>
                    <td>{r.name}</td>
                    <td>{r.region}</td>
                    <td>{typeLabel(r)}</td>
                    <td>{r.requested_qca_username ? (r.requested_qca_name || r.requested_qca_username) : <span style={{ color: 'var(--text-muted)' }}>none</span>}</td>
                    <td>{r.requested_by}</td>
                    <td>{formatDateDMYHM(r.created_at)}</td>
                    <td><span className={`status-badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
                    <td>
                      {r.status === 'Pending' ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="btn btn-teal" style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            disabled={busy} onClick={() => approve(r)}><Check size={13} /> Approve</button>
                          <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            disabled={busy} onClick={() => { setRejecting(r); setRejectNote(''); }}>Reject</button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }} title={r.review_note || ''}>
                          {r.reviewed_by ? `by ${r.reviewed_by}` : 'Processed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="modal-overlay" onClick={() => !busy && setRejecting(null)}>
          <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Reject {rejecting.wbes_acronym}?</h3>
              <button type="button" className="modal-close" onClick={() => setRejecting(null)} disabled={busy}
                aria-label="Close dialog" style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitReject} style={{ padding: '18px' }}>
              <div className="form-group">
                <label htmlFor="reject-note">Reason (shown to the requester)</label>
                <textarea id="reject-note" className="form-control" rows={3} value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="e.g. This plant is already registered as ABC_SOLAR" />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setRejecting(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-danger" disabled={busy}><Ban size={15} /> {busy ? 'Rejecting…' : 'Reject'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
