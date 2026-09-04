import { useState } from 'react';
import { registerAccount, searchWbesForRegistration } from '../services/db';
import { RULES as PASSWORD_RULES, validatePassword } from '../utils/password';
import { usernameFromAcronym } from '../utils/usernames';
import { regionLabel } from '../utils/regions';
import { Banner } from './Feedback';
import { categoryLabel } from '../utils/categories';
import { isTraderCategory } from '../utils/trade';
import { deriveSignupType, isQcaSignupType } from '../utils/wbesTypes';
import AcronymPicker from './AcronymPicker';
import { UserPlus, ArrowLeft, CheckCircle2, Building2, Lock } from 'lucide-react';

/**
 * Register — self-service sign-up.
 *
 * Submitting does not create an account; it queues a request an RLDC
 * administrator has to approve. The account is anchored on a WBES acronym the
 * RLDC has already registered: the applicant searches for it, and selecting it
 * fills in the display name, the despatch centre and the username
 * (acronym@rldc). The applicant only supplies contact details, a password, and
 * — for a QCA — the agency name. The admin can still correct anything before
 * approving.
 */
export default function Register({ onBackToLogin }) {
  // Auto-filled from the chosen WBES acronym; the applicant does not type these.
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [region, setRegion] = useState('');
  const [wbesAcronym, setWbesAcronym] = useState('');

  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  // Derived from the picked acronym's classification, not chosen freely: a
  // QCA-classified acronym becomes a QCA account, anything else a plant user.
  const [accountType, setAccountType] = useState('USER');   // USER | QCA
  const [energyCategory, setEnergyCategory] = useState('ISGS');
  const [qcaName, setQcaName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Picking a registered acronym settles the account's identity: its display
  // name, the region that despatches it, and the username built from both.
  const handleAcronymSelect = (row) => {
    setWbesAcronym(row.wbes_acronym);
    setName(row.name || '');
    setRegion(row.region || '');
    // A trader is named for the national centre (<acronym>@nldc) rather than an
    // RLDC — mirrors the server's rule so the preview matches the account made.
    const usernameNamespace = isTraderCategory(row.energy_category) ? 'NLDC' : row.region;
    setUsername(usernameFromAcronym(row.wbes_acronym, usernameNamespace));
    // The category is the acronym's own, from the register — the applicant no
    // longer declares it, only sees it.
    if (row.energy_category) setEnergyCategory(row.energy_category);
    // The acronym's classification decides the account type: a QCA acronym
    // registers as a QCA, everything else as a plant user. The applicant does
    // not choose — the register does.
    const signupType = deriveSignupType(row.utility_type, row.generator_type);
    setAccountType(isQcaSignupType(signupType) ? 'QCA' : 'USER');
  };

  // Typing after a selection clears it, so the derived fields clear with it —
  // there is no half-chosen state where the name and acronym disagree.
  const handleAcronymChange = (val) => {
    setWbesAcronym(val);
    if (!val) { setName(''); setRegion(''); setUsername(''); setAccountType('USER'); }
  };

  const isQca = accountType === 'QCA';
  // QCAs coordinate Renewable Energy plants only, so the category is fixed.
  const effectiveCategory = isQca ? 'RE' : energyCategory;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!wbesAcronym) {
      setError('Search for your WBES acronym and pick it from the list. If it is not there, ask your RLDC to register it first.');
      return;
    }
    if (!email.trim()) {
      setError('Enter your email address.');
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
        // Advisory only — the server derives the username and region from the
        // acronym's registered row. Sent so the confirmation screen matches.
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
            You cannot sign in yet. An administrator reviews each request; once
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
            Your request is reviewed by an administrator before the account is created.
          </p>
        </div>

        <Banner type="error" message={error} />

        <form onSubmit={handleSubmit}>
          <fieldset className="register-section">
            <legend><Building2 size={14} /> Who is registering</legend>

            {/* The acronym anchors everything: it must be one the RLDC has
                registered, and picking it fills in the name, region and
                username below — and decides the account type. */}
            <AcronymPicker
              label={<>WBES acronym <span style={{ color: 'var(--danger-text)' }}>*</span></>}
              value={wbesAcronym}
              onChange={handleAcronymChange}
              onSelect={handleAcronymSelect}
              searchFn={searchWbesForRegistration}
              placeholder="Search your plant's WBES acronym or name…"
              hint="If your plant is not listed, ask your RLDC to register its WBES acronym first."
            />

            <div className="form-group">
              <label htmlFor="reg-name">{isQca ? 'Registered name' : 'Station / plant name'}</label>
              <input id="reg-name" type="text" className="form-control" value={name}
                placeholder="Filled in from the WBES acronym you pick"
                readOnly disabled />
              <span className="settings-field-hint">Taken from the WBES register — an administrator can correct it before approving.</span>
            </div>

            <div className="form-group">
              <label htmlFor="reg-region">Load despatch centre (RLDC)</label>
              <input id="reg-region" type="text" className="form-control"
                value={region ? regionLabel(region) : ''}
                placeholder="Filled in from the WBES acronym you pick"
                readOnly disabled />
              <span className="settings-field-hint">The centre that despatches this plant reviews and administers the account.</span>
            </div>

            <div className="form-group">
              <label>Account type</label>
              <div className="form-control" style={{ background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', minHeight: '38px' }}>
                {wbesAcronym
                  ? <strong>{isQca ? 'QCA — Coordinating Agency' : 'Plant / station user'}</strong>
                  : <span style={{ color: 'var(--text-muted)' }}>Set from your WBES acronym once you pick it</span>}
              </div>
              <span className="settings-field-hint">
                {wbesAcronym
                  ? (isQca
                      ? 'This WBES acronym is a QCA coordinating agency, so it registers as a QCA account (category fixed to RE).'
                      : 'This WBES acronym is a plant, so it registers as a plant / station user.')
                  : 'The account type is decided by the WBES acronym you pick — a QCA acronym registers as a QCA, a plant as a plant user.'}
              </span>
            </div>

            {isQca && (
              <div className="form-group">
                <label htmlFor="reg-qca-name">Short QCA name</label>
                <input id="reg-qca-name" type="text" className="form-control" value={qcaName}
                  placeholder="e.g. Example QCA"
                  onChange={(e) => setQcaName(e.target.value)} required />
              </div>
            )}

            {!isQca && (
              <div className="form-group">
                <label>Category</label>
                <div className="form-control" style={{ background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', minHeight: '38px' }}>
                  {wbesAcronym
                    ? <strong>{categoryLabel(energyCategory)}</strong>
                    : <span style={{ color: 'var(--text-muted)' }}>Set from your WBES acronym once you pick it</span>}
                </div>
                <span className="settings-field-hint">
                  Taken from the WBES register — it is not chosen at sign-up.
                </span>
              </div>
            )}
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
                placeholder="Auto-generated"
                autoComplete="username" readOnly disabled />
              <span className="settings-field-hint">
                This is generated for you automatically — you don’t need to fill it in.
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
