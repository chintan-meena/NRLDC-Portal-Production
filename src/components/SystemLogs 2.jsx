import { useState, useEffect, useRef } from 'react';
import { getLogs, clearLogs } from '../services/db';
import { Terminal, Trash2 } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { Banner } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';

export default function SystemLogs() {
  const isExpanded = true;
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pollError, setPollError] = useState('');
  const logsEndRef = useRef(null);
  const { notice, notify, clearNotice, askConfirm, confirmProps } = useFeedback();

  const fetchLogs = async () => {
    try {
      const data = await getLogs();
      setLogs(Array.isArray(data) ? data : []);
      setPollError('');
    } catch (err) {
      setPollError(err.message || 'Could not reach the server to refresh logs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let interval = null;

    // Poll every 3 seconds so new events appear in near real time — but only
    // while the tab is actually visible, so a backgrounded window does not
    // keep hitting the server.
    const start = () => {
      if (interval) return;
      fetchLogs();
      interval = setInterval(fetchLogs, 3000);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Scroll to bottom when expanded
  useEffect(() => {
    if (isExpanded && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isExpanded]);

  const handleClear = (e) => {
    e.stopPropagation();
    askConfirm({
      title: 'Clear system logs',
      message: 'Delete every entry from the system log?\n\nThis removes the audit trail of logins, filings and admin actions, and cannot be undone.',
      confirmLabel: 'Clear all logs',
      tone: 'danger',
      action: async () => {
        await clearLogs();
        setLogs([]);
        notify('success', 'System logs cleared.');
      },
    });
  };

  const getLogClass = (type) => {
    switch (type) {
      case 'success': return 'log-item success';
      case 'warn':    return 'log-item warn';
      case 'error':   return 'log-item error';
      default:        return 'log-item info';
    }
  };

  const formatTime = (isoString) => {
    try {
      const date = new Date(isoString);
      return date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
    } catch {
      return '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', minWidth: 0 }}>
      <ConfirmDialog {...confirmProps} />

      {notice && (
        <Banner type={notice.type} message={notice.message}>
          <button
            type="button"
            onClick={clearNotice}
            className="btn btn-secondary"
            style={{ padding: '2px 8px', fontSize: '0.7rem', marginLeft: '10px' }}
          >
            Dismiss
          </button>
        </Banner>
      )}

      <Banner type="warn" message={pollError} onRetry={fetchLogs} />

      <div className="flex-row-between">
        <div>
          <h2>System Audit & Server Logs</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            Real-time backend scheduling transactions, security events, and mail system dispatches.
          </p>
        </div>
        <button className="btn btn-danger" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={handleClear}>
          <Trash2 size={16} />
          <span>Clear Logs Database</span>
        </button>
      </div>

      <div className="table-container" style={{ padding: '24px', background: '#090d1f', border: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa', fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '15px', borderBottom: '1px solid #1e293b', paddingBottom: '10px' }}>
          <Terminal size={18} />
          <span id="log-console-title">System Console Outputs</span>
        </div>

        <div style={{
          maxHeight: '550px',
          minHeight: '400px',
          overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.82rem',
          lineHeight: '1.6',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          paddingRight: '10px'
        }}>
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 0' }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton-line" style={{ width: `${45 + (i % 5) * 11}%`, background: '#16233d' }} />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
              No system logs yet. Perform operations to see events appear here.
            </div>
          ) : (
            [...logs].reverse().map((log) => (
              <div key={log.id} className={getLogClass(log.type)}>
                <span className="log-time" style={{ color: '#64748b', marginRight: '8px' }}>[{formatTime(log.timestamp || log.created_at)}]</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
