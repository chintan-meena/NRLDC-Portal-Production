import { useCallback, useState } from 'react';

/**
 * useFeedback — in-app replacements for alert() and confirm().
 *
 * `notice` drives a <Banner>; `confirm` drives a <ConfirmDialog>. Both are
 * plain state so the dashboards can render them wherever they belong on the
 * page instead of interrupting the browser.
 */
export function useFeedback() {
  const [notice, setNotice] = useState(null);        // { type, message }
  const [request, setRequest] = useState(null);      // { title, message, confirmLabel, tone, action }
  const [busy, setBusy] = useState(false);

  /** Show an inline message. type: 'error' | 'success' | 'warn' | 'info'. */
  const notify = useCallback((type, message) => {
    if (!message) return;
    setNotice({ type, message });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  /**
   * Ask the user to confirm before running `action`. The dialog stays open and
   * disabled while the action is in flight, so it cannot be double-submitted.
   */
  const askConfirm = useCallback((opts) => {
    setNotice(null);
    setRequest(opts);
  }, []);

  const cancelConfirm = useCallback(() => {
    setBusy((b) => {
      if (!b) setRequest(null);
      return b;
    });
  }, []);

  const acceptConfirm = useCallback(async () => {
    if (!request?.action) { setRequest(null); return; }
    setBusy(true);
    try {
      await request.action();
      setRequest(null);
    } catch (err) {
      setRequest(null);
      setNotice({ type: 'error', message: err.message || 'The action could not be completed.' });
    } finally {
      setBusy(false);
    }
  }, [request]);

  /** Spread straight onto <ConfirmDialog {...confirmProps} />. */
  const confirmProps = {
    open: !!request,
    title: request?.title,
    message: request?.message,
    confirmLabel: request?.confirmLabel,
    tone: request?.tone,
    busy,
    onConfirm: acceptConfirm,
    onCancel: cancelConfirm,
  };

  return { notice, notify, clearNotice, askConfirm, confirmProps };
}
