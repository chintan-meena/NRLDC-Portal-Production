import { useState, useEffect } from 'react';
import { Calendar, Clock, LogOut } from 'lucide-react';
import { getConfig } from '../services/db';

export default function Navbar({ currentUser, onLogout, activeTab, setActiveTab }) {
  const [serverTime, setServerTime] = useState(new Date());
  const [config, setConfig] = useState({ outage_ISGS: true, outage_RE: true, outage_States: false, feature_cycle_data: true });

  useEffect(() => {
    const timer = setInterval(() => {
      setServerTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Config decides which tabs exist, so re-read it whenever the admin moves
  // between tabs. Saving System Parameters clears the cached copy, so leaving
  // that screen is enough for a switched-off feature to disappear from the bar
  // without needing a reload.
  useEffect(() => {
    getConfig()
      .then(cfg => {
        if (cfg) setConfig(cfg);
      })
      .catch(err => console.error('Navbar config load failed:', err.message));
  }, [activeTab]);

  const formatServerTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatTodayDate = () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`;
  };

  const getInitials = (name) => {
    return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'US';
  };

  const isAdmin = currentUser && ['ADMIN', 'SUPERADMIN'].includes(currentUser.role);

  // Check if current user is allowed to see the outages filing tab
  const userCat = currentUser?.energy_category;
  // QCA users should not be allowed to file outages as they represent coordinating agencies, not plants
  // Cycle Data can be switched off entirely from System Parameters.
  const isCycleDataEnabled = config.feature_cycle_data !== false && config.feature_cycle_data !== 'false';

  const isOutageEnabled = isAdmin || (
    currentUser?.role !== 'QCA' && (
      userCat === 'ISGS' && (config.outage_ISGS === true || config.outage_ISGS === 'true') ||
      userCat === 'RE' && (config.outage_RE === true || config.outage_RE === 'true') ||
      userCat === 'States' && (config.outage_States === true || config.outage_States === 'true')
    )
  );

  return (
    <nav className="navbar">
      <div className="logo-container">
        <img
          src="/grid_india_logo.png"
          alt="GRID-INDIA Logo"
          className="logo-img"
          style={{ height: '42px', width: 'auto', objectFit: 'contain' }}
        />
        <div className="brand-details">
          <span className="brand-title">GRID-INDIA</span>
          <span className="brand-subtitle">NRLDC Energy Scheduling Platform</span>
        </div>
      </div>

      <div className="category-tabs" style={{ marginLeft: '16px', marginRight: '16px' }}>
        {isAdmin ? (
          <>
            <button
              className={`category-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')} title="Overview Dashboard"
            >
              Overview Dashboard
            </button>
            <button
              className={`category-tab ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')} title="Discrepancy Requests"
            >
              Discrepancy Requests
            </button>
            <button
              className={`category-tab ${activeTab === 'outages' ? 'active' : ''}`}
              onClick={() => setActiveTab('outages')} title="Unit Outages"
            >
              Unit Outages
            </button>
            {isCycleDataEnabled && (
              <button
                className={`category-tab ${activeTab === 'cycle_downloads' ? 'active' : ''}`}
                onClick={() => setActiveTab('cycle_downloads')} title="Cycle Data Downloads"
              >
                Cycle Data Downloads
              </button>
            )}
            <button
              className={`category-tab ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')} title="User Registry"
            >
              User Registry
            </button>
            <button
              className={`category-tab ${activeTab === 'transfers' ? 'active' : ''}`}
              onClick={() => setActiveTab('transfers')} title="Transfer Requests"
            >
              Transfer Requests
            </button>
            <button
              className={`category-tab ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')} title="Server Logs"
            >
              Server Logs
            </button>
            <button
              className={`category-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')} title="System Parameters"
            >
              System Parameters
            </button>
          </>
        ) : (
          <>
            <button
              className={`category-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')} title="Discrepancy Requests"
            >
              Discrepancy Requests
            </button>
            <button
              className={`category-tab ${activeTab === 'raise_request' ? 'active' : ''}`}
              onClick={() => setActiveTab('raise_request')} title="File Discrepancy"
            >
              File Discrepancy
            </button>
            {isOutageEnabled && (
              <button
                className={`category-tab ${activeTab === 'outages' ? 'active' : ''}`}
                onClick={() => setActiveTab('outages')} title="Unit Outages"
              >
                Unit Outages
              </button>
            )}
            {isCycleDataEnabled && currentUser?.can_upload_cycle_data && currentUser?.role !== 'QCA' && (
              <button
                className={`category-tab ${activeTab === 'cycle_upload' ? 'active' : ''}`}
                onClick={() => setActiveTab('cycle_upload')} title="Cycle Data Upload"
              >
                Cycle Data Upload
              </button>
            )}
            {/* QCA coordination is Renewable Energy only — an ISGS or States
                user never sees the plant-portfolio tab. */}
            {currentUser?.role === 'QCA' && currentUser?.energy_category === 'RE' && (
              <button
                className={`category-tab ${activeTab === 'my_plants' ? 'active' : ''}`}
                onClick={() => setActiveTab('my_plants')} title="My Plants"
              >
                My Plants
              </button>
            )}
            <button
              className={`category-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')} title="Profile Settings"
            >
              Profile Settings
            </button>
          </>
        )}
      </div>

      <div className="nav-meta">
        <div className="nav-meta-dates">
          <div className="meta-item working-date-meta" title="Working Date">
            <Calendar size={12} className="meta-icon" />
            <span>Working: <strong>{formatTodayDate()}</strong></span>
          </div>
          <div className="meta-item server-time-meta" title="Server Time">
            <span className="pulse-dot"></span>
            <Clock size={12} className="meta-icon" />
            <span><strong>{formatServerTime(serverTime)}</strong></span>
          </div>
        </div>

        {currentUser && (
          <div className="user-profile-menu">
            <div className="user-avatar" title={currentUser.name}>
              {getInitials(currentUser.name)}
            </div>
            <div className="user-info">
              <span className="username-label">{currentUser.username}</span>
              <span className="user-role-badge">
                {currentUser.role === 'SUPERADMIN'
                  ? `⚡ ${currentUser.region} Admin · National`
                  : currentUser.role === 'ADMIN'
                    ? `⚡ ${currentUser.region} Admin`
                    : `👤 ${currentUser.region} User`}
              </span>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}
              onClick={onLogout}
              title="Logout"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
