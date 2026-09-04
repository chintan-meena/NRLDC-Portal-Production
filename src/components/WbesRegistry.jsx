import { useState, useEffect, useCallback } from 'react';
import {
  getWbesEntities, batchRegisterWbesEntities, bulkUploadWbesEntities,
  deleteWbesEntity, setWbesEntityBlocked, updateWbesEntity, downloadFile,
} from '../services/db';
import { REGIONS, isNational } from '../utils/regions';
import {
  UTILITY_TYPES, GENERATOR_TYPES, GENERATOR_SUBTYPES,
  utilityTypeLabel, generatorSubTypeLabel, deriveSignupType, signupTypeLabel,
} from '../utils/wbesTypes';
import ConfirmDialog from './ConfirmDialog';
import { Banner, EmptyState } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';
import {
  Building2, FileUp, FileSpreadsheet, FileDown, Plus, Search, Trash2, Ban, RotateCcw, Pencil, X,
} from 'lucide-react';

/**
 * WbesRegistry — the WBES acronym register, as its own sub-tab of User Management.
 *
 * The register has to be filled before users exist: a station self-registers
 * against an acronym its RLDC has already entered. Who may fill it, and how
 * much at once, is the whole design here:
 *
 *   national  → uploads the national .xlsx, uncapped. Each row lands in the
 *               region its own Region column names, so one upload fills every
 *               region — including one that has no administrator yet. Also gets
 *               the grid below, with a region to choose, for adding one or two
 *               by hand without building a spreadsheet for a single row.
 *   regional  → the grid only, at most MAX_ROWS at a time, always its own
 *               region. No file: the spreadsheet's header and format rules were
 *               the thing regional admins got wrong, and a small typed batch
 *               cannot become a bulk load of somebody else's region.
 *
 * Removing an acronym has two forms, because they answer different problems.
 * Delete is for one entered by mistake and is refused by the server the moment
 * anything references it — deleting one that is in use would cascade away
 * assignment history and detach filed discrepancies. Block is for one that is
 * genuinely in use and turns out to be unwanted: it stays on record, past
 * filings still name it, but nobody can claim it and its holder can no longer
 * file against it.
 */

/** Rows in the grid. The server enforces the same cap; this only shapes the UI. */
const MAX_ROWS = 10;

const emptyRow = () => ({
  name: '', wbes_acronym: '',
  // The rest of the WBES_Utility format — all optional, set per row.
  utility_type: '', generator_type: '', generator_subtype: '',
  from_date: '', date_of_commissioning: '',
});
// Open with a single row; the admin adds more as needed, up to MAX_ROWS.
const emptyGrid = () => [emptyRow()];

/**
 * Split pasted clipboard text into [name, acronym] pairs.
 *
 * Excel and Numbers put a tab between columns and a newline between rows, which
 * is the case worth getting right — the point of the grid is that a region can
 * paste two columns straight out of its own sheet. A single-column paste fills
 * whichever cell was focused, and CSV is accepted as a fallback for anyone
 * pasting out of a text file.
 */
function parsePaste(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map((line) => {
      const cells = line.includes('\t') ? line.split('\t') : line.split(',');
      return cells.map(c => c.trim().replace(/^"|"$/g, ''));
    });
}

export default function WbesRegistry({ currentUser }) {
  const national = isNational(currentUser);
  const { notice, notify, clearNotice, askConfirm, confirmProps } = useFeedback();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');   // national only
  const [busy, setBusy] = useState(false);

  // The grid, and the region it writes to (national only — a regional admin's
  // region is taken from their account and is not theirs to name).
  const [grid, setGrid] = useState(emptyGrid);
  const [gridRegion, setGridRegion] = useState('');

  // The national .xlsx upload.
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);

  // Blocking asks for a reason, which ConfirmDialog has nowhere to put.
  const [blocking, setBlocking] = useState(null);   // the entity being blocked
  const [blockReason, setBlockReason] = useState('');

  // Re-classifying a mis-imported acronym: the entity being edited and its form.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '', utility_type: '', generator_type: '',
    generator_subtype: '', from_date: '', date_of_commissioning: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // includeBlocked: an administrator has to see a blocked acronym to unblock it.
      setList(await getWbesEntities(search, {
        region: national ? regionFilter : undefined,
        includeBlocked: true,
      }));
    } catch (err) {
      notify('error', err.message || 'Could not load the WBES register.');
    } finally {
      setLoading(false);
    }
  }, [search, regionFilter, national, notify]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);   // debounce typing, not the first load
    return () => clearTimeout(t);
  }, [load, search]);

  // ─── The grid ──────────────────────────────────────────────────────────────

  const setCell = (rowIndex, field, value) => {
    setGrid(rows => rows.map((r, i) => (
      i === rowIndex ? { ...r, [field]: field === 'wbes_acronym' ? value.toUpperCase() : value } : r
    )));
  };

  const addRow = () => setGrid(rows => (rows.length >= MAX_ROWS ? rows : [...rows, emptyRow()]));
  // Keep at least one row so there is always something to type into.
  const removeRow = (rowIndex) =>
    setGrid(rows => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== rowIndex)));

  /**
   * Fill the grid from a paste, starting at the cell that received it.
   *
   * A paste of more rows than fit is truncated and said so, rather than
   * silently dropping the tail — someone pasting 300 rows needs to be told the
   * cap exists, not left to discover it by counting what arrived.
   */
  const handlePaste = (rowIndex, field) => (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\n') && !text.includes('\t') && !text.includes(',')) return;  // one plain value: let the browser do it
    e.preventDefault();

    const parsed = parsePaste(text);
    if (parsed.length === 0) return;

    const room = MAX_ROWS - rowIndex;
    const used = parsed.slice(0, room);

    setGrid((rows) => {
      const next = rows.map(r => ({ ...r }));
      // The grid may hold fewer rows than the paste needs — grow it to fit,
      // up to the cap.
      while (next.length < rowIndex + used.length) next.push(emptyRow());
      used.forEach((cells, n) => {
        const target = next[rowIndex + n];
        if (cells.length >= 2) {
          // Two columns: name then acronym, matching the grid's own order.
          target.name = cells[0];
          target.wbes_acronym = (cells[1] || '').toUpperCase();
        } else {
          const only = cells[0] || '';
          target[field] = field === 'wbes_acronym' ? only.toUpperCase() : only;
        }
      });
      return next;
    });

    if (parsed.length > room) {
      notify('warn', `Pasted the first ${room} of ${parsed.length} rows — ${MAX_ROWS} at a time is the limit.`);
    } else {
      clearNotice();
    }
  };

  const filledRows = grid.filter(r => r.name.trim() || r.wbes_acronym.trim());

  const submitGrid = async (e) => {
    e.preventDefault();
    clearNotice();
    setBulkResult(null);
    if (filledRows.length === 0) {
      notify('error', 'Fill in at least one row.');
      return;
    }
    if (national && !gridRegion) {
      notify('error', 'Choose the region these acronyms belong to.');
      return;
    }
    setBusy(true);
    try {
      const res = await batchRegisterWbesEntities(filledRows, national ? gridRegion : null);
      setBulkResult(res);
      notify(res.importedCount > 0 ? 'success' : 'warn',
        `${res.importedCount} added to ${res.region}, ${res.skippedCount} skipped.`);
      setGrid(emptyGrid());
      await load();
    } catch (err) {
      notify('error', err.message || 'Could not register the acronyms.');
    } finally {
      setBusy(false);
    }
  };

  // ─── The national upload ───────────────────────────────────────────────────

  const submitUpload = async (e) => {
    e.preventDefault();
    clearNotice();
    setBulkResult(null);
    if (!bulkFile) { notify('error', 'Choose an .xlsx file to upload.'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', bulkFile);
      const res = await bulkUploadWbesEntities(form);
      setBulkResult(res);
      const where = Object.keys(res.byRegion || {}).sort()
        .map(k => `${k} ${res.byRegion[k]}`).join(', ');
      notify('success',
        `${res.importedCount} added${where ? ` (${where})` : ''}, ${res.skippedCount} skipped.`);
      setBulkFile(null);
      const input = document.getElementById('wbes-file');
      if (input) input.value = '';
      await load();
    } catch (err) {
      notify('error', err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Delete and block ──────────────────────────────────────────────────────

  const confirmDelete = (entity) => {
    askConfirm({
      title: `Delete ${entity.wbes_acronym}?`,
      message: `"${entity.name}" is removed from the register for good.`,
      details: 'This is refused if any account, assignment, transfer, filed discrepancy or '
             + 'pending registration still refers to it — block it instead in that case.',
      confirmLabel: 'Delete',
      tone: 'danger',
      action: async () => {
        await deleteWbesEntity(entity.wbes_acronym);
        notify('success', `${entity.wbes_acronym} deleted.`);
        await load();
      },
    });
  };

  const confirmUnblock = (entity) => {
    askConfirm({
      title: `Unblock ${entity.wbes_acronym}?`,
      message: 'It becomes claimable again and its holder can file against it.',
      confirmLabel: 'Unblock',
      tone: 'warn',
      action: async () => {
        await setWbesEntityBlocked(entity.wbes_acronym, false);
        notify('success', `${entity.wbes_acronym} unblocked.`);
        await load();
      },
    });
  };

  const submitBlock = async (e) => {
    e.preventDefault();
    const entity = blocking;
    setBusy(true);
    try {
      await setWbesEntityBlocked(entity.wbes_acronym, true, blockReason.trim());
      setBlocking(null);
      setBlockReason('');
      notify('success', `${entity.wbes_acronym} blocked.`);
      await load();
    } catch (err) {
      notify('error', err.message || 'Could not block the acronym.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Re-classify (correct a mis-imported type) ───────────────────────────────

  // The API serialises DATE columns to ISO strings; an <input type="date"> wants
  // a bare YYYY-MM-DD.
  const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

  const openEdit = (w) => {
    setEditForm({
      name: w.name || w.plant_name || '',
      utility_type: w.utility_type || '',
      generator_type: w.generator_type || '',
      generator_subtype: w.generator_subtype || '',
      from_date: toDateInput(w.from_date),
      date_of_commissioning: toDateInput(w.date_of_commissioning),
    });
    setEditing(w);
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await updateWbesEntity(editing.wbes_acronym, {
        name: editForm.name.trim(),
        utility_type: editForm.utility_type || null,
        generator_type: editForm.generator_type || null,
        generator_subtype: editForm.generator_subtype || null,
        from_date: editForm.from_date || null,
        date_of_commissioning: editForm.date_of_commissioning || null,
      });
      setEditing(null);
      notify('success', `${res.wbes_acronym} updated — category is now ${res.energy_category}.`);
      await load();
    } catch (err) {
      notify('error', err.message || 'Could not update the acronym.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () =>
    downloadFile('/users/wbes-entities/template', 'WBES_Upload_Template.xlsx')
      .catch(err => notify('error', err.message || 'Could not download the template.'));

  // ─── Render ────────────────────────────────────────────────────────────────

  const scopeLabel = national ? 'all regions' : currentUser.region;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div className="glass-panel" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={18} /> WBES Acronym Registry — {scopeLabel}
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '15px' }}>
          {national
            ? 'Stations self-register against these, so an acronym must exist here first. Upload the '
              + 'national list and every row lands in the region its own Region column names — including '
              + 'regions that have no administrator yet.'
            : `Register the WBES acronyms your stations file against. Users self-register against these, `
              + `so an acronym must exist here first. Everything you add belongs to ${currentUser.region}.`}
        </p>

        <Banner type={notice?.type} message={notice?.message} />

        {/* ── The national .xlsx upload ───────────────────────────────────── */}
        {national && (
          <div style={{ marginBottom: '22px' }}>
            <h4 style={{ fontSize: '0.92rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileSpreadsheet size={15} /> Upload the national list
            </h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: '12px' }}>
              An <strong>.xlsx</strong> with columns <strong>Display Name</strong>,{' '}
              <strong>WBES Acronym</strong> and <strong>Region</strong> (required), plus{' '}
              <strong>Utility Type</strong> and <strong>Generator Type</strong> (recommended), in any
              order. Re-uploading re-classifies acronyms already registered.{' '}
              <button type="button" onClick={downloadTemplate}
                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                         color: 'var(--link-text)', textDecoration: 'underline', display: 'inline-flex',
                         alignItems: 'center', gap: '4px', font: 'inherit' }}>
                <FileDown size={13} /> Download a template
              </button>
            </p>
            <form onSubmit={submitUpload}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: '2 1 240px', margin: 0 }}>
                  <label htmlFor="wbes-file">Spreadsheet (.xlsx)</label>
                  <input id="wbes-file" type="file" accept=".xlsx" className="form-control"
                    onChange={(e) => setBulkFile(e.target.files?.[0] || null)} />
                </div>
                <button type="submit" className="btn btn-teal" disabled={busy || !bulkFile}>
                  <FileUp size={15} /> {busy ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── The paste grid ──────────────────────────────────────────────── */}
        <div style={national ? { borderTop: '1px solid var(--border-color)', paddingTop: '16px' } : undefined}>
          <h4 style={{ fontSize: '0.92rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={15} /> Add acronyms — up to {MAX_ROWS} at a time
          </h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: '12px' }}>
            Type them in, or copy two columns (name, then acronym) from a spreadsheet and paste
            into the first cell — the rows fill themselves. The classification columns
            (Utility Type, Generator Type, SubType and the dates) are optional; set them here or
            correct them later with Edit. The working Category is derived from the Utility Type.
          </p>

          <form onSubmit={submitGrid}>
            {national && (
              <div className="form-group" style={{ maxWidth: '280px' }}>
                <label htmlFor="wbes-grid-region">Region these belong to</label>
                <select id="wbes-grid-region" className="form-control"
                  value={gridRegion} onChange={(e) => setGridRegion(e.target.value)}>
                  <option value="">Choose a region…</option>
                  {REGIONS.map(r => <option key={r.code} value={r.code}>{r.name} ({r.code})</option>)}
                </select>
              </div>
            )}

            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflowX: 'auto' }}>
              <table className="custom-table" style={{ margin: 0, minWidth: '980px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>#</th>
                    <th style={{ minWidth: '180px' }}>Display Name</th>
                    <th style={{ minWidth: '130px' }}>WBES Acronym</th>
                    <th style={{ minWidth: '150px' }}>Utility Type</th>
                    <th style={{ minWidth: '120px' }}>Generator Type</th>
                    <th style={{ minWidth: '120px' }}>SubType</th>
                    <th style={{ minWidth: '135px' }}>From Date</th>
                    <th style={{ minWidth: '150px' }}>Date of Commissioning</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {i + 1}
                        {grid.length > 1 && (
                          <button type="button" onClick={() => removeRow(i)}
                            title="Remove this row" aria-label={`Remove row ${i + 1}`}
                            style={{ border: 'none', background: 'none', cursor: 'pointer',
                                     color: 'var(--text-muted)', padding: '0 0 0 4px', verticalAlign: 'middle' }}>
                            <X size={13} />
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input className="form-control" value={row.name}
                          aria-label={`Display name, row ${i + 1}`}
                          onChange={(e) => setCell(i, 'name', e.target.value)}
                          onPaste={handlePaste(i, 'name')}
                          placeholder={i === 0 ? 'e.g. Example Power Company Ltd' : ''} />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input className="form-control mono" value={row.wbes_acronym}
                          aria-label={`WBES acronym, row ${i + 1}`}
                          style={{ textTransform: 'uppercase' }}
                          onChange={(e) => setCell(i, 'wbes_acronym', e.target.value)}
                          onPaste={handlePaste(i, 'wbes_acronym')}
                          placeholder={i === 0 ? 'ABC' : ''} />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <select className="form-control" value={row.utility_type}
                          aria-label={`Utility type, row ${i + 1}`}
                          onChange={(e) => setCell(i, 'utility_type', e.target.value)}>
                          <option value="">—</option>
                          {UTILITY_TYPES.map(t => <option key={t} value={t}>{utilityTypeLabel(t)}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <select className="form-control" value={row.generator_type}
                          aria-label={`Generator type, row ${i + 1}`}
                          onChange={(e) => setCell(i, 'generator_type', e.target.value)}>
                          <option value="">—</option>
                          {GENERATOR_TYPES.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <select className="form-control" value={row.generator_subtype}
                          aria-label={`Generator sub-type, row ${i + 1}`}
                          onChange={(e) => setCell(i, 'generator_subtype', e.target.value)}>
                          <option value="">—</option>
                          {GENERATOR_SUBTYPES.map(t => <option key={t} value={t}>{generatorSubTypeLabel(t)}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input type="date" className="form-control" value={row.from_date}
                          aria-label={`From date, row ${i + 1}`}
                          onChange={(e) => setCell(i, 'from_date', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input type="date" className="form-control" value={row.date_of_commissioning}
                          aria-label={`Date of commissioning, row ${i + 1}`}
                          onChange={(e) => setCell(i, 'date_of_commissioning', e.target.value)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px' }}>
              <button type="submit" className="btn btn-primary" disabled={busy || filledRows.length === 0}>
                <Plus size={15} /> {busy ? 'Registering…' : `Register ${filledRows.length || ''}`.trim()}
              </button>
              <button type="button" className="btn btn-secondary"
                onClick={addRow} disabled={busy || grid.length >= MAX_ROWS}
                title={grid.length >= MAX_ROWS ? `Up to ${MAX_ROWS} rows at a time` : 'Add another row'}>
                <Plus size={15} /> Add row
              </button>
              <button type="button" className="btn btn-secondary"
                onClick={() => { setGrid(emptyGrid()); clearNotice(); }} disabled={busy}>
                Clear
              </button>
            </div>
          </form>

          {bulkResult && bulkResult.skipped?.length > 0 && (
            <div style={{ marginTop: '12px', maxHeight: '180px', overflowY: 'auto', fontSize: '0.76rem',
                          color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.04)',
                          border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 12px' }}>
              <strong>{bulkResult.skippedCount} row(s) skipped:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                {bulkResult.skipped.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
              {bulkResult.skippedCount > bulkResult.skipped.length && (
                <p style={{ margin: '6px 0 0' }}>
                  …and {bulkResult.skippedCount - bulkResult.skipped.length} more.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── The register itself ───────────────────────────────────────────── */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
          <h4 style={{ fontSize: '0.95rem', margin: 0, flex: '1 1 auto' }}>
            Registered acronyms{' '}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({list.length})</span>
          </h4>
          {national && (
            <select className="form-control" style={{ width: 'auto' }}
              value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
              <option value="">All regions</option>
              {REGIONS.map(r => <option key={r.code} value={r.code}>{r.code}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.04)',
                        padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input className="form-control" style={{ border: 'none', background: 'transparent', padding: '4px' }}
              placeholder="Search acronym or name" value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</p>
        ) : list.length === 0 ? (
          <EmptyState
            title="No acronyms registered"
            hint={search ? 'Nothing matches that search.' : `Add the acronyms ${scopeLabel} files against.`}
            icon={Building2}
          />
        ) : (
          <div className="table-container" style={{ maxHeight: '420px' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Acronym</th>
                  <th>Display Name</th>
                  <th>Type</th>
                  {national && <th>Region</th>}
                  <th>Status</th>
                  <th style={{ width: '210px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((w) => (
                  <tr key={w.wbes_acronym}>
                    <td className="mono">{w.wbes_acronym}</td>
                    <td>{w.name || w.plant_name}</td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {w.utility_type
                        ? signupTypeLabel(deriveSignupType(w.utility_type, w.generator_type))
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    {national && <td>{w.region}</td>}
                    <td>
                      {w.blocked ? (
                        <span className="status-badge status-rejected" title={w.blocked_reason || ''}>
                          Blocked
                        </span>
                      ) : (
                        <span className="status-badge status-resolved">Active</span>
                      )}
                      {w.blocked && w.blocked_reason && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                          {w.blocked_reason}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button type="button" className="btn btn-secondary"
                          style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                          onClick={() => openEdit(w)} title="Correct the type / name">
                          <Pencil size={13} /> Edit
                        </button>
                        {w.blocked ? (
                          <button type="button" className="btn btn-secondary"
                            style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                            onClick={() => confirmUnblock(w)} title="Make it usable again">
                            <RotateCcw size={13} /> Unblock
                          </button>
                        ) : (
                          <button type="button" className="btn btn-secondary"
                            style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                            onClick={() => { setBlocking(w); setBlockReason(''); }}
                            title="Freeze it — nobody can claim it and its holder cannot file against it">
                            <Ban size={13} /> Block
                          </button>
                        )}
                        <button type="button" className="btn btn-danger"
                          style={{ padding: '4px 9px', fontSize: '0.74rem' }}
                          onClick={() => confirmDelete(w)} title="Remove it — refused if anything uses it">
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Blocking asks for a reason, so it gets its own small modal rather than
          ConfirmDialog, which has nowhere to type one. */}
      {blocking && (
        <div className="modal-overlay" onClick={() => !busy && setBlocking(null)}>
          <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Block {blocking.wbes_acronym}?</h3>
              <button type="button" className="modal-close" onClick={() => setBlocking(null)}
                disabled={busy} aria-label="Close dialog"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitBlock} style={{ padding: '18px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.83rem', marginTop: 0 }}>
                It stays on record and past filings keep naming it, but nobody can claim it and
                whoever holds it can no longer file against it. You can unblock it later.
              </p>
              <div className="form-group">
                <label htmlFor="wbes-block-reason">Reason (shown to anyone who is refused)</label>
                <textarea id="wbes-block-reason" className="form-control" rows={3}
                  value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="e.g. Registered in error — duplicate of ABC" />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setBlocking(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger" disabled={busy}>
                  <Ban size={15} /> {busy ? 'Blocking…' : 'Block'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Re-classify a mis-imported acronym. Changing the Utility Type re-derives
          the working category on the server. */}
      {editing && (
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Edit {editing.wbes_acronym}</h3>
              <button type="button" className="modal-close" onClick={() => setEditing(null)}
                disabled={busy} aria-label="Close dialog"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitEdit} style={{ padding: '18px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.83rem', marginTop: 0 }}>
                Fix a wrongly-imported classification. The Utility Type decides whether this entity
                may self-register, and the working category is derived from it.
              </p>
              <div className="form-group">
                <label htmlFor="wbes-edit-name">Display name</label>
                <input id="wbes-edit-name" className="form-control" value={editForm.name}
                  onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label htmlFor="wbes-edit-util">Utility Type</label>
                <select id="wbes-edit-util" className="form-control" value={editForm.utility_type}
                  onChange={(e) => setEditForm(f => ({ ...f, utility_type: e.target.value }))}>
                  <option value="">— not set —</option>
                  {UTILITY_TYPES.map(t => <option key={t} value={t}>{utilityTypeLabel(t)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="wbes-edit-gen">Generator Type <span style={{ color: 'var(--text-muted)' }}>(for a Regional Entity, decides RE vs ISGS)</span></label>
                <select id="wbes-edit-gen" className="form-control" value={editForm.generator_type}
                  onChange={(e) => setEditForm(f => ({ ...f, generator_type: e.target.value }))}>
                  <option value="">— none —</option>
                  {GENERATOR_TYPES.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="wbes-edit-sub">Generator SubType</label>
                <select id="wbes-edit-sub" className="form-control" value={editForm.generator_subtype}
                  onChange={(e) => setEditForm(f => ({ ...f, generator_subtype: e.target.value }))}>
                  <option value="">— none —</option>
                  {GENERATOR_SUBTYPES.map(t => <option key={t} value={t}>{generatorSubTypeLabel(t)}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 160px' }}>
                  <label htmlFor="wbes-edit-from">From Date</label>
                  <input id="wbes-edit-from" type="date" className="form-control" value={editForm.from_date}
                    onChange={(e) => setEditForm(f => ({ ...f, from_date: e.target.value }))} />
                </div>
                <div className="form-group" style={{ flex: '1 1 160px' }}>
                  <label htmlFor="wbes-edit-com">Date of Commissioning</label>
                  <input id="wbes-edit-com" type="date" className="form-control" value={editForm.date_of_commissioning}
                    onChange={(e) => setEditForm(f => ({ ...f, date_of_commissioning: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Pencil size={15} /> {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
