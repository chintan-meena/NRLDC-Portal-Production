import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * ErrorBoundary — a last line of defence for a render-time crash.
 *
 * Without one, a single thrown error anywhere in the tree unmounts the whole
 * app and leaves a blank white screen — no navbar, no way back — which in a
 * control-room portal means the operator is simply stuck. This catches the
 * throw, logs it (the backend still has system_logs for the API side), and
 * shows a recover-by-reload panel instead of nothing.
 *
 * A class component on purpose: getDerivedStateFromError / componentDidCatch
 * have no hook equivalent, so this is the one place a class is still required.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Nothing to phone home to on the client; leave a trace in the console for
    // whoever is looking. The API layer logs its own failures server-side.
    console.error('UI crash caught by ErrorBoundary:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="dashboard-layout" role="alert">
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', maxWidth: '520px', margin: '48px auto' }}>
          <AlertTriangle size={40} style={{ color: 'var(--danger-text)', marginBottom: '12px' }} />
          <h2 style={{ marginBottom: '8px' }}>Something went wrong on this screen.</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '20px' }}>
            The portal hit an unexpected error while drawing this page. Your data is
            safe — nothing was submitted. Reload to continue.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload the portal
          </button>
        </div>
      </div>
    );
  }
}
