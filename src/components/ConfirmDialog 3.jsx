import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * ConfirmDialog — in-app replacement for window.confirm().
 *
 * Native confirm() blocks the whole browser, cannot be styled, and reads as a
 * browser chrome dialog rather than part of the portal. This uses the app's
 * existing modal styling, traps initial focus on the confirm button, and
 * closes on Escape.
 *
 * Render it unconditionally and drive it with `open` so the exit stays mounted.
 */
export default function ConfirmDialog({
  open,
  title = 'Please confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',          // 'danger' | 'warn'
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}
    >
      <div className="glass-panel modal-content modal-confirm">
        <div className="modal-header">
          <h3 id="confirm-dialog-title" className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <AlertTriangle size={18} className={tone === 'warn' ? 'modal-icon-warn' : 'modal-icon-danger'} />
            {title}
          </h3>
          <button type="button" className="modal-close" onClick={onCancel} disabled={busy}>
            <X size={18} />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <p className="modal-message">{message}</p>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'warn' ? 'btn btn-warning' : 'btn btn-danger'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
