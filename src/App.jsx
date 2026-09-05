import { useState, useEffect, lazy, Suspense } from 'react';
import { initDB, logout } from './services/db';
import Login from './components/Login';
import Navbar from './components/Navbar';

// The three heavy screens are code-split so they load on demand rather than
// riding in the initial bundle. A plant user never downloads the admin
// dashboards, and vice versa; the login screen paints without any of them.
const UserDashboard = lazy(() => import('./components/UserDashboard'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const SystemLogs = lazy(() => import('./components/SystemLogs'));

// Shown for the moment a lazy screen's chunk is being fetched. Deliberately
// quiet — a couple of shimmer lines rather than a spinner that flashes and goes.
function ScreenFallback() {
  return (
    <div className="dashboard-layout" aria-busy="true">
      <div className="skeleton-line" style={{ width: '40%', height: '18px' }} />
      <div className="skeleton-line" style={{ width: '100%', height: '120px' }} />
      <div className="skeleton-line" style={{ width: '100%', height: '240px' }} />
    </div>
  );
}

// Both administer; they differ in reach, not in which screens they get.
const ADMIN_ROLES = ['ADMIN', 'SUPERADMIN'];

// The browser tab. This SPA has no router — the active screen is `activeTab`
// state — so nothing ever updated document.title and every screen showed the
// same static title. Wording mirrors the Navbar labels so the tab names the
// screen you are actually on. Two tabs read differently by role.
const BASE_TITLE = 'NRLDC Portal';
const SCREEN_TITLES = {
  national: 'National Administration',
  requests: 'Discrepancy Requests',
  outages: 'Unit Outages',
  cycle_downloads: 'Cycle Data',
  cycle_upload: 'Cycle Data Upload',
  users: 'User Registry',
  transfers: 'Transfer Requests',
  simulation: 'Simulation',
  qca_status: 'QCA Status',
  logs: 'Server Logs',
  raise_request: 'File Discrepancy',
  my_plants: 'My Plants',
};

function screenTitle(activeTab, role) {
  const isAdmin = ADMIN_ROLES.includes(role);
  if (activeTab === 'dashboard') return isAdmin ? 'Overview' : 'Discrepancy Requests';
  if (activeTab === 'settings') return isAdmin ? 'System Parameters' : 'Profile Settings';
  return SCREEN_TITLES[activeTab] || null;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [, setDbInitialized] = useState(false);

  useEffect(() => {
    // No-op now (DB is managed by backend), but kept for compatibility
    initDB();
    Promise.resolve().then(() => setDbInitialized(true));

    // Resume session from localStorage if exists
    // A cached user is only usable alongside a session token — otherwise the
    // session predates token auth, or the token was cleared on expiry.
    const cachedUser = localStorage.getItem('nrldc_session_user');
    const hasToken = !!localStorage.getItem('nrldc_session_token');
    if (cachedUser && !hasToken) {
      localStorage.removeItem('nrldc_session_user');
    } else if (cachedUser) {
      try {
        const parsed = JSON.parse(cachedUser);
        Promise.resolve().then(() => {
          setCurrentUser(parsed);
          if (ADMIN_ROLES.includes(parsed.role)) {
            setActiveTab('requests');
          } else {
            setActiveTab('dashboard');
          }
        });
      } catch {
        localStorage.removeItem('nrldc_session_user');
      }
    }
  }, []);

  // Keep the browser tab's title in step with the screen the user is on.
  useEffect(() => {
    const screen = currentUser ? screenTitle(activeTab, currentUser.role) : 'Sign in';
    document.title = screen ? `${screen} · ${BASE_TITLE}` : BASE_TITLE;
  }, [activeTab, currentUser]);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    // Cache session
    localStorage.setItem('nrldc_session_user', JSON.stringify(user));
    if (ADMIN_ROLES.includes(user.role)) {
      setActiveTab('requests');
    } else {
      setActiveTab('dashboard');
    }
  };

  const handleLogout = async () => {
    // Revoke the token server-side first, then drop the local session.
    await logout();
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  return (
    <div className="app-container">
      {!currentUser ? (
        <Login onLoginSuccess={handleLoginSuccess} />
      ) : (
        <>
          <Navbar
            currentUser={currentUser}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onLogout={handleLogout}
          />
          <main className="main-content">
            <Suspense fallback={<ScreenFallback />}>
              {ADMIN_ROLES.includes(currentUser.role) ? (
                <>
                  {activeTab === 'logs' ? (
                    <div className="dashboard-layout">
                      <SystemLogs />
                    </div>
                  ) : (
                    <AdminDashboard
                      currentUser={currentUser}
                      onUserUpdate={setCurrentUser}
                      activeTab={activeTab}
                      setActiveTab={setActiveTab}
                    />
                  )}
                </>
              ) : (
                // User views
                <UserDashboard
                  currentUser={currentUser}
                  onUserUpdate={setCurrentUser}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                />
              )}
            </Suspense>
          </main>
        </>
      )}
    </div>
  );
}
