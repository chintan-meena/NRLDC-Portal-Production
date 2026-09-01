import { useState, useEffect, useCallback } from 'react';
import { getHabitualTracker } from '../services/db';
import { Banner, EmptyState, SkeletonRows } from './Feedback';
import { Repeat, Download, AlertTriangle } from 'lucide-react';
import { formatDateDMY, todayISO, daysAgoISO } from '../utils/format';

/**
 * HabitualTracker — who keeps raising the same thing.
 *
 * The proportion is (filings this RLDC marked habitual when rejecting) over
 * (that filer's total filings) in the window. Nothing is inferred: the
 * numerator counts only what a reviewer actually marked, so the report says
 * what the despatch centre decided rather than what the portal guessed.
 *
 * Region-scoped by the server like every other admin listing — an RLDC sees
 * only its own filers.
 */
export default function HabitualTracker() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // A rolling window for day-to-day use; an explicit month for the return.
  const [mode, setMode] = useState('rolling');
  const [days, setDays] = useState(30);
  const [fromDate, setFromDate] = useState(daysAgoISO(30));
  const [toDate, setToDate] = useState(todayISO());

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      setData(await getHabitualTracker(
        mode === 'rolling' ? { days } : { fromDate, toDate }
      ));
    } catch (e) {
      setError(e.message || 'Could not build the habitual filing report.');
    } finally {
      setLoading(false);
    }
  }, [mode, days, fromDate, toDate]);

  useEffect(() => { Promise.resolve().then(() => load()); }, [load]);

  const rows = data?.rows || [];
  const flagged = rows.filter(r => r.flagged);

  /** The report as CSV, for the monthly return that goes out by email. */
  const exportCsv = () => {
    const head = ['Filer', 'Name', 'WBES Acronym', 'Category', 'Region',
      'Total filings', 'Rejected', 'Marked habitual', 'Habitual %', 'Above threshold',
      'Marked categories', 'Reviewer notes', 'Last filed'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      head.map(esc).join(','),
      ...rows.map(r => [r.username, r.filer_name, r.wbes_acronym, r.energy_category, r.region,
        r.total_filings, r.rejected_count, r.habitual_count, r.habitual_percent,
        r.flagged ? 'YES' : 'no', r.habitual_types, r.habitual_notes,
        formatDateDMY(r.last_filed)].map(esc).join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `habitual-filing-${data?.from || `last-${days}-days`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex-row-between">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
            <Repeat size={17} />
            <span>Habitual Filing</span>
            {flagged.length > 0 && (
              <span className="queue-count">{flagged.length} above threshold</span>
            )}
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: '4px', maxWidth: '72ch' }}>
            Filers your reviewers marked as habitual when rejecting, as a share of everything
            they filed. Only marked rejections count — a rejection nobody marked does not
            appear here.
          </p>
        </div>
        {rows.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={exportCsv}>
            <Download size={15} /> Export for the return
          </button>
        )}
      </div>

      <div className="tracker-controls">
        <label className="filter-mode" htmlFor="ht-rolling">
          <input id="ht-rolling" type="radio" name="ht-mode" checked={mode === 'rolling'}
            onChange={() => setMode('rolling')} />
          <span>Rolling window</span>
        </label>
        {mode === 'rolling' && (
          <select className="form-control" style={{ width: 'auto' }} value={days}
            onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>last 30 days</option>
            <option value={60}>last 60 days</option>
            <option value={90}>last 90 days</option>
          </select>
        )}

        <label className="filter-mode" htmlFor="ht-range">
          <input id="ht-range" type="radio" name="ht-mode" checked={mode === 'range'}
            onChange={() => setMode('range')} />
          <span>Specific period</span>
        </label>
        {mode === 'range' && (
          <>
            <input type="date" className="form-control" style={{ width: 'auto' }}
              value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input type="date" className="form-control" style={{ width: 'auto' }}
              value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </>
        )}

        {data && (
          <span className="tracker-threshold">
            flagged at <strong>{data.thresholdPercent}%</strong>
            <span className="settings-field-hint"> · set per region in System Parameters</span>
          </span>
        )}
      </div>

      <Banner type="error" message={error} onRetry={load} />

      <div className="table-container" style={{ maxHeight: 'none' }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Filer</th>
              <th>Plant</th>
              <th style={{ textAlign: 'right' }}>Filed</th>
              <th style={{ textAlign: 'right' }}>Rejected</th>
              <th style={{ textAlign: 'right' }}>Marked</th>
              <th style={{ textAlign: 'right' }}>Share</th>
              <th>Categories marked</th>
              <th>Reviewer notes</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <SkeletonRows rows={4} columns={8} />
            ) : rows.length === 0 ? (
              <tr><td colSpan="8">
                <EmptyState
                  title="Nobody marked in this period"
                  hint="A filer appears here once a reviewer ticks “Mark as habitual” while rejecting one of their filings."
                  icon={Repeat}
                />
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.username} className={r.flagged ? 'is-flagged' : ''}>
                <td>
                  <strong className="mono" style={{ fontSize: '0.78rem' }}>{r.username}</strong>
                  {r.filer_name && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.filer_name}</div>
                  )}
                </td>
                <td>
                  <strong className="mono" style={{ color: 'var(--accent-blue)', fontSize: '0.78rem' }}>{r.wbes_acronym || '—'}</strong>
                  {r.energy_category && (
                    <div><span className={`energy-badge ${r.energy_category}`}>{r.energy_category}</span></div>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.total_filings}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rejected_count}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.habitual_count}</td>
                <td style={{ textAlign: 'right' }}>
                  <span className={`share-badge${r.flagged ? ' is-over' : ''}`}>
                    {r.flagged && <AlertTriangle size={12} />}
                    {r.habitual_percent}%
                  </span>
                </td>
                <td style={{ fontSize: '0.76rem', maxWidth: '230px' }}>{r.habitual_types || '—'}</td>
                <td style={{ fontSize: '0.76rem', maxWidth: '260px', color: 'var(--text-secondary)' }}>
                  {r.habitual_notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
