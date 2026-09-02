import { useState } from 'react';
import { loginStep1, verifyOTP, forgotPassword, requestPasswordReset, resetPasswordWithCode } from '../services/db';
import Register from './Register';
import { ShieldCheck, ShieldAlert, KeyRound, User, Mail, MessageSquareText, HelpCircle, CheckCircle2, MonitorCheck } from 'lucide-react';
import { RULES as PASSWORD_RULES, validatePassword } from '../utils/password';

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // OTP Verification States
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [userEmail, setUserEmail] = useState('');

  // Password Recovery States
  const [forgotMode, setForgotMode] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState('');
  // 'email'  — the portal emails a short-lived reset code, which needs mail working.
  // 'admin'  — an administrator resets it by hand; the fallback when it isn't.
  const [recoveryRoute, setRecoveryRoute] = useState('email');
  const [recoveryReason, setRecoveryReason] = useState('');
  // The emailed route is two steps: ask for a code, then use it. 'request' is
  // the first screen, 'code' the second.
  const [resetStage, setResetStage] = useState('request');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetForUser, setResetForUser] = useState('');

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const res = await loginStep1(username, password);
      if (res.success) {
        if (res.requiresOTP) {
          setRequiresOtp(true);
          setUserEmail(res.email);
          // The password was right, but the code never left the building.
          if (res.mailFailed && res.error) setErrorMessage(res.error);
        } else {
          onLoginSuccess(res.user);
        }
      } else {
        setErrorMessage(res.error || 'Authentication failed');
      }
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred during login. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    if (otpCode.length !== 6 || isNaN(otpCode)) {
      setErrorMessage('Please enter a valid 6-digit OTP code.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const res = await verifyOTP(username, otpCode);
      if (res.success) {
        onLoginSuccess(res.user);
      } else {
        setErrorMessage(res.error || 'OTP verification failed');
      }
    } catch (err) {
      setErrorMessage(err.message || 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e) => {
    e.preventDefault();
    if (!recoveryUsername.trim()) {
      setErrorMessage('Please enter your Username / Station Code.');
      return;
    }

    setErrorMessage('');
    setRecoverySuccess('');
    setLoading(true);

    try {
      const res = recoveryRoute === 'admin'
        ? await requestPasswordReset(recoveryUsername, recoveryReason)
        : await forgotPassword(recoveryUsername);
      if (res.success) {
        setRecoverySuccess(res.message);
        if (recoveryRoute === 'email' && res.codeSent) {
          // Keep the username: the next step needs it, and retyping it is one
          // more chance to get it wrong.
          setResetForUser(recoveryUsername.trim());
          setResetStage('code');
        } else {
          setRecoveryUsername('');
        }
        setRecoveryReason('');
      } else {
        setErrorMessage(res.error || 'Password recovery failed');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to submit password recovery request.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (resetCode.trim().length !== 6 || !/^\d{6}$/.test(resetCode.trim())) {
      setErrorMessage('Enter the 6-digit code from the email.');
      return;
    }
    const policyError = validatePassword(newPassword);
    if (policyError) { setErrorMessage(policyError); return; }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('The two passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await resetPasswordWithCode(resetForUser, resetCode.trim(), newPassword);
      if (res.success) {
        setRecoverySuccess(res.message);
        setForgotMode(false);
        setResetStage('request');
        setResetCode(''); setNewPassword(''); setConfirmNewPassword('');
        setUsername(resetForUser);
        setRecoveryUsername('');
      } else {
        setErrorMessage(res.error || 'Could not reset your password.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Could not reset your password.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setRequiresOtp(false);
    setForgotMode(false);
    setOtpCode('');
    setRecoveryUsername('');
    setRecoverySuccess('');
    setRecoveryReason('');
    setRecoveryRoute('email');
    setResetStage('request');
    setResetCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setErrorMessage('');
  };

  if (registerMode) {
    return <Register onBackToLogin={() => { setRegisterMode(false); setErrorMessage(''); }} />;
  }

  return (
    <div className="login-container">
      <div className="login-card glass-panel">
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '15px' }}>
            <img
              src="/grid_india_logo.png"
              alt="GRID INDIA Logo"
              style={{ height: '75px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontWeight: 800 }}>RLDC</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Scheduling Discrepancy Monitoring Portal
          </p>
        </div>

        {errorMessage && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            padding: '12px',
            borderRadius: '8px',
            color: 'var(--danger-text)',
            fontSize: '0.85rem',
            marginBottom: '20px'
          }}>
            <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {recoverySuccess && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            padding: '12px',
            borderRadius: '8px',
            color: 'var(--status-resolved-text)',
            fontSize: '0.85rem',
            marginBottom: '20px'
          }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{recoverySuccess}</span>
          </div>
        )}

        {forgotMode && resetStage === 'code' ? (
          <form onSubmit={handleResetSubmit}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)', marginBottom: '10px' }}>
                <KeyRound size={20} />
              </div>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Choose a new password</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Enter the code emailed to the address registered for{' '}
                <strong className="mono">{resetForUser}</strong>, then pick your new password.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="reset-code">6-digit code</label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                maxLength="6"
                className="form-control"
                placeholder="123456"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                disabled={loading}
                autoFocus
                style={{ letterSpacing: '8px', fontSize: '1.2rem', textAlign: 'center', fontWeight: 'bold' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reset-password">New password</label>
              <input id="reset-password" type="password" className="form-control"
                value={newPassword} autoComplete="new-password" disabled={loading}
                onChange={(e) => setNewPassword(e.target.value)} />
              {newPassword && (
                <ul className="password-rules">
                  {PASSWORD_RULES.map(rule => {
                    const met = rule.test(newPassword);
                    return (
                      <li key={rule.label} className={met ? 'met' : ''}>
                        <span aria-hidden="true">{met ? '✓' : '○'}</span> {rule.label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="reset-confirm">Confirm new password</label>
              <input id="reset-confirm" type="password" className="form-control"
                value={confirmNewPassword} autoComplete="new-password" disabled={loading}
                onChange={(e) => setConfirmNewPassword(e.target.value)} />
              {confirmNewPassword && newPassword !== confirmNewPassword && (
                <small style={{ color: 'var(--danger-text)', fontSize: '0.75rem' }}>The two passwords do not match.</small>
              )}
            </div>

            <button type="submit" className="btn btn-teal" style={{ width: '100%', padding: '12px', marginBottom: '12px' }} disabled={loading}>
              {loading ? 'Setting your password…' : 'Set new password'}
            </button>

            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: '10px' }} onClick={handleBackToLogin} disabled={loading}>
              Back to Sign In
            </button>
          </form>
        ) : forgotMode ? (
          <form onSubmit={handleRecoverySubmit}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warn-strong)', marginBottom: '10px' }}>
                <HelpCircle size={20} />
              </div>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Password Recovery</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Enter your username, then choose how you would like it reset.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="recovery-username">Username / Station Code</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="recovery-username"
                  type="text"
                  className="form-control"
                  placeholder="e.g. acronym@rldc"
                  value={recoveryUsername}
                  onChange={(e) => setRecoveryUsername(e.target.value)}
                  disabled={loading}
                  style={{ paddingLeft: '40px' }}
                />
                <User size={16} style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--text-muted)' }} />
              </div>
            </div>

            {/* Two routes, because the emailed one is useless precisely when
                mail is the thing that has failed. */}
            <div className="recovery-routes">
              <button
                type="button"
                className={`recovery-route ${recoveryRoute === 'email' ? 'is-selected' : ''}`}
                aria-pressed={recoveryRoute === 'email'}
                onClick={() => setRecoveryRoute('email')}
                disabled={loading}
              >
                <Mail size={16} />
                <span className="recovery-route-title">Email me a reset code</span>
                <span className="recovery-route-hint">A 6-digit code, then you choose your own password.</span>
              </button>

              <button
                type="button"
                className={`recovery-route ${recoveryRoute === 'admin' ? 'is-selected' : ''}`}
                aria-pressed={recoveryRoute === 'admin'}
                onClick={() => setRecoveryRoute('admin')}
                disabled={loading}
              >
                <ShieldCheck size={16} />
                <span className="recovery-route-title">Ask an administrator to reset it</span>
                <span className="recovery-route-hint">Use this if email is not reaching you. An admin resets it by hand.</span>
              </button>
            </div>

            {recoveryRoute === 'admin' && (
              <div className="form-group">
                <label htmlFor="recovery-reason">
                  Message for the administrator <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  id="recovery-reason"
                  className="form-control"
                  rows="2"
                  placeholder="e.g. Not receiving OTP emails since Monday"
                  value={recoveryReason}
                  onChange={(e) => setRecoveryReason(e.target.value)}
                  disabled={loading}
                  style={{ fontSize: '0.82rem' }}
                />
              </div>
            )}

            <button type="submit" className="btn btn-teal" style={{ width: '100%', padding: '12px', marginBottom: '12px' }} disabled={loading}>
              {loading
                ? 'Submitting...'
                : recoveryRoute === 'admin' ? 'Send request to administrator' : 'Email me a reset code'}
            </button>

            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: '10px' }} onClick={handleBackToLogin} disabled={loading}>
              Back to Sign In
            </button>
          </form>
        ) : !requiresOtp ? (
          <form onSubmit={handleCredentialsSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username / Station Code</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="username"
                  type="text"
                  className="form-control"
                  placeholder="e.g. acronym@rldc or admin@nldc"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  style={{ paddingLeft: '40px' }}
                />
                <User size={16} style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--text-muted)' }} />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  style={{ paddingLeft: '40px' }}
                />
                <KeyRound size={16} style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--text-muted)' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', fontSize: '0.75rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                <ShieldCheck size={14} style={{ color: 'var(--accent-teal)' }} />
                <span>MFA Enabled</span>
              </span>
              <button
                type="button"
                onClick={() => { setForgotMode(true); setErrorMessage(''); setRecoverySuccess(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: '600', padding: 0 }}
              >
                Forgot Password?
              </button>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={loading}>
              {loading ? 'Authenticating...' : 'Validate Credentials'}
            </button>

            <div className="login-register-prompt">
              <span>Don&apos;t have an account yet?</span>
              <button
                type="button"
                onClick={() => { setRegisterMode(true); setErrorMessage(''); }}
              >
                Register for access
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)', marginBottom: '10px' }}>
                <Mail size={20} />
              </div>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Enter OTP Code</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                A 6-digit OTP code has been dispatched to <strong>{userEmail}</strong>.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="otp">One-Time Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="otp"
                  type="text"
                  maxLength="6"
                  className="form-control"
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  disabled={loading}
                  style={{ paddingLeft: '40px', letterSpacing: '8px', fontSize: '1.2rem', textAlign: 'center', fontWeight: 'bold' }}
                />
                <MessageSquareText size={16} style={{ position: 'absolute', left: '14px', top: '16px', color: 'var(--text-muted)' }} />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center', display: 'block' }}>
                The code expires in 5 minutes. Not arriving? Use <strong>Forgot Password</strong> on the sign-in screen to ask an administrator for help.
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-teal)', marginTop: '8px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <MonitorCheck size={14} />
                <span>Once verified, this browser will not be asked again for a week.</span>
              </span>
            </div>

            <button type="submit" className="btn btn-teal" style={{ width: '100%', padding: '12px', marginBottom: '12px' }} disabled={loading}>
              {loading ? 'Verifying OTP...' : 'Verify & Log In'}
            </button>

            <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: '10px' }} onClick={handleBackToLogin} disabled={loading}>
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
