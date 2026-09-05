import { useState, useEffect, useCallback, useMemo } from 'react';
import { getQcaStatus, updateUserAssignment } from '../services/db';
import { Banner, EmptyState } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';
import { categoryShort } from '../utils/categories';
import { CategoryIcon, GenerationIcon } from '../utils/typeIcons';
import { formatDateDMY } from '../utils/format';
import { Users, Pencil, X, Check } from 'lucide-react';

/**
 * QcaStatus — the admin's view of every QCA in the region and the plants under
 * it, current and past.
 *
 * The plant→QCA relationship is a date-ranged ledger (user_plant_assignments):
 * the row with no to_date, or a to_date still in the future, is the active
 * holding; a closed row is a past one and is kept as history. An administrator
 * can correct the active/assigned dates of any holding here — the same
 * PATCH /assignments/:id the transfer flow uses.
 */
export default function QcaStatus() {
  const { notice, notify } = useFeedback();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  // The assignment being edited, and its date form.
  const [editing, setEditing] = useState(null);   // assignment_id
  const [editForm, setEditForm] = useState({ from_date: '', to_date: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await getQcaStatus()) || []);
    } catch (err) {
      notify('error', err.message || 'Could not load QCA status.');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  // Group the flat rows by QCA. A QCA with no plants comes back as a single row
  // with a null assignment; keep it, with an empty plant list.
  const groups = useMemo(() => {
    const byQca = new Map();
    for (const r of rows) {
      if (!byQca.has(r.qca_username)) {
        byQca.set(r.qca_username, {
          username: r.qca_username, fullName: r.qca_full_name,
          qcaName: r.qca_name, region: r.qca_region, locked: r.qca_locked,
          plants: [],
        });
      }
      if (r.assignment_id) byQca.get(r.qca_username).plants.push(r);
    }
    return [...byQca.values()];
  }, [rows]);

  const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

  const openEdit = (p) => {
    setEditForm({ from_date: toDateInput(p.from_date), to_date: toDateInput(p.to_date) });
    setEditing(p.assignment_id);
  };

  const saveEdit = async (assignmentId) => {
    if (!editForm.from_date) { notify('error', 'A holding needs a From Date.'); return; }
    if (editForm.to_date && editForm.to_date < editForm.from_date) {
      notify('error', 'The To Date cannot be before the From Date.'); return;
    }
    setBusy(true);
    try {
      await updateUserAssignment(assignmentId, editForm.from_date, editForm.to_date || null);
      setEditing(null);
      notify('success', 'Assignment dates updated.');
      await load();
    } catch (err) {
      notify('error', err.message || 'Could not update the assignment.');
    } finally {
      setBusy(false);
    }
  };

  const activePlants = (g) => g.plants.filter(p => p.is_active);
  const visiblePlants = (g) => (showHistory ? g.plants : activePlants(g));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={20} /> QCA Status</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            Every QCA coordinator and the plants under it. Edit a holding to correct its
            active (From) or assigned-until (To) date. A blank To Date means the holding is open.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show past holdings
        </label>
      </div>

      <Banner type={notice?.type} message={notice?.message} />

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState title="No QCA accounts" hint="QCA coordinators in this region will appear here." icon={Users} />
      ) : (
        groups.map((g) => (
          <div key={g.username} className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <div>
                <strong style={{ fontSize: '0.95rem' }}>{g.qcaName || g.fullName || g.username}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '8px' }}>
                  {g.username}{g.region ? ` · ${g.region}` : ''}
                </span>
                {g.locked && <span className="status-badge status-rejected" style={{ marginLeft: '8px' }}>Locked</span>}
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {activePlants(g).length} active{showHistory && g.plants.length !== activePlants(g).length ? ` · ${g.plants.length} total` : ''}
              </span>
            </div>

            {visiblePlants(g).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
                {showHistory ? 'No plant holdings.' : 'No active plants.'}
              </p>
            ) : (
              <div className="table-container">
                <table className="custom-table" style={{ margin: 0, fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th scope="col">WBES Acronym</th>
                      <th scope="col">Plant</th>
                      <th scope="col">Category</th>
                      <th scope="col">From Date</th>
                      <th scope="col">To Date</th>
                      <th scope="col">State</th>
                      <th scope="col" style={{ width: '150px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePlants(g).map((p) => (
                      <tr key={p.assignment_id} style={{ opacity: p.is_active ? 1 : 0.6 }}>
                        <td className="mono">{p.wbes_acronym}</td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><GenerationIcon source={`${p.plant_name || ''} ${p.generator_type || ''}`} size={14} />{p.plant_name}</span></td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><CategoryIcon category={p.energy_category} size={13} />{categoryShort(p.energy_category)}</span></td>
                        {editing === p.assignment_id ? (
                          <>
                            <td>
                              <input type="date" className="form-control" value={editForm.from_date}
                                style={{ height: '30px', padding: '0 6px', fontSize: '0.8rem' }}
                                onChange={(e) => setEditForm(f => ({ ...f, from_date: e.target.value }))} />
                            </td>
                            <td>
                              <input type="date" className="form-control" value={editForm.to_date}
                                style={{ height: '30px', padding: '0 6px', fontSize: '0.8rem' }}
                                onChange={(e) => setEditForm(f => ({ ...f, to_date: e.target.value }))} />
                            </td>
                            <td>{p.is_active ? <span className="status-badge status-resolved">Active</span> : <span className="status-badge">Past</span>}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" className="btn btn-teal" style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                                  disabled={busy} onClick={() => saveEdit(p.assignment_id)}>
                                  <Check size={13} /> Save
                                </button>
                                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                                  disabled={busy} onClick={() => setEditing(null)}>
                                  <X size={13} />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{formatDateDMY(p.from_date)}</td>
                            <td>{p.to_date ? formatDateDMY(p.to_date) : <span style={{ color: 'var(--text-muted)' }}>open</span>}</td>
                            <td>{p.is_active ? <span className="status-badge status-resolved">Active</span> : <span className="status-badge">Past</span>}</td>
                            <td>
                              <button type="button" className="btn btn-secondary" style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                                onClick={() => openEdit(p)} title="Correct the active / assigned dates">
                                <Pencil size={13} /> Edit dates
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
