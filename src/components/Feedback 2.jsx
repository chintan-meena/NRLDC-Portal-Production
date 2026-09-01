import { AlertCircle, CheckCircle2, Info, Inbox, RefreshCw } from 'lucide-react';

/**
 * Feedback.jsx — small presentational pieces shared across the dashboards:
 * inline banners, empty states, and loading skeletons. Each of these replaced
 * a style object that was repeated inline on nearly every screen.
 */

const BANNER_ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  warn: AlertCircle,
  info: Info,
};

/** Inline status message. Renders nothing when there is no message. */
export function Banner({ type = 'info', message, onRetry, children }) {
  if (!message && !children) return null;
  const Icon = BANNER_ICONS[type] || Info;
  return (
    <div className={`banner banner-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={17} />
      <span>{message}{children}</span>
      {onRetry && (
        <span className="banner-actions">
          <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={onRetry}>
            <RefreshCw size={13} /> Retry
          </button>
        </span>
      )}
    </div>
  );
}

/** Shown when a list has loaded successfully but contains no rows. */
export function EmptyState({ title = 'Nothing to show', hint, icon: Icon = Inbox }) {
  return (
    <div className="empty-state">
      <Icon size={34} />
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}

/**
 * Placeholder rows for a table that is still loading, so the screen does not
 * read as "no results" while a fetch is in flight.
 */
export function SkeletonRows({ rows = 5, columns = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c}>
              <div className="skeleton-line" style={{ width: c === 0 ? '40%' : `${60 + ((r + c) % 4) * 10}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
