import React, { useState, useEffect } from 'react';
import { getUsers, toggleUserLock, registerUser, bulkImportUsers, updateUserAdmin, resetUserPasswordAdmin, rollbackUserRegistry, toggleUserBypass2FA, getRegistrations, processRegistration, getPasswordResets, processPasswordReset } from '../services/db';
import { DEFAULT_PASSWORD, RULES as PASSWORD_RULES, validatePassword } from '../utils/password';
import { defaultUsernameFor } from '../utils/usernames';
import { REGIONS, isNational } from '../utils/regions';

const ADMIN_ROLES = ['ADMIN', 'SUPERADMIN'];
import ConfirmDialog from './ConfirmDialog';
import { Banner, EmptyState, SkeletonRows } from './Feedback';
import { categoryLabel, categoryShort } from '../utils/categories';
import { useFeedback } from '../hooks/useFeedback';
import { useModalDismiss } from '../hooks/useModalDismiss';
import {
  Users, UserPlus, FileUp, Download, Lock, Unlock, Search,
  CheckCircle2, Edit, X, Check, Key, Undo2, KeyRound
} from 'lucide-react';
import { formatDateDMYHM } from '../utils/format';

export default function UserManagement({ currentUser }) {
  const { notice, notify, clearNotice, askConfirm, confirmProps } = useFeedback();
  const [loadError, setLoadError] = useState('');
  const [registrations, setRegistrations] = useState([]);
  const [showAllRegistrations, setShowAllRegistrations] = useState(false);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // The registration currently open for review, and the (editable) details the
  // account will be created from. Populated from the application; the admin can
  // correct anything wrong in it before approving.
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewDraft, setReviewDraft] = useState(null);
  const [reviewError, setReviewError] = useState('');
  // Password reset queue.
  const [passwordResets, setPasswordResets] = useState([]);
  const [showAllResets, setShowAllResets] = useState(false);
  const [decliningResetId, setDecliningResetId] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // Registration Form States
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('USER');
  const [email, setEmail] = useState('');
  const [email2, setEmail2] = useState('');
  const [email3, setEmail3] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [energyCategory, setEnergyCategory] = useState('ISGS');
  const [wbesAcronym, setWbesAcronym] = useState('');
  const [bypass2FA, setBypass2FA] = useState(false);
  const [canUploadCycleData, setCanUploadCycleData] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [qcaName, setQcaName] = useState('');
  const [newUserRegion, setNewUserRegion] = useState(currentUser?.region || 'NRLDC');

  // Edit Modal States
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editEmail2, setEditEmail2] = useState('');
  const [editEmail3, setEditEmail3] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editRole, setEditRole] = useState('USER');
  const [editEnergyCategory, setEditEnergyCategory] = useState('ISGS');
  const [editWbesAcronym, setEditWbesAcronym] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editBypass2FA, setEditBypass2FA] = useState(false);
  const [editCanUploadCycleData, setEditCanUploadCycleData] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [editQcaName, setEditQcaName] = useState('');

  // CSV Bulk Importer States
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  async function loadData() {
    setLoadError('');
    setLoading(true);
    try {
      const [data, regs, resets] = await Promise.all([
        getUsers(),
        getRegistrations('ALL').catch(() => []),
        getPasswordResets('ALL').catch(() => []),
      ]);
      setUsers(data);
      setRegistrations(regs || []);
      setPasswordResets(resets || []);
    } catch (e) {
      console.error('Failed to load users:', e.message);
      setLoadError(e.message || 'Could not load the user registry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => loadData());
  }, []);

  /**
   * Turn OTP on or off for a single account. This is the escape hatch for a
   * user who cannot receive their code — no need to wait on anyone else.
   */
  const handleToggleBypass2FA = (user) => {
    const turningOff = !user.bypass_2fa;
    askConfirm({
      title: turningOff ? 'Disable OTP for this user' : 'Re-enable OTP for this user',
      message: turningOff
        ? `"${user.username}" will sign in with their password alone, with no OTP.\n\nUse this when the user cannot receive their code. Re-enable it once email is working again.`
        : `"${user.username}" will be asked for an emailed OTP at every login.`,
      confirmLabel: turningOff ? 'Disable OTP' : 'Re-enable OTP',
      tone: turningOff ? 'danger' : 'warn',
      action: async () => {
        const res = await toggleUserBypass2FA(user.username);
        await loadData();
        notify(res.bypass_2fa ? 'warn' : 'success',
          res.bypass_2fa
            ? `OTP is now DISABLED for "${user.username}" — they can log in with their password alone.`
            : `OTP is now required again for "${user.username}".`);
      },
    });
  };

  /**
   * Open a registration for review. The draft starts as exactly what the
   * applicant submitted; whatever the admin leaves alone is what gets used.
   */
  const startReview = (reg) => {
    setReviewingId(reg.id);
    setReviewError('');
    setRejectingId(null);
    setReviewDraft({
      username: reg.username || '',
      name: reg.name || '',
      email: reg.email || '',
      mobile: reg.mobile || '',
      role: reg.role || 'USER',
      energy_category: reg.energy_category || 'ISGS',
      wbes_acronym: reg.wbes_acronym || '',
      qca_name: reg.qca_name || '',
    });
  };

  const closeReview = () => {
    setReviewingId(null);
    setReviewDraft(null);
    setReviewError('');
  };

  const updateDraft = (field, value) => {
    setReviewDraft(d => ({ ...d, [field]: value }));
  };

  /**
   * Correcting the acronym should carry the username with it, but only while
   * the username still looks auto-generated. An admin who has deliberately
   * typed a username keeps it.
   */
  const updateDraftAcronym = (raw) => {
    const next = raw.toUpperCase();
    setReviewDraft(d => {
      const wasDerived = !d.username || d.username === defaultUsernameFor(d.wbes_acronym);
      return {
        ...d,
        wbes_acronym: next,
        username: wasDerived ? defaultUsernameFor(next) : d.username,
      };
    });
  };

  /**
   * A QCA account is Renewable Energy by definition, so choosing QCA fixes the
   * category rather than letting the admin save a combination the server will
   * refuse.
   */
  const updateDraftRole = (nextRole) => {
    setReviewDraft(d => ({
      ...d,
      role: nextRole,
      energy_category: nextRole === 'QCA' ? 'RE' : d.energy_category,
    }));
  };

  /** Fields the admin actually changed — everything else stays as submitted. */
  const draftEdits = (reg) => {
    if (!reviewDraft) return {};
    const edits = {};
    for (const field of ['username', 'name', 'email', 'mobile', 'role', 'energy_category', 'wbes_acronym', 'qca_name']) {
      const next = (reviewDraft[field] ?? '').trim();
      const original = (reg[field] ?? '').toString();
      if (next !== original) edits[field] = next;
    }
    return edits;
  };

  const handleApproveRegistration = async (reg) => {
    const edits = draftEdits(reg);
    setReviewError('');

    if (!reviewDraft.username.trim() || !reviewDraft.name.trim() ||
        !reviewDraft.email.trim() || !reviewDraft.wbes_acronym.trim()) {
      setReviewError('Name, username, email and WBES acronym are all required.');
      return;
    }
    if (reviewDraft.role === 'QCA' && !reviewDraft.qca_name.trim()) {
      setReviewError('A QCA account needs the coordinating agency name.');
      return;
    }

    const changeCount = Object.keys(edits).length;
    askConfirm({
      title: changeCount > 0 ? 'Approve with corrections' : 'Approve registration',
      message: `Create an account for "${reviewDraft.username.trim()}"?\n\n`
        + `${reviewDraft.name.trim()}\nWBES acronym: ${reviewDraft.wbes_acronym.trim().toUpperCase()}\n`
        + `Type: ${reviewDraft.role === 'QCA' ? 'QCA — ' + reviewDraft.qca_name.trim() : 'Plant user'}  ·  ${reviewDraft.energy_category}\n\n`
        + (changeCount > 0
            ? `${changeCount} detail${changeCount === 1 ? '' : 's'} corrected from the original application. The correction is recorded against the request.\n\n`
            : '')
        + 'They will sign in with the password they chose when registering.',
      confirmLabel: 'Approve and create account',
      tone: 'warn',
      action: async () => {
        const res = await processRegistration(reg.id, 'Approved', '', edits);
        closeReview();
        await loadData();
        notify('success', res.message + (res.emailed ? ' They have been emailed.' : ' (Could not send the notification email.)'));
      },
    });
  };

  /**
   * Rejecting asks for a reason inline — it is emailed to the applicant, so it
   * has to say what they should correct.
   */
  const handleConfirmReject = async (reg) => {
    if (!rejectReason.trim()) {
      notify('error', 'Give a reason, so the applicant knows what to correct.');
      return;
    }
    try {
      const res = await processRegistration(reg.id, 'Rejected', rejectReason.trim());
      setRejectingId(null);
      setRejectReason('');
      closeReview();
      await loadData();
      notify('success', res.message + (res.emailed ? ' They have been emailed.' : ' (Could not send the notification email.)'));
    } catch (err) {
      notify('error', err.message || 'Could not reject the registration.');
    }
  };

  /**
   * Approve a password reset. The account goes back to the known default
   * password and any lockout is cleared — a user who has been asking for a
   * reset has usually locked themselves out trying.
   */
  const handleApproveReset = (reset) => {
    askConfirm({
      title: 'Reset this password',
      message: `Set the password for "${reset.username}" back to "${DEFAULT_PASSWORD}"?\n\n`
        + `${reset.name || 'Account'}${reset.email ? ' · ' + reset.email : ''}\n\n`
        + (reset.locked ? 'The account is locked; approving also unlocks it.\n\n' : '')
        + 'Tell them to change it as soon as they are signed in.',
      confirmLabel: 'Reset password',
      tone: 'danger',
      action: async () => {
        const res = await processPasswordReset(reset.id, 'Approved');
        await loadData();
        notify('warn', res.message + (res.emailed ? ' They have been emailed.' : ' (Could not send the notification email — tell them another way.)'));
      },
    });
  };

  const handleDeclineReset = async (reset) => {
    if (!declineReason.trim()) {
      notify('error', 'Give a reason, so the user knows why their request was declined.');
      return;
    }
    try {
      const res = await processPasswordReset(reset.id, 'Rejected', declineReason.trim());
      setDecliningResetId(null);
      setDeclineReason('');
      await loadData();
      notify('success', res.message);
    } catch (err) {
      notify('error', err.message || 'Could not decline the request.');
    }
  };

  const handleToggleLock = async (usernameToToggle) => {
    try {
      await toggleUserLock(usernameToToggle);
      await loadData();
    } catch (e) {
      notify('error', 'Failed to toggle lock: ' + e.message);
    }
  };

  const handleResetPassword = (usernameToReset) => {
    askConfirm({
      title: 'Reset password',
      message: `Reset the password for "${usernameToReset}" to the default "${DEFAULT_PASSWORD}"?\n\nThe user should change it after signing in.`,
      confirmLabel: 'Reset password',
      tone: 'warn',
      action: async () => {
        const res = await resetUserPasswordAdmin(usernameToReset);
        await loadData();
        notify('success', res.message || 'Password reset successfully.');
      },
    });
  };

  const handleRollback = () => {
    askConfirm({
      title: 'Roll back user registry',
      message: 'Revert the user registry to the state before the last bulk import?\n\nAny users added since then will be removed. This cannot be undone.',
      confirmLabel: 'Roll back registry',
      tone: 'danger',
      action: async () => {
        const res = await rollbackUserRegistry();
        setUsers(res.users);
        notify('success', res.message || 'Registry rolled back successfully.');
      },
    });
  };

  // Escape closes the edit dialog, and the list behind it stops scrolling.
  useModalDismiss(!!editingUser, () => setEditingUser(null));

  const pendingRegistrations = registrations.filter(r => r.status === 'Pending');
  const visibleRegistrations = showAllRegistrations ? registrations : pendingRegistrations;
  const pendingResets = passwordResets.filter(r => r.status === 'Pending');
  const visibleResets = showAllResets ? passwordResets : pendingResets;

  const handleAddUserSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!name.trim() || !username.trim() || !email.trim() || !wbesAcronym.trim()) {
      setFormError('Please fill in all required fields, including the WBES Acronym.');
      return;
    }

    if (energyCategory === 'QCA' && !qcaName.trim()) {
      setFormError('QCA Name is required for QCA category users.');
      return;
    }

    const passwordError = validatePassword(password || DEFAULT_PASSWORD);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }

    try {
      await registerUser({
        name: name.trim(),
        username: username.trim(),
        role: energyCategory === 'QCA' ? 'QCA' : role,
        email: email.trim(),
        email2: email2.trim() || null,
        email3: email3.trim() || null,
        mobile: mobile.trim() || null,
        password: password || DEFAULT_PASSWORD,
        energy_category: energyCategory === 'QCA' ? 'RE' : energyCategory,
        wbes_acronym: wbesAcronym.trim().toUpperCase(),
        region: newUserRegion,
        bypass_2fa: bypass2FA,
        can_upload_cycle_data: energyCategory === 'QCA' ? false : canUploadCycleData,
        qca_name: energyCategory === 'QCA' ? qcaName.trim() : null
      });
      setFormSuccess(`User "${username}" registered successfully!`);
      setName(''); setUsername(''); setEmail(''); setEmail2(''); setEmail3(''); setMobile(''); setBypass2FA(false); setCanUploadCycleData(false);
      setPassword(DEFAULT_PASSWORD); setEnergyCategory('ISGS'); setWbesAcronym(''); setQcaName('');
      await loadData();
    } catch (err) {
      setFormError(err.message || 'Failed to register user.');
    }
  };

  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditEmail2(user.email2 || '');
    setEditEmail3(user.email3 || '');
    setEditMobile(user.mobile || '');
    setEditRole(user.role);
    setEditEnergyCategory(user.qca_name ? 'QCA' : user.energy_category);
    setEditWbesAcronym(user.wbes_acronym || '');
    setEditPassword('');
    setEditBypass2FA(!!user.bypass_2fa);
    setEditCanUploadCycleData(!!user.can_upload_cycle_data);
    setEditQcaName(user.qca_name || '');
    setEditError('');
    setEditSuccess('');
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSuccess('');

    if (!editName.trim() || !editEmail.trim() || !editWbesAcronym.trim()) {
      setEditError('Name, Email, and WBES Acronym are required.');
      return;
    }

    if (editEnergyCategory === 'QCA' && !editQcaName.trim()) {
      setEditError('QCA Name is required for QCA category users.');
      return;
    }

    if (editPassword.trim()) {
      const passwordError = validatePassword(editPassword.trim());
      if (passwordError) {
        setEditError(passwordError);
        return;
      }
    }

    try {
      await updateUserAdmin(editingUser.username, {
        name: editName.trim(),
        email: editEmail.trim(),
        email2: editEmail2.trim() || null,
        email3: editEmail3.trim() || null,
        mobile: editMobile.trim() || null,
        role: editEnergyCategory === 'QCA' ? 'QCA' : editRole,
        energy_category: editEnergyCategory === 'QCA' ? 'RE' : editEnergyCategory,
        wbes_acronym: editWbesAcronym.trim().toUpperCase(),
        password: editPassword.trim() || undefined,
        bypass_2fa: editBypass2FA,
        can_upload_cycle_data: editEnergyCategory === 'QCA' ? false : editCanUploadCycleData,
        qca_name: editEnergyCategory === 'QCA' ? editQcaName.trim() : null
      });
      setEditSuccess('User details updated successfully!');
      await loadData();
      setTimeout(() => {
        setEditingUser(null);
      }, 800);
    } catch (err) {
      setEditError(err.message || 'Failed to update user.');
    }
  };

  const handleCsvImport = async (e) => {
    e.preventDefault();
    setImportError('');
    setImportSuccess('');

    if (!csvText.trim()) {
      setImportError('Please enter or paste CSV text data.');
      return;
    }

    try {
      const result = await bulkImportUsers(csvText);
      setImportSuccess(`Import complete. ${result.importCount} users added, ${result.errorCount} skipped.`);
      setCsvText('');
      await loadData();
    } catch (err) {
      setImportError(err.message || 'CSV parse or import failed.');
    }
  };

  const handleExportCSV = () => {
    try {
      const headers = ['Name', 'Role', 'Username', 'Email', 'Email2', 'Email3', 'Mobile', 'Category', 'WBES_Acronym', 'Bypass2FA', 'CycleUpload', 'Status'];
      const rows = users.map(u => [
        `"${u.name}"`, u.role, u.username, u.email, u.email2 || '', u.email3 || '', u.mobile || '',
        ADMIN_ROLES.includes(u.role) ? 'Admin' : u.energy_category, u.wbes_acronym || '', u.bypass_2fa ? 'BYPASS' : 'OTP', u.can_upload_cycle_data ? 'AUTHORIZED' : 'NONE', u.locked ? 'LOCKED' : 'ACTIVE'
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,'
        + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const link = document.createElement('a');
      link.setAttribute('href', encodeURI(csvContent));
      link.setAttribute('download', 'NRLDC_Registered_Users.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      notify('error', 'Failed to export: ' + err.message);
    }
  };

  const loadSampleCSV = () => {
    setCsvText(`Name,Username,Email,Category,Acronym
ANTA Gas Power Station,usr_ANTA,anta@ntpc.co.in,ISGS,ANTA
MITHAPUR_SOLAR,usr_MITHAPUR,ops@mithapursolar.com,RE,MITHAPUR
HARYANA_UTILITY,usr_HARYANA,scheduling@haryana.gov.in,States,HARYANA`);
  };

  const filteredUsers = users.filter(u => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return u.name.toLowerCase().includes(q) ||
             u.username.toLowerCase().includes(q) ||
             u.email.toLowerCase().includes(q);
    }
    return true;
  });

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

      <Banner type="error" message={loadError} onRetry={loadData} />

      {/* ── Self-service registrations awaiting a decision ──────────────────
          Shown above the directory because it is work waiting on the admin,
          not a reference list. Hidden entirely when the queue is empty and
          nothing has ever been reviewed. */}
      {(pendingRegistrations.length > 0 || registrations.length > 0) && (
        <div className="glass-panel registration-queue">
          <div className="flex-row-between" style={{ marginBottom: '14px' }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                <UserPlus size={17} />
                <span>Registration Requests</span>
                {pendingRegistrations.length > 0 && (
                  <span className="queue-count">{pendingRegistrations.length} awaiting review</span>
                )}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: '4px' }}>
                People who registered themselves. Open <strong>Review</strong> to check and
                correct the details, then approve to create the account.
              </p>
            </div>
            {registrations.length > pendingRegistrations.length && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                onClick={() => setShowAllRegistrations(v => !v)}>
                {showAllRegistrations ? 'Show pending only' : `Show all (${registrations.length})`}
              </button>
            )}
          </div>

          {visibleRegistrations.length === 0 ? (
            <EmptyState title="Nothing awaiting review" hint="New self-service registrations will appear here." icon={UserPlus} />
          ) : (
            <div className="table-container" style={{ maxHeight: 'none' }}>
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Username</th>
                    <th>WBES Acronym</th>
                    <th>Type</th>
                    <th>Email</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRegistrations.map((reg) => (
                    <React.Fragment key={reg.id}>
                    <tr className={reviewingId === reg.id ? 'is-reviewing' : ''}>
                      <td>{reg.name}</td>
                      <td className="mono">{reg.username}</td>
                      <td><strong className="mono" style={{ color: 'var(--accent-blue)' }}>{reg.wbes_acronym}</strong></td>
                      <td>
                        <span className={`energy-badge ${reg.energy_category}`}>{categoryShort(reg.energy_category)}</span>
                        {reg.role === 'QCA' && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--warn-text)', marginTop: '3px' }}>QCA — {reg.qca_name}</div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>{reg.email}</td>
                      <td style={{ fontSize: '0.78rem' }}>{formatDateDMYHM(reg.created_at)}</td>
                      <td>
                        <span className={`status-badge ${reg.status.toLowerCase()}`}>{reg.status}</span>
                        {reg.status !== 'Pending' && reg.reviewed_by && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                            by {reg.reviewed_by}
                          </div>
                        )}
                      </td>
                      <td>
                        {reg.status !== 'Pending' ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {reg.review_note || '—'}
                          </span>
                        ) : rejectingId === reg.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '210px' }}>
                            <textarea
                              className="form-control"
                              rows="2"
                              autoFocus
                              placeholder="Why is this being rejected? The applicant is emailed this."
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              style={{ fontSize: '0.78rem' }}
                            />
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button type="button" className="btn btn-danger" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                                onClick={() => handleConfirmReject(reg)}>Confirm reject</button>
                              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                                onClick={() => { setRejectingId(null); setRejectReason(''); }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" className="btn btn-teal" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                              onClick={() => (reviewingId === reg.id ? closeReview() : startReview(reg))}>
                              {reviewingId === reg.id ? 'Close' : 'Review'}
                            </button>
                            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                              onClick={() => { setRejectingId(reg.id); setRejectReason(''); closeReview(); }}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* The review panel. Everything here is pre-filled from the
                        application; only what the admin changes is sent as a
                        correction, and the request keeps its original record. */}
                    {reviewingId === reg.id && reviewDraft && (
                      <tr className="review-row">
                        <td colSpan="8">
                          <div className="review-panel">
                            <div className="review-panel-head">
                              <h4>Check the details before creating this account</h4>
                              <p>
                                Correct anything the applicant got wrong — a station filed under the wrong
                                category, or a mistyped acronym. The account is created from what is shown
                                here, and the changes are recorded against the request.
                              </p>
                            </div>

                            <Banner type="error" message={reviewError} />

                            <div className="review-grid">
                              <div className="form-group">
                                <label htmlFor={`rv-acronym-${reg.id}`}>WBES acronym</label>
                                <input id={`rv-acronym-${reg.id}`} type="text" className="form-control mono"
                                  style={{ textTransform: 'uppercase' }}
                                  value={reviewDraft.wbes_acronym}
                                  onChange={(e) => updateDraftAcronym(e.target.value)} />
                                {reviewDraft.wbes_acronym.toUpperCase() !== (reg.wbes_acronym || '').toUpperCase() && (
                                  <span className="review-changed">was {reg.wbes_acronym}</span>
                                )}
                              </div>

                              <div className="form-group">
                                <label htmlFor={`rv-username-${reg.id}`}>Username</label>
                                <input id={`rv-username-${reg.id}`} type="text" className="form-control mono"
                                  value={reviewDraft.username}
                                  onChange={(e) => updateDraft('username', e.target.value)} />
                                {reviewDraft.username !== reg.username && (
                                  <span className="review-changed">was {reg.username}</span>
                                )}
                              </div>

                              <div className="form-group">
                                <label htmlFor={`rv-name-${reg.id}`}>Station / applicant name</label>
                                <input id={`rv-name-${reg.id}`} type="text" className="form-control"
                                  value={reviewDraft.name}
                                  onChange={(e) => updateDraft('name', e.target.value)} />
                                {reviewDraft.name !== reg.name && (
                                  <span className="review-changed">was {reg.name}</span>
                                )}
                              </div>

                              <div className="form-group">
                                <label htmlFor={`rv-role-${reg.id}`}>Account type</label>
                                <select id={`rv-role-${reg.id}`} className="form-control"
                                  value={reviewDraft.role}
                                  onChange={(e) => updateDraftRole(e.target.value)}>
                                  <option value="USER">Plant / station user</option>
                                  <option value="QCA">QCA — coordinating agency</option>
                                </select>
                                {reviewDraft.role !== reg.role && (
                                  <span className="review-changed">was {reg.role}</span>
                                )}
                              </div>

                              <div className="form-group">
                                <label htmlFor={`rv-category-${reg.id}`}>Energy category</label>
                                <select id={`rv-category-${reg.id}`} className="form-control"
                                  value={reviewDraft.energy_category}
                                  disabled={reviewDraft.role === 'QCA'}
                                  onChange={(e) => updateDraft('energy_category', e.target.value)}>
                                  <option value="ISGS">{categoryLabel('ISGS')}</option>
                                  <option value="RE">RE — Renewable Energy</option>
                                  <option value="States">States</option>
                                </select>
                                {reviewDraft.role === 'QCA' ? (
                                  <span className="settings-field-hint">A QCA coordinates RE plants, so the category is fixed.</span>
                                ) : reviewDraft.energy_category !== reg.energy_category && (
                                  <span className="review-changed">was {reg.energy_category}</span>
                                )}
                              </div>

                              {reviewDraft.role === 'QCA' && (
                                <div className="form-group">
                                  <label htmlFor={`rv-qca-${reg.id}`}>QCA name</label>
                                  <input id={`rv-qca-${reg.id}`} type="text" className="form-control"
                                    value={reviewDraft.qca_name}
                                    onChange={(e) => updateDraft('qca_name', e.target.value)} />
                                </div>
                              )}

                              <div className="form-group">
                                <label htmlFor={`rv-email-${reg.id}`}>Email</label>
                                <input id={`rv-email-${reg.id}`} type="email" className="form-control"
                                  value={reviewDraft.email}
                                  onChange={(e) => updateDraft('email', e.target.value)} />
                                {reviewDraft.email !== reg.email && (
                                  <span className="review-changed">was {reg.email}</span>
                                )}
                              </div>

                              <div className="form-group">
                                <label htmlFor={`rv-mobile-${reg.id}`}>Mobile</label>
                                <input id={`rv-mobile-${reg.id}`} type="tel" className="form-control"
                                  value={reviewDraft.mobile}
                                  onChange={(e) => updateDraft('mobile', e.target.value)} />
                              </div>
                            </div>

                            <div className="review-actions">
                              <span className="review-note-text">
                                The password stays as the applicant chose it — it is never shown here.
                              </span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="button" className="btn btn-secondary" onClick={closeReview}>Cancel</button>
                                <button type="button" className="btn btn-teal" onClick={() => handleApproveRegistration(reg)}>
                                  <CheckCircle2 size={15} /> Approve and create account
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Password reset requests ─────────────────────────────────────────
          Users who cannot receive the emailed temporary password ask here.
          Approving is a manual reset to the known default — deliberately a
          decision the admin makes, not something the portal does on its own. */}
      {passwordResets.length > 0 && (
        <div className="glass-panel registration-queue">
          <div className="flex-row-between" style={{ marginBottom: '14px' }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                <KeyRound size={17} />
                <span>Password Reset Requests</span>
                {pendingResets.length > 0 && (
                  <span className="queue-count">{pendingResets.length} awaiting review</span>
                )}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: '4px' }}>
                Approving sets the account back to <strong className="mono">{DEFAULT_PASSWORD}</strong> and
                clears any lockout. Confirm who is asking before you approve.
              </p>
            </div>
            {passwordResets.length > pendingResets.length && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                onClick={() => setShowAllResets(v => !v)}>
                {showAllResets ? 'Show pending only' : `Show all (${passwordResets.length})`}
              </button>
            )}
          </div>

          {visibleResets.length === 0 ? (
            <EmptyState title="Nothing awaiting review" hint="Password reset requests will appear here." icon={KeyRound} />
          ) : (
            <div className="table-container" style={{ maxHeight: 'none' }}>
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Plant</th>
                    <th>Reason given</th>
                    <th>Requested</th>
                    <th>Status</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleResets.map((reset) => (
                    <tr key={reset.id}>
                      <td>
                        <strong className="mono">{reset.username}</strong>
                        {reset.name && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{reset.name}</div>}
                        {reset.locked && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--danger-text)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <Lock size={11} /> locked out
                          </div>
                        )}
                      </td>
                      <td>
                        {reset.wbes_acronym
                          ? <><strong className="mono" style={{ color: 'var(--accent-blue)' }}>{reset.wbes_acronym}</strong>
                              {reset.energy_category && <div><span className={`energy-badge ${reset.energy_category}`}>{categoryShort(reset.energy_category)}</span></div>}
                            </>
                          : <span style={{ color: 'var(--text-muted)' }}>account deleted</span>}
                      </td>
                      <td style={{ fontSize: '0.78rem', maxWidth: '260px' }}>
                        {reset.reason || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>{formatDateDMYHM(reset.created_at)}</td>
                      <td>
                        <span className={`status-badge ${reset.status.toLowerCase()}`}>{reset.status}</span>
                        {reset.status !== 'Pending' && reset.reviewed_by && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                            by {reset.reviewed_by}
                          </div>
                        )}
                      </td>
                      <td>
                        {reset.status !== 'Pending' ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{reset.review_note || '—'}</span>
                        ) : decliningResetId === reset.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '210px' }}>
                            <textarea className="form-control" rows="2" autoFocus
                              placeholder="Why is this being declined?"
                              value={declineReason}
                              onChange={(e) => setDeclineReason(e.target.value)}
                              style={{ fontSize: '0.78rem' }} />
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button type="button" className="btn btn-danger" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                                onClick={() => handleDeclineReset(reset)}>Confirm decline</button>
                              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                                onClick={() => { setDecliningResetId(null); setDeclineReason(''); }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" className="btn btn-teal" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                              onClick={() => handleApproveReset(reset)}>Reset password</button>
                            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                              onClick={() => { setDecliningResetId(reset.id); setDeclineReason(''); }}>Decline</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex-row-between">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users />
            <span>User Directory Registry</span>
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            Register new energy stations, handle account locks/unlocks, and bulk-load users.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => { setShowAddForm(!showAddForm); setShowImport(false); }}>
            <UserPlus size={16} />
            {showAddForm ? 'Close Add Form' : 'Register User'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setShowImport(!showImport); setShowAddForm(false); }}>
            <FileUp size={16} />
            {showImport ? 'Close Importer' : 'Bulk CSV Upload'}
          </button>
          <button className="btn btn-warning" onClick={handleRollback} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--warn-strong)', color: '#fff' }}>
            <Undo2 size={16} />
            Revert Last CSV Import
          </button>
          <button className="btn btn-teal" onClick={handleExportCSV}>
            <Download size={16} />
            Download Directory
          </button>
        </div>
      </div>

      {/* Register Individual Form */}
      {showAddForm && (
        <div className="glass-panel" style={{ padding: '24px', animation: 'modalFadeIn 0.2s ease-out' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '15px' }}>Create New User Account</h3>

          <Banner type="error" message={formError} />

          <Banner type="success" message={formSuccess} />

          <form onSubmit={handleAddUserSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '15px', alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-full-display-name">Full Display Name</label>
                <input id="um-full-display-name" type="text" className="form-control" placeholder="e.g. ANTA GAS Station" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-username-station-id-autopopulated">Username / Station ID (Autopopulated)</label>
                <input id="um-username-station-id-autopopulated" type="text" className="form-control" placeholder="e.g. usr_ANTA" value={username} readOnly style={{ background: 'var(--bg-tertiary)', cursor: 'not-allowed', fontWeight: '600', color: 'var(--text-secondary)' }} required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-system-role">System Role</label>
                <select id="um-system-role" className="form-control" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="USER">USER — a station</option>
                  <option value="ADMIN">ADMIN — administers this region</option>
                  {/* Only a national administrator can appoint another. */}
                  {isNational(currentUser) && (
                    <option value="SUPERADMIN">NATIONAL ADMIN — can also open new regions</option>
                  )}
                </select>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  {role === 'ADMIN'
                    ? 'Sees and manages this region only, and can add further admins to it.'
                    : role === 'SUPERADMIN'
                      ? 'The same view as an admin, plus the ability to open another region by giving it its first administrator.'
                      : 'Files and tracks discrepancies for its own station.'}
                </small>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-primary-email-address-mandatory">Primary Email Address (Mandatory)</label>
                <input id="um-primary-email-address-mandatory" type="email" className="form-control" placeholder="station@utility.in" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-secondary-email-optional">Secondary Email (Optional)</label>
                <input id="um-secondary-email-optional" type="email" className="form-control" placeholder="station2@utility.in" value={email2} onChange={(e) => setEmail2(e.target.value)} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-tertiary-email-optional">Tertiary Email (Optional)</label>
                <input id="um-tertiary-email-optional" type="email" className="form-control" placeholder="station3@utility.in" value={email3} onChange={(e) => setEmail3(e.target.value)} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-mobile-number-optional">Mobile Number (Optional)</label>
                <input id="um-mobile-number-optional" type="text" className="form-control" placeholder="+91 XXXXXXXXXX" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-initial-password">Initial Password</label>
                <input id="um-initial-password" type="text" className="form-control" placeholder={DEFAULT_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
                {password && validatePassword(password) && (
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

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-wbes-acronym-compulsory">WBES Acronym (Compulsory)</label>
                <input id="um-wbes-acronym-compulsory" 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. ANTA" 
                  value={wbesAcronym} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setWbesAcronym(val);
                    // Same convention as the rest of the registry: ANTA → anta@nrldc.
                    setUsername(defaultUsernameFor(val));
                  }} 
                  required 
                />
              </div>

              {/* Only the national administrator can open another region, and
                  only by giving it an admin. Everything else is created here,
                  in this region, so the field would be a decoy. */}
              {isNational(currentUser) && role === 'ADMIN' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="um-region">Region this admin will run</label>
                  <select id="um-region" className="form-control" value={newUserRegion}
                    onChange={(e) => setNewUserRegion(e.target.value)}>
                    {REGIONS.map(r => (
                      <option key={r.code} value={r.code}>{r.name} — {r.code}</option>
                    ))}
                  </select>
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                    Choosing another centre opens it: this account becomes its first
                    administrator, and can then add its own stations and admins.
                  </small>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-category">Category</label>
                <select id="um-category" className="form-control" value={energyCategory} onChange={(e) => setEnergyCategory(e.target.value)}>
                  <option value="ISGS">{categoryLabel('ISGS')}</option>
                  <option value="RE">{categoryLabel('RE')}</option>
                  <option value="States">States</option>
                  {/* A QCA account is always Renewable Energy — see the QCA/RE rule. */}
                  <option value="QCA">QCA (Renewable Energy)</option>
                </select>
              </div>

              {energyCategory === 'QCA' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="um-qca-name-compulsory">QCA Name (Compulsory)</label>
                  <input id="um-qca-name-compulsory" type="text" className="form-control" placeholder="e.g. QCA Alpha" value={qcaName} onChange={(e) => setQcaName(e.target.value)} required />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>QCAs coordinate Renewable Energy plants only; this account is registered under RE.</small>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '5px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }} htmlFor="um-setbypass2fa-e-target-checked-style-bypass-2fa-otp-verification-for-this-account">
                <input
                  type="checkbox"
                  checked={bypass2FA}
                  onChange={(e) => setBypass2FA(e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                  Bypass 2FA OTP verification for this account
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                <input id="um-setbypass2fa-e-target-checked-style-bypass-2fa-otp-verification-for-this-account"
                  type="checkbox"
                  checked={canUploadCycleData}
                  onChange={(e) => setCanUploadCycleData(e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                  Authorize Open / Closed Cycle Data Upload Page Access
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary">Create User Account</button>
            </div>
          </form>
        </div>
      )}

      {/* CSV Bulk Importer */}
      {showImport && (
        <div className="glass-panel" style={{ padding: '24px', animation: 'modalFadeIn 0.2s ease-out' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '10px' }}>CSV User Directory Batch Importer</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '15px' }}>
            Paste comma-separated CSV rows. Duplicate usernames will be ignored. Admin creation is restricted to protect security (forced role = USER). 
            System automatically takes a registry backup before execution so you can rollback at any time.
          </p>

          <Banner type="error" message={importError} />

          <Banner type="success" message={importSuccess} />

          <form onSubmit={handleCsvImport}>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label htmlFor="um-csv-text-headers-name-username-email-category">CSV Text (Headers: Name, Username, Email, Category)</label>
                <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={loadSampleCSV}>
                  Load Sample Template
                </button>
              </div>
              <textarea id="um-csv-text-headers-name-username-email-category"
                rows="6"
                className="form-control"
                placeholder="Paste CSV rows here..."
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowImport(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Process Import</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="glass-panel" style={{ padding: '15px 20px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,0,0,0.04)', padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', minWidth: '280px' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-control"
            placeholder="Search by Name, Username or Email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', background: 'transparent', padding: '6px 0', width: '100%', outline: 'none', boxShadow: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Filter Role:</span>
          <select
            className="form-control"
            style={{ width: '130px', padding: '6px 12px' }}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="ALL">ALL ROLES</option>
            <option value="ADMIN">ADMIN</option>
            <option value="USER">USER</option>
          </select>
        </div>

        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          Showing <strong>{filteredUsers.length}</strong> of <strong>{users.length}</strong> registered users.
          {loading && <span style={{ marginLeft: '8px', color: 'var(--accent-blue)' }}>Loading...</span>}
        </div>
      </div>

      {/* Users Table */}
      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Station / Full Name</th>
              <th>Role</th>
              <th>Username</th>
              <th>WBES Acronym</th>
              <th>Mandatory Email</th>
              <th>Category</th>
              <th>OTP</th>
              <th>Cycle Upload</th>
              <th>Account Status</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} columns={10} />
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan="9">
                  <EmptyState
                    title="No users match"
                    hint={searchQuery || roleFilter !== 'ALL'
                      ? 'No accounts match the current search or role filter.'
                      : 'No user accounts have been registered yet.'}
                    icon={Users}
                  />
                </td>
              </tr>
            ) : filteredUsers.map((user) => (
              <tr key={user.username} className={user.energy_category}>
                <td style={{ fontWeight: '500' }}>{user.name}</td>
                <td>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    background: ADMIN_ROLES.includes(user.role) ? 'rgba(37,99,235,0.1)' : (user.role === 'QCA' || user.qca_name ? 'rgba(245,158,11,0.1)' : 'rgba(15,118,110,0.1)'),
                    color: ADMIN_ROLES.includes(user.role) ? 'var(--link-text)' : (user.role === 'QCA' || user.qca_name ? 'var(--warn-strong)' : 'var(--success-text)'),
                    border: `1px solid ${ADMIN_ROLES.includes(user.role) ? 'rgba(37,99,235,0.2)' : (user.role === 'QCA' || user.qca_name ? 'rgba(245,158,11,0.2)' : 'rgba(15,118,110,0.2)')}`,
                  }}>
                    {user.role === 'QCA' || user.qca_name ? 'QCA' : user.role}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace' }}>{user.username}</td>
                <td><strong style={{ fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{user.wbes_acronym || '-'}</strong></td>
                <td>{user.email}</td>
                <td>
                  <span className={`energy-badge ${ADMIN_ROLES.includes(user.role) ? 'admin' : (user.qca_name ? 'QCA' : user.energy_category)}`}>
                    {user.role === 'SUPERADMIN' ? 'National' : user.role === 'ADMIN' ? 'Admin' : (user.qca_name ? 'QCA' : user.energy_category)}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleToggleBypass2FA(user)}
                    title={user.bypass_2fa
                      ? 'OTP is disabled for this user — click to require it again'
                      : 'OTP is required — click to let this user sign in without it'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontWeight: '600',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      border: `1px solid ${user.bypass_2fa ? 'rgba(217,119,6,0.35)' : 'var(--border-color)'}`,
                      background: user.bypass_2fa ? 'rgba(245,158,11,0.10)' : 'transparent',
                      borderRadius: '6px',
                      padding: '3px 9px',
                      color: user.bypass_2fa ? 'var(--warn-text)' : 'var(--text-muted)',
                    }}
                  >
                    {user.bypass_2fa ? <X size={13} /> : <Check size={13} />}
                    {user.bypass_2fa ? 'OTP off' : 'OTP on'}
                  </button>
                </td>
                <td>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: user.can_upload_cycle_data ? 'var(--accent-teal)' : 'var(--text-muted)'
                  }}>
                    {user.can_upload_cycle_data ? <CheckCircle2 size={14} style={{ color: 'var(--accent-teal)' }} /> : <X size={14} />}
                    {user.can_upload_cycle_data ? 'Authorized' : 'None'}
                  </span>
                </td>
                <td>
                  <span className={`status-badge ${user.locked ? 'rejected' : 'resolved'}`}>
                    {user.locked ? 'LOCKED' : 'ACTIVE'}
                  </span>
                </td>
                <td style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  <button
                    className="lock-icon-btn"
                    style={{ color: '#2563eb' }}
                    onClick={() => handleOpenEdit(user)}
                    title="Edit User Details"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className={`lock-icon-btn ${user.locked ? 'locked' : 'unlocked'}`}
                    onClick={() => handleToggleLock(user.username)}
                    title={user.locked ? 'Unlock Account' : 'Lock Account'}
                  >
                    {user.locked ? <Lock size={16} /> : <Unlock size={16} />}
                  </button>
                  <button
                    className="lock-icon-btn"
                    style={{ color: 'var(--warn-strong)' }}
                    onClick={() => handleResetPassword(user.username)}
                    title="Reset Password to Default"
                  >
                    <Key size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content glass-panel" style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Edit User Details</h3>
              <button type="button" className="modal-close" onClick={() => setEditingUser(null)} aria-label="Close dialog" style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <Banner type="error" message={editError} />

            <Banner type="success" message={editSuccess} />

            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-display-name">Display Name</label>
                <input id="um-display-name" type="text" className="form-control" value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-primary-email-address-mandatory-2">Primary Email Address (Mandatory)</label>
                <input id="um-primary-email-address-mandatory-2" type="email" className="form-control" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-secondary-email-optional-2">Secondary Email (Optional)</label>
                <input id="um-secondary-email-optional-2" type="email" className="form-control" placeholder="No secondary email" value={editEmail2} onChange={(e) => setEditEmail2(e.target.value)} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-tertiary-email-optional-2">Tertiary Email (Optional)</label>
                <input id="um-tertiary-email-optional-2" type="email" className="form-control" placeholder="No tertiary email" value={editEmail3} onChange={(e) => setEditEmail3(e.target.value)} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-mobile-number-optional-2">Mobile Number (Optional)</label>
                <input id="um-mobile-number-optional-2" type="text" className="form-control" placeholder="No mobile number" value={editMobile} onChange={(e) => setEditMobile(e.target.value)} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-role">Role</label>
                <select id="um-role" className="form-control" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-category-2">Category</label>
                <select id="um-category-2" className="form-control" value={editEnergyCategory} onChange={(e) => setEditEnergyCategory(e.target.value)}>
                  <option value="ISGS">{categoryLabel('ISGS')}</option>
                  <option value="RE">{categoryLabel('RE')}</option>
                  <option value="States">States</option>
                  {/* A QCA account is always Renewable Energy — see the QCA/RE rule. */}
                  <option value="QCA">QCA (Renewable Energy)</option>
                </select>
              </div>

              {editEnergyCategory === 'QCA' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="um-qca-name-compulsory-2">QCA Name (Compulsory)</label>
                  <input id="um-qca-name-compulsory-2" type="text" className="form-control" placeholder="e.g. QCA Alpha" value={editQcaName} onChange={(e) => setEditQcaName(e.target.value)} required />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>QCAs coordinate Renewable Energy plants only; this account is registered under RE.</small>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-wbes-acronym-compulsory-2">WBES Acronym (Compulsory)</label>
                <input id="um-wbes-acronym-compulsory-2" type="text" className="form-control" value={editWbesAcronym} onChange={(e) => setEditWbesAcronym(e.target.value)} required />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="um-override-password-leave-blank-to-keep-current">Override Password (leave blank to keep current)</label>
                <input id="um-override-password-leave-blank-to-keep-current" type="password" className="form-control" placeholder="Enter new custom password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }} htmlFor="um-seteditbypass2fa-e-target-checked-style-bypass-2fa-otp-verification-for-this-account">
                  <input
                    type="checkbox"
                    checked={editBypass2FA}
                    onChange={(e) => setEditBypass2FA(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                    Bypass 2FA OTP verification for this account
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                  <input id="um-seteditbypass2fa-e-target-checked-style-bypass-2fa-otp-verification-for-this-account"
                    type="checkbox"
                    checked={editCanUploadCycleData}
                    onChange={(e) => setEditCanUploadCycleData(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                    Authorize Open / Closed Cycle Data Upload Page Access
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingUser(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
