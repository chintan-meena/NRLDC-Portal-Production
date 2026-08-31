import { useState, useEffect } from 'react';
import { initDB, logout } from './services/db';
import Login from './components/Login';
import Navbar from './components/Navbar';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';
import SystemLogs from './components/SystemLogs';

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
          if (parsed.role === 'ADMIN') {
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

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    // Cache session
    localStorage.setItem('nrldc_session_user', JSON.stringify(user));
    if (user.role === 'ADMIN') {
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
            {currentUser.role === 'ADMIN' ? (
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
          </main>
        </>
      )}
    </div>
  );
}
