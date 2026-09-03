import { useState } from 'react';
import { createNewAcronymRequest } from '../services/db';
import { Banner } from './Feedback';
import {
  UTILITY_TYPES, GENERATOR_TYPES, GENERATOR_SUBTYPES,
  utilityTypeLabel, generatorSubTypeLabel,
} from '../utils/wbesTypes';
import { FilePlus2 } from 'lucide-react';

/**
 * RequestNewPlant — a QCA asks its RLDC to register a brand-new plant / WBES id
 * and place it under itself. The acronym does not exist yet, so this is not a
 * claim on the register but a request to create the entry; an admin approves it,
 * which creates the acronym and opens the assignment in one step.
 *
 * `currentUser` is the QCA making the request — the plant is requested under it.
 */
export default function RequestNewPlant({ currentUser, onSubmitted }) {
  const empty = {
    wbes_acronym: '', name: '',
    utility_type: 'REGIONAL_ENTITY', generator_type: 'RENEWABLE', generator_subtype: '',
    from_date: '', date_of_commissioning: '',
  };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field, value) => setForm(f => ({
    ...f, [field]: field === 'wbes_acronym' ? value.toUpperCase() : value,
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.wbes_acronym.trim()) { setError('Enter the proposed WBES acronym / id.'); return; }
    if (!form.name.trim()) { setError('Enter the plant name.'); return; }
    setBusy(true);
    try {
      const res = await createNewAcronymRequest({
        ...form,
        wbes_acronym: form.wbes_acronym.trim().toUpperCase(),
        name: form.name.trim(),
        // The plant is requested under this QCA.
        requested_qca_username: currentUser.username,
        effective_date: form.from_date || null,
      });
      setSuccess(`Request #${res.requestId} submitted. It is now pending ${currentUser.region} Admin approval.`);
      setForm(empty);
      if (onSubmitted) onSubmitted();
    } catch (err) {
      setError(err.message || 'Could not submit the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '25px' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <FilePlus2 size={17} /> Request a new plant / WBES id
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '15px' }}>
        If a plant you coordinate is not yet on the register, request its WBES id here. Your RLDC
        approves it, which registers the plant and places it under you. Renewable plants only.
      </p>

      <Banner type="error" message={error} />
      <Banner type="success" message={success} />

      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-acr">Proposed WBES acronym <span style={{ color: 'var(--danger-text)' }}>*</span></label>
            <input id="np-acr" className="form-control mono" style={{ textTransform: 'uppercase' }}
              value={form.wbes_acronym} onChange={(e) => set('wbes_acronym', e.target.value)}
              placeholder="e.g. THAR_SOLAR_2" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-name">Plant name <span style={{ color: 'var(--danger-text)' }}>*</span></label>
            <input id="np-name" className="form-control" value={form.name}
              onChange={(e) => set('name', e.target.value)} placeholder="e.g. Thar Solar Park Unit 2" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-util">Utility Type</label>
            <select id="np-util" className="form-control" value={form.utility_type}
              onChange={(e) => set('utility_type', e.target.value)}>
              {UTILITY_TYPES.filter(t => t !== 'QCA').map(t => <option key={t} value={t}>{utilityTypeLabel(t)}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-gen">Generator Type</label>
            <select id="np-gen" className="form-control" value={form.generator_type}
              onChange={(e) => set('generator_type', e.target.value)}>
              {GENERATOR_TYPES.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-sub">Generator SubType</label>
            <select id="np-sub" className="form-control" value={form.generator_subtype}
              onChange={(e) => set('generator_subtype', e.target.value)}>
              <option value="">—</option>
              {GENERATOR_SUBTYPES.map(t => <option key={t} value={t}>{generatorSubTypeLabel(t)}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-from">From Date</label>
            <input id="np-from" type="date" className="form-control" value={form.from_date}
              onChange={(e) => set('from_date', e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="np-com">Date of Commissioning</label>
            <input id="np-com" type="date" className="form-control" value={form.date_of_commissioning}
              onChange={(e) => set('date_of_commissioning', e.target.value)} />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ marginTop: '16px' }}>
          <FilePlus2 size={15} /> {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </form>
    </div>
  );
}
