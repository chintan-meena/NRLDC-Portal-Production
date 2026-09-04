import { useState, useEffect, useCallback, useMemo } from 'react';
import { getSimulationContext, runSimulation } from '../services/db';
import { Banner, EmptyState } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';
import { formatDateDMY } from '../utils/format';
import { Play, Plus, X, TriangleAlert, CalendarRange } from 'lucide-react';

/**
 * SimulationScreen — project plant→QCA ownership over an arbitrary date range,
 * and see what a set of proposed transfers would do to it, WITHOUT changing any
 * data. It calls POST /api/simulation/project, which runs the same conflict and
 * approve logic the live routes use inside a rolled-back transaction. Admin-only
 * and region-scoped by the server.
 */
const iso = (d) => d.toISOString().slice(0, 10);
function defaultRange() {
  const today = new Date();
  const end = new Date(); end.setDate(end.getDate() + 30);
  return { from: iso(today), to: iso(end) };
}

// Collapse a per-day [{date, owner, ownerName, hasDiscrepancy}] array into
// consecutive same-owner segments for a readable timeline.
function toSegments(days) {
  const segs = [];
  for (const d of days || []) {
    const last = segs[segs.length - 1];
    if (last && last.owner === d.owner) { last.to = d.date; if (d.hasDiscrepancy) last.disc = true; }
    else segs.push({ owner: d.owner, ownerName: d.ownerName, from: d.date, to: d.date, disc: !!d.hasDiscrepancy });
  }
  return segs;
}

export default function SimulationScreen() {
  const { notice, notify } = useFeedback();
  const [ctx, setCtx] = useState({ plants: [], qcas: [], region: '' });
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(defaultRange());
  const [selected, setSelected] = useState([]);        // chosen acronyms ([] = all in scope)
  const [whatIfs, setWhatIfs] = useState([]);          // [{wbes_acronym, to_username, effective_date}]
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try { setCtx(await getSimulationContext()); }
      catch (err) { notify('error', err.message || 'Could not load simulation context.'); }
      finally { setLoading(false); }
    })();
  }, [notify]);

  const plantOptions = ctx.plants || [];
  const qcaOptions = ctx.qcas || [];

  const addWhatIf = () => setWhatIfs(w => [...w, { wbes_acronym: '', to_username: '', effective_date: range.from }]);
  const updWhatIf = (i, k, v) => setWhatIfs(w => w.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const delWhatIf = (i) => setWhatIfs(w => w.filter((_, j) => j !== i));

  const run = useCallback(async () => {
    setRunning(true); setResult(null);
    try {
      const payload = {
        fromDate: range.from, toDate: range.to,
        acronyms: selected.length ? selected : undefined,
        whatIfTransfers: whatIfs.filter(w => w.wbes_acronym && w.to_username && w.effective_date),
      };
      const r = await runSimulation(payload);
      setResult(r);
      const conflicts = r.whatIf?.conflicts?.length || 0;
      notify(conflicts ? 'warning' : 'success',
        conflicts ? `${conflicts} proposed transfer(s) would be blocked by a conflict.` : 'Simulation complete — no conflicts.');
    } catch (err) {
      notify('error', err.message || 'Simulation failed.');
    } finally { setRunning(false); }
  }, [range, selected, whatIfs, notify]);

  const timelines = useMemo(() => {
    if (!result) return [];
    const base = result.baseline || {};
    const proj = result.whatIf?.projected || null;
    return (result.plants || []).map(p => {
      const acr = p.wbes_acronym.toUpperCase();
      return { plant: p, baseline: toSegments(base[acr]), projected: proj ? toSegments(proj[acr]) : null };
    });
  }, [result]);

  if (loading) return <div className="dashboard-layout"><p>Loading simulation…</p></div>;

  return (
    <div className="dashboard-layout">
      <div className="glass-panel" style={{ padding: '18px', marginBottom: '16px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
          <CalendarRange size={18} /> Transfer / Ownership Simulation
          <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: 8 }}>region: {ctx.region}</span>
        </h3>
        <p style={{ fontSize: '0.82rem', opacity: 0.8, marginTop: 0 }}>
          Project who coordinates each plant on every day of a range, and try proposed transfers as
          what-ifs. Nothing here is saved — the server computes it and rolls it back.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: '0.8rem' }}>From
            <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
              style={{ display: 'block', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: '0.8rem' }}>To
            <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
              style={{ display: 'block', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: '0.8rem', minWidth: 220 }}>Plants (none = all {plantOptions.length} in region)
            <select multiple value={selected} onChange={e => setSelected([...e.target.selectedOptions].map(o => o.value))}
              style={{ display: 'block', marginTop: 4, minHeight: 72, width: '100%' }}>
              {plantOptions.map(p => <option key={p.wbes_acronym} value={p.wbes_acronym}>{p.wbes_acronym} — {p.name}</option>)}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: '0.82rem' }}>What-if transfers</strong>
            <button type="button" className="btn-secondary" onClick={addWhatIf} style={{ padding: '2px 8px', fontSize: '0.78rem' }}>
              <Plus size={13} /> Add
            </button>
          </div>
          {whatIfs.length === 0 && <p style={{ fontSize: '0.78rem', opacity: 0.6, margin: 0 }}>No proposed transfers — the run shows current ownership only.</p>}
          {whatIfs.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={w.wbes_acronym} onChange={e => updWhatIf(i, 'wbes_acronym', e.target.value)}>
                <option value="">plant…</option>
                {plantOptions.map(p => <option key={p.wbes_acronym} value={p.wbes_acronym}>{p.wbes_acronym}</option>)}
              </select>
              <span style={{ fontSize: '0.8rem' }}>→</span>
              <select value={w.to_username} onChange={e => updWhatIf(i, 'to_username', e.target.value)}>
                <option value="">to QCA…</option>
                {qcaOptions.map(q => <option key={q.username} value={q.username}>{q.qca_name || q.username}</option>)}
              </select>
              <input type="date" value={w.effective_date} onChange={e => updWhatIf(i, 'effective_date', e.target.value)} />
              <button type="button" className="btn-icon" onClick={() => delWhatIf(i)} aria-label="Remove"><X size={14} /></button>
            </div>
          ))}
        </div>

        <button type="button" className="btn-primary" onClick={run} disabled={running} style={{ marginTop: 14 }}>
          <Play size={15} /> {running ? 'Running…' : 'Run simulation'}
        </button>
      </div>

      {notice && <Banner notice={notice} />}

      {result && result.whatIf?.applied?.length > 0 && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 16 }}>
          <h4 style={{ marginTop: 0 }}>Proposed transfers</h4>
          <table className="data-table" style={{ width: '100%' }}>
            <thead><tr><th>Plant</th><th>From</th><th>To</th><th>Effective</th><th>Result</th></tr></thead>
            <tbody>
              {result.whatIf.applied.map((a, i) => (
                <tr key={i}>
                  <td>{a.wbes_acronym}</td>
                  <td>{a.from_qca || <em>unowned</em>}</td>
                  <td>{a.to_qca}</td>
                  <td>{formatDateDMY(a.effective_date)}</td>
                  <td>{a.ok
                    ? <span style={{ color: 'var(--success, #2e7d32)' }}>✓ would apply</span>
                    : <span style={{ color: 'var(--danger, #c62828)', display: 'inline-flex', gap: 4, alignItems: 'center' }}><TriangleAlert size={13} /> blocked</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.whatIf.conflicts.map((c, i) => (
            <p key={i} style={{ fontSize: '0.8rem', color: 'var(--danger, #c62828)', margin: '6px 0 0' }}>
              <strong>{c.wbes_acronym}:</strong> {c.message}
            </p>
          ))}
        </div>
      )}

      {result && (timelines.length === 0
        ? <EmptyState title="No plants in scope" message="Nothing to project for this region and range." />
        : timelines.map(({ plant, baseline, projected }) => (
          <div key={plant.wbes_acronym} className="glass-panel" style={{ padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{plant.wbes_acronym}</strong>
              <span style={{ fontSize: '0.76rem', opacity: 0.7 }}>{plant.name} · {plant.region}</span>
            </div>
            <TimelineRow label={projected ? 'Now' : 'Ownership'} segs={baseline} />
            {projected && <TimelineRow label="After what-ifs" segs={projected} highlight />}
          </div>
        )))}
    </div>
  );
}

function TimelineRow({ label, segs, highlight }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
      <span style={{ fontSize: '0.72rem', width: 96, opacity: 0.7 }}>{label}</span>
      <div style={{ display: 'flex', flex: 1, gap: 3, flexWrap: 'wrap' }}>
        {segs.length === 0 && <span style={{ fontSize: '0.76rem', opacity: 0.5 }}>—</span>}
        {segs.map((s, i) => (
          <span key={i} title={`${s.from} → ${s.to}`}
            style={{
              fontSize: '0.72rem', padding: '2px 8px', borderRadius: 6,
              background: s.owner ? (highlight ? 'rgba(46,125,50,0.15)' : 'rgba(120,120,160,0.15)') : 'rgba(200,120,120,0.12)',
              border: s.disc ? '1px solid var(--danger, #c62828)' : '1px solid transparent',
            }}>
            {formatDateDMY(s.from)}–{formatDateDMY(s.to)}: <strong>{s.ownerName || (s.owner ? s.owner : 'unassigned')}</strong>
            {s.disc ? ' •disc' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
