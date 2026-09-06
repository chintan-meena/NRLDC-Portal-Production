import { useTheme } from '../hooks/useTheme';
import { useState, useEffect } from 'react';
import { Calendar, Clock, LogOut, Sun, Moon, Monitor } from 'lucide-react';
import { getConfig } from '../services/db';
import Icon from './Icon';

// One navigation tab: an in-house icon plus its label. The icon is decorative
// (aria-hidden — the visible label names the tab) and inherits the tab's color,
// so it turns white on the active tab and muted on the rest with no extra CSS.
function NavTab({ id, icon, label, activeTab, setActiveTab, title }) {
  return (
    <button
      type="button"
      className={`category-tab ${activeTab === id ? 'active' : ''}`}
      onClick={() => setActiveTab(id)}
      title={title || label}
    >
      <Icon name={icon} size={18} />
      <span className="tab-label">{label}</span>
    </button>
  );
}

export default function Navbar({ currentUser, onLogout, activeTab, setActiveTab }) {
  const { mode: themeMode, resolved, cycle } = useTheme();
  const [serverTime, setServerTime] = useState(new Date());
  const [config, setConfig] = useState({ outage_ISGS: true, outage_RE: true, outage_States: false, feature_cycle_data: true, feature_outages: true, feature_qca_status: true });

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
  // Whole pages a region can switch off in System Parameters. Each defaults to
  // on when the config row is absent, so a region that never touched the setting
  // keeps every page. When off, the tab is hidden here and the page's endpoints
  // refuse — see the matching guards in the routes.
  const isCycleDataEnabled = config.feature_cycle_data !== false && config.feature_cycle_data !== 'false';
  const isOutagesFeatureEnabled = config.feature_outages !== false && config.feature_outages !== 'false';
  const isQcaStatusEnabled = config.feature_qca_status !== false && config.feature_qca_status !== 'false';

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
          <span className="brand-subtitle">{(currentUser?.region || 'NLDC')} Energy Scheduling Platform</span>
        </div>
      </div>

      <div className="category-tabs" style={{ marginLeft: '16px', marginRight: '16px' }}>
        {isAdmin ? (
          <>
            <NavTab id="dashboard" icon="overview-dashboard" label="Overview Dashboard" activeTab={activeTab} setActiveTab={setActiveTab} />
            {currentUser.role === 'SUPERADMIN' && (
              <NavTab id="national" icon="authority" label="National Admin" title="National Administration — regions and their administrators" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            <NavTab id="requests" icon="discrepancy-requests" label="Discrepancy Requests" activeTab={activeTab} setActiveTab={setActiveTab} />
            {isOutagesFeatureEnabled && (
              <NavTab id="outages" icon="unit-outages" label="Unit Outages" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            {isCycleDataEnabled && (
              <NavTab id="cycle_downloads" icon="schedule" label="Cycle Data Downloads" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            <NavTab id="users" icon="user-registry" label="User Registry" activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavTab id="transfers" icon="transfer-requests" label="Transfer Requests" activeTab={activeTab} setActiveTab={setActiveTab} />
            {currentUser.role === 'SUPERADMIN' && (
              <NavTab id="simulation" icon="market" label="Simulation" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            {isQcaStatusEnabled && (
              <NavTab id="qca_status" icon="qca-status" label="QCA Status" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            <NavTab id="logs" icon="user-logs" label="Server Logs" activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavTab id="settings" icon="system-parameters" label="System Parameters" activeTab={activeTab} setActiveTab={setActiveTab} />
          </>
        ) : (
          <>
            <NavTab id="dashboard" icon="discrepancy-requests" label="Discrepancy Requests" activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavTab id="raise_request" icon="file-discrepancy" label="File Discrepancy" activeTab={activeTab} setActiveTab={setActiveTab} />
            {isOutageEnabled && isOutagesFeatureEnabled && (
              <NavTab id="outages" icon="unit-outages" label="Unit Outages" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            {isCycleDataEnabled && currentUser?.can_upload_cycle_data && currentUser?.role !== 'QCA' && (
              <NavTab id="cycle_upload" icon="schedule" label="Cycle Data Upload" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            {/* QCA coordination is Renewable Energy only — an ISGS or States
                user never sees the plant-portfolio tab. */}
            {currentUser?.role === 'QCA' && currentUser?.energy_category === 'RE' && (
              <NavTab id="my_plants" icon="renewable" label="My Plants" activeTab={activeTab} setActiveTab={setActiveTab} />
            )}
            <NavTab id="settings" icon="system-parameters" label="Profile Settings" activeTab={activeTab} setActiveTab={setActiveTab} />
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
                  ? `⚡ ${currentUser.region || 'NLDC'} Admin · National`
                  : currentUser.role === 'ADMIN'
                    ? `⚡ ${currentUser.region} Admin`
                    : `👤 ${currentUser.region} User`}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary theme-toggle"
              style={{ padding: '5px 8px', marginLeft: '6px' }}
              onClick={cycle}
              title={`Appearance: ${themeMode}${themeMode === 'system' ? ` (following your device — currently ${resolved})` : ''}. Click to change.`}
              aria-label={`Appearance: ${themeMode}. Click to change.`}
            >
              {themeMode === 'system' ? <Monitor size={15} /> : themeMode === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
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
