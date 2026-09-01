import { useState } from 'react';
import { registerAccount } from '../services/db';
import { RULES as PASSWORD_RULES, validatePassword } from '../utils/password';
import { defaultUsernameFor } from '../utils/usernames';
import { REGIONS } from '../utils/regions';
import { Banner } from './Feedback';
import { categoryLabel } from '../utils/categories';
import { UserPlus, ArrowLeft, CheckCircle2, Building2, Lock } from 'lucide-react';

/**
 * Register — self-service sign-up.
 *
 * Submitting does not create an account; it queues a request an NRLDC
 * administrator has to approve. The admin can correct the details before
 * approving, so a typo here is not fatal — but the acronym is what ties the
 * account to its plant, so the form still asks for care.
 *
 * The username follows from the WBES acronym (DADRI → dadri@nrldc), matching
 * every account already in the registry. It is filled in as the acronym is
 * typed and stops following once the applicant edits it themselves.
 */
export default function Register({ onBackToLogin }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [accountType, setAccountType] = useState('USER');   // USER | QCA
  const [energyCategory, setEnergyCategory] = useState('ISGS');
  const [wbesAcronym, setWbesAcronym] = useState('');
  // Which despatch centre reviews this application, and will administer the
  // account afterwards.
  const [region, setRegion] = useState('NRLDC');
  // Once the applicant types their own username, the acronym stops driving it.
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [qcaName, setQcaName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleAcronymChange = (raw) => {
    const next = raw.toUpperCase();
    setWbesAcronym(next);
    if (!usernameEdited) setUsername(defaultUsernameFor(next));
  };

  const handleUsernameChange = (raw) => {
    setUsername(raw);
    // Clearing the field hands control back to the acronym.
    setUsernameEdited(raw.trim() !== '');
  };

  const isQca = accountType === 'QCA';
  // QCAs coordinate Renewable Energy plants only, so the category is fixed.
  const effectiveCategory = isQca ? 'RE' : energyCategory;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !username.trim() || !email.trim() || !wbesAcronym.trim()) {
      setError('Please fill in your name, username, email and WBES acronym.');
      return;
    }
    if (isQca && !qcaName.trim()) {
      setError('Enter the name of your coordinating agency.');
      return;
    }
    const policyError = validatePassword(password);
    if (policyError) { setError(policyError); return; }
    if (password !== confirmPassword) { setError('The two passwords do not match.'); return; }

    setSubmitting(true);
    try {
      const res = await registerAccount({
        name: name.trim(),
        username: username.trim(),
        email: email.trim(),
        mobile: mobile.trim() || null,
        role: accountType,
        energy_category: effectiveCategory,
        wbes_acronym: wbesAcronym.trim().toUpperCase(),
        region,
        qca_name: isQca ? qcaName.trim() : null,
        password,
      });
      setSubmitted(res);
    } catch (err) {
      setError(err.message || 'Could not submit your registration.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="login-container">
        <div className="login-card glass-panel">
          <div style={{ textAlign: 'center', marginBottom: '22px' }}>
            <CheckCircle2 size={44} style={{ color: 'var(--status-resolved-text)' }} />
            <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-display)', fontWeight: 800, marginTop: '10px' }}>
              Registration submitted
            </h2>
          </div>

          <Banner type="success" message={submitted.message} />

          <div className="register-summary">
            <div><span>Request number</span><strong>#{submitted.requestId}</strong></div>
            <div><span>Username</span><strong>{username.trim()}</strong></div>
            <div><span>WBES acronym</span><strong>{wbesAcronym.trim().toUpperCase()}</strong></div>
            <div><span>Account type</span><strong>{isQca ? `QCA — ${qcaName.trim()}` : 'Plant user'}</strong></div>
            <div><span>Category</span><strong>{effectiveCategory}</strong></div>
            <div><span>Despatch centre</span><strong>{region}</strong></div>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: '16px' }}>
            You cannot sign in yet. An NRLDC administrator reviews each request; once
            yours is approved you will be emailed at <strong>{email.trim()}</strong> and can
            sign in with the password you just chose.
          </p>

          <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: '20px' }} onClick={onBackToLogin}>
            <ArrowLeft size={15} /> Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="login-container">
      <div className="login-card glass-panel register-card">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <img src="/grid_india_logo.png" alt="GRID INDIA Logo" style={{ height: '58px', width: 'auto', objectFit: 'contain' }} />
          <h2 style={{ fontSize: '1.35rem', fontFamily: 'var(--font-display)', fontWeight: 800, marginTop: '10px' }}>
            Register for portal access
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Your request is reviewed by an NRLDC administrator before the account is created.
          </p>
        </div>

        <Banner type="error" message={error} />

        <form onSubmit={handleSubmit}>
          <fieldset className="register-section">
            <legend><Building2 size={14} /> Who is registering</legend>

            <div className="form-group">
              <label htmlFor="reg-region">Load despatch centre</label>
              <select id="reg-region" className="form-control" value={region}
                onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map(r => (
                  <option key={r.code} value={r.code}>{r.name} — {r.code}</option>
                ))}
              </select>
              <span className="settings-field-hint">
                The centre that despatches your station. Its administrator reviews this
                request, and administers the account afterwards.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="reg-account-type">Account type</label>
              <select
                id="reg-account-type"
                className="form-control"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="USER">Plant / station user</option>
                <option value="QCA">QCA — coordinating agency</option>
              </select>
              <span className="settings-field-hint">
                {isQca
                  ? 'A QCA coordinates Renewable Energy plants, so the category is fixed to RE.'
                  : 'Choose this if you file discrepancies for your own station.'}
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="reg-name">{isQca ? 'Agency name' : 'Station / full name'}</label>
              <input id="reg-name" type="text" className="form-control" value={name}
                placeholder={isQca ? 'e.g. Thar Solar Coordination Services' : 'e.g. Dadri Thermal Power Station'}
                onChange={(e) => setName(e.target.value)} required />
            </div>

            {isQca && (
              <div className="form-group">
                <label htmlFor="reg-qca-name">Short QCA name</label>
                <input id="reg-qca-name" type="text" className="form-control" value={qcaName}
                  placeholder="e.g. Thar Solar QCA"
                  onChange={(e) => setQcaName(e.target.value)} required />
              </div>
            )}

            {!isQca && (
              <div className="form-group">
                <label htmlFor="reg-category">Energy category</label>
                <select id="reg-category" className="form-control" value={energyCategory}
                  onChange={(e) => setEnergyCategory(e.target.value)}>
                  <option value="ISGS">{categoryLabel('ISGS')}</option>
                  <option value="RE">{categoryLabel('RE')} — Renewable Energy</option>
                  <option value="States">States</option>
                </select>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="reg-acronym">WBES acronym</label>
              <input
                id="reg-acronym"
                type="text"
                className="form-control"
                style={{ textTransform: 'uppercase', fontFamily: 'ui-monospace, Menlo, monospace' }}
                value={wbesAcronym}
                placeholder="e.g. DADRI_TH"
                onChange={(e) => handleAcronymChange(e.target.value)}
                required
              />
              <span className="settings-field-hint">
                This identifies your plant in WBES, and your username is built from it.
                Please check it carefully — an administrator can correct it before
                approving, but it cannot be changed once the account exists.
              </span>
            </div>
          </fieldset>

          <fieldset className="register-section">
            <legend>Contact</legend>

            <div className="form-group">
              <label htmlFor="reg-email">Email address</label>
              <input id="reg-email" type="email" className="form-control" value={email}
                placeholder="name@example.in" autoComplete="email"
                onChange={(e) => setEmail(e.target.value)} required />
              <span className="settings-field-hint">Used for login codes and for the decision on this request.</span>
            </div>

            <div className="form-group">
              <label htmlFor="reg-mobile">Mobile number <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
              <input id="reg-mobile" type="tel" className="form-control" value={mobile}
                placeholder="10-digit number" onChange={(e) => setMobile(e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="register-section">
            <legend><Lock size={14} /> Sign-in details</legend>

            <div className="form-group">
              <label htmlFor="reg-username">Username</label>
              <input id="reg-username" type="text" className="form-control" value={username}
                placeholder="e.g. dadri.th@nrldc" autoComplete="username"
                onChange={(e) => handleUsernameChange(e.target.value)} required />
              <span className="settings-field-hint">
                {usernameEdited
                  ? 'You have set this yourself. Clear the field to go back to the name built from your acronym.'
                  : 'Filled in from your WBES acronym — the convention used across the portal. You can change it.'}
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="reg-password">Password</label>
              <input id="reg-password" type="password" className="form-control" value={password}
                autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} required />
              {password && (
                <ul className="password-rules">
                  {PASSWORD_RULES.map(rule => {
                    const met = rule.test(password);
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
              <label htmlFor="reg-confirm">Confirm password</label>
              <input id="reg-confirm" type="password" className="form-control" value={confirmPassword}
                autoComplete="new-password" onChange={(e) => setConfirmPassword(e.target.value)} required />
              {confirmPassword && password !== confirmPassword && (
                <small style={{ color: 'var(--danger-text)', fontSize: '0.75rem' }}>The two passwords do not match.</small>
              )}
            </div>
          </fieldset>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '4px' }} disabled={submitting}>
            <UserPlus size={16} />
            {submitting ? 'Submitting…' : 'Submit registration'}
          </button>
        </form>

        <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: '10px' }} onClick={onBackToLogin}>
          <ArrowLeft size={15} /> Back to sign in
        </button>
      </div>
    </div>
  );
}
