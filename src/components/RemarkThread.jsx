import { formatDateDMYHM } from '../utils/format';

/**
 * RemarkThread — the read-only history of a discrepancy's remarks.
 *
 * Every filing, RLDC decision, consent step and re-raise appends one dated
 * entry to `remark_history` on the server. Nobody edits a past entry; this just
 * renders them in order so both the filer and the RLDC can read the whole
 * exchange. The filer sees their own remarks and the RLDC's feedback; neither
 * can change what was already said.
 */

const KIND_LABEL = {
  filed: 'Filed',
  reraised: 'Re-raised',
  returned: 'Returned by RLDC',
  rejected: 'Rejected by RLDC',
  resolved: 'Resolved by RLDC',
  consented: 'Consent given',
  denied: 'Consent denied',
};

const isAdmin = (role) => role === 'ADMIN' || role === 'SUPERADMIN';

export default function RemarkThread({ history, title = 'Remarks & history' }) {
  const items = Array.isArray(history) ? history.filter((e) => e && (e.text || e.kind)) : [];
  if (items.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '8px', fontWeight: 600 }}>
        {title}
      </span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((e, i) => (
          <li
            key={i}
            style={{
              borderLeft: `3px solid ${isAdmin(e.role) ? 'var(--warn-strong)' : 'var(--accent-blue)'}`,
              background: 'var(--bg-tertiary)',
              borderRadius: '4px',
              padding: '8px 10px',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
              <strong style={{ color: isAdmin(e.role) ? 'var(--warn-text)' : 'var(--link-text)' }}>
                {KIND_LABEL[e.kind] || e.kind}
              </strong>
              {e.by ? ` · ${e.by}` : ''}{e.at ? ` · ${formatDateDMYHM(e.at)}` : ''}
            </div>
            {e.text && (
              <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.text}</div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
