import { useEffect, useRef } from 'react';

/**
 * useModalDismiss — Escape closes an open dialog, and the page behind it stops
 * scrolling while it is open.
 *
 * The portal's modals could previously only be dismissed with the × button:
 * Escape did nothing, and the list behind them kept scrolling under the
 * overlay. ConfirmDialog handles this itself; this hook covers the others.
 *
 *   useModalDismiss(!!selectedRequest, () => setSelectedRequest(null));
 */
export function useModalDismiss(isOpen, onClose) {
  // Callers pass an inline arrow, which is a new function on every render.
  // Keeping it in a ref means the listener is bound once per open, rather than
  // torn down and re-added on each keystroke elsewhere on the page.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);
}
