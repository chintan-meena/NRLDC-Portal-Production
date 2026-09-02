import { useState, useEffect, useRef, useId } from 'react';
import { searchWbesDirectory } from '../services/db';
import { Search, Loader2, AlertCircle } from 'lucide-react';

/**
 * AcronymPicker — type-ahead over the national WBES entity register.
 *
 * A trader naming the other side of a trade has to reach entities their own
 * centre does not despatch, and there are thousands of them. A dropdown would
 * be unusable and a free-text box would produce filings against acronyms that
 * do not exist, so this is a search box that only settles on a real row.
 *
 * It keeps the typed text and the confirmed choice apart on purpose. `value`
 * changes only when a row is picked; typing something that resembles an
 * acronym but was never in the list leaves `value` empty, and the form refuses
 * to submit. That is the whole point — the server checks the acronym too, but
 * finding out at submit time is a worse way to learn it.
 */
export default function AcronymPicker({
  label, value, onChange, region, placeholder = 'Search by acronym or name…', disabled, hint,
}) {
  const id = useId();
  const [term, setTerm] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  // Every search is numbered, so a slow early response cannot overwrite the
  // results of a later, faster one.
  const latest = useRef(0);

  // Changing the region changes which acronyms are valid, so the parent
  // remounts this with key={region} and the box starts empty again. Doing it
  // that way rather than with an effect keeps the reset in one place — the
  // side of the form that owns both fields — instead of the child reaching
  // back to clear its parent's state.
  useEffect(() => {
    const typed = term.trim();
    const ticket = ++latest.current;

    // Debounced: a trader types five or six characters, and a request per
    // keystroke would be five or six searches to answer one question. Every
    // state change happens inside the timer, never in the effect body, so a
    // keystroke does not cascade a render before the search has even run.
    const timer = setTimeout(async () => {
      if (typed.length < 2 || typed === value) { setResults([]); setOpen(false); return; }
      setBusy(true); setError('');
      try {
        const rows = await searchWbesDirectory(typed, region);
        if (ticket !== latest.current) return;
        setResults(rows); setOpen(true); setActive(-1);
      } catch (err) {
        if (ticket === latest.current) setError(err.message || 'Could not search the register.');
      } finally {
        if (ticket === latest.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term, region, value]);

  // Clicking away closes the list without choosing anything.
  useEffect(() => {
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (row) => {
    onChange(row.wbes_acronym);
    setTerm(row.wbes_acronym);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const settled = value && term === value;

  return (
    <div className="form-group acronym-picker" ref={boxRef}>
      <label htmlFor={id}>{label}</label>
      <div className="acronym-picker-input">
        <Search size={14} />
        <input
          id={id}
          className="form-control mono"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          value={term}
          disabled={disabled}
          placeholder={disabled ? 'Choose a region first' : placeholder}
          onChange={(e) => { setTerm(e.target.value); if (value) onChange(''); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {busy && <Loader2 size={14} className="spin" />}
      </div>

      {open && results.length > 0 && (
        <ul className="acronym-options" id={`${id}-list`} role="listbox">
          {results.map((r, i) => (
            <li key={r.wbes_acronym} role="option" aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}>
              <span className="mono">{r.wbes_acronym}</span>
              <span className="acronym-option-name">{r.name}</span>
              <span className="region-badge">{r.region}</span>
            </li>
          ))}
        </ul>
      )}

      {open && !busy && results.length === 0 && term.trim().length >= 2 && (
        <ul className="acronym-options" id={`${id}-list`}>
          <li className="acronym-empty">
            No entity matches “{term.trim()}”{region ? ` in ${region}` : ''}.
          </li>
        </ul>
      )}

      {error && <span className="settings-field-hint error"><AlertCircle size={12} /> {error}</span>}
      {!error && !settled && term.trim().length > 0 && (
        <span className="settings-field-hint warn">
          <AlertCircle size={12} /> Pick an entity from the list — typing the acronym is not enough.
        </span>
      )}
      {!error && settled && hint && <span className="settings-field-hint">{hint}</span>}
    </div>
  );
}
