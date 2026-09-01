import React, { useState, useEffect } from 'react';
import { getRegions, createRegion, updateRegion, getRegionUsers } from '../services/db';
import { DEFAULT_PASSWORD } from '../utils/password';
import { Banner, EmptyState, SkeletonRows } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';
import ConfirmDialog from './ConfirmDialog';
import { Globe2, Plus, Users, ShieldCheck, X, Pause, Play } from 'lucide-react';
import { formatDateDMY } from '../utils/format';

/**
 * NationalAdmin — the national level of the hierarchy.
 *
 * This page creates and manages regions and their administrators, and nothing
 * else. Creating ordinary users is deliberately absent: a region's users are
 * its own administrator's responsibility, and putting the control here would
 * blur the level this page sits at. The server refuses it too, so the omission
 * is the interface agreeing with the rule rather than hiding it.
 */
export default function NationalAdmin({ currentUser }) {
  const { notice, notify, clearNotice, askConfirm, confirmProps } = useFeedback();
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [acronym, setAcronym] = useState('');
  const [name, setName] = useState('');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  // The region whose users are open beneath its row.
  const [openRegion, setOpenRegion] = useState(null);
  const [regionUsers, setRegionUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  async function load() {
    setLoadError('');
    setLoading(true);
    try {
      setRegions(await getRegions());
    } catch (e) {
      setLoadError(e.message || 'Could not load the regions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { Promise.resolve().then(() => load()); }, []);

  const previewUsername = acronym.trim()
    ? `${(adminUsername || 'admin').trim().split('@')[0].toLowerCase() || 'admin'}@${acronym.trim().toLowerCase()}`
    : '';

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!/^[A-Za-z0-9]{2,10}$/.test(acronym.trim())) {
      setFormError('The acronym must be 2–10 letters or digits — it becomes the namespace this region’s users are named in.');
      return;
    }
    if (!name.trim()) { setFormError('Give the region its full name.'); return; }
    if (!adminName.trim() || !adminEmail.trim()) {
      setFormError('A region needs an administrator: give a name and an email address.');
      return;
    }
    setCreating(true);
    try {
      const res = await createRegion({
        acronym: acronym.trim().toUpperCase(),
        name: name.trim(),
        adminUsername: adminUsername.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
      });
      setShowCreate(false);
      setAcronym(''); setName(''); setAdminUsername('admin'); setAdminName(''); setAdminEmail('');
      await load();
      notify('success', res.message + (res.usedDefaultPassword
        ? ` They sign in with the default password "${DEFAULT_PASSWORD}" and should change it.` : ''));
    } catch (err) {
      setFormError(err.message || 'Could not create the region.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = (region) => {
    const suspending = region.status === 'Active';
    askConfirm({
      title: suspending ? 'Suspend this region' : 'Reactivate this region',
      message: suspending
        ? `Suspend ${region.acronym}?\n\nIts data is kept and nothing is deleted, but no new accounts can be created in it.`
        : `Reactivate ${region.acronym}?`,
      confirmLabel: suspending ? 'Suspend region' : 'Reactivate',
      tone: suspending ? 'danger' : 'warn',
      action: async () => {
        await updateRegion(region.acronym, { status: suspending ? 'Suspended' : 'Active' });
        await load();
        notify(suspending ? 'warn' : 'success', `${region.acronym} is now ${suspending ? 'suspended' : 'active'}.`);
      },
    });
  };

  const handleViewUsers = async (region) => {
    if (openRegion === region.acronym) { setOpenRegion(null); return; }
    setOpenRegion(region.acronym);
    setUsersLoading(true);
    try {
      setRegionUsers(await getRegionUsers(region.acronym));
    } catch (err) {
      notify('error', err.message || 'Could not load that region’s users.');
      setOpenRegion(null);
    } finally {
      setUsersLoading(false);
    }
  };

  const totals = regions.reduce((acc, r) => ({
    users: acc.users + (r.user_count || 0),
    admins: acc.admins + (r.admin_count || 0),
    discrepancies: acc.discrepancies + (r.discrepancy_count || 0),
  }), { users: 0, admins: 0, discrepancies: 0 });

  return (
    <div className="dashboard-layout">
      <Banner type={notice.type} message={notice.message} onDismiss={clearNotice} />
      <Banner type="error" message={loadError} onRetry={load} />
      <ConfirmDialog {...confirmProps} />

      <div className="flex-row-between">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Globe2 />
            <span>National Administration</span>
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            Create and manage load despatch centres and their administrators.
            Each region’s own users are created by its administrator.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(v => !v)}>
          {showCreate ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Create Region</>}
        </button>
      </div>

      {regions.length > 0 && (
        <div className="national-totals">
          <div><strong>{regions.length}</strong><span>region{regions.length === 1 ? '' : 's'}</span></div>
          <div><strong>{totals.admins}</strong><span>administrator{totals.admins === 1 ? '' : 's'}</span></div>
          <div><strong>{totals.users}</strong><span>users</span></div>
          <div><strong>{totals.discrepancies.toLocaleString()}</strong><span>discrepancies</span></div>
        </div>
      )}

      {showCreate && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '4px' }}>Create a region</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '16px' }}>
            The region and its first administrator are created together — a region with
            no administrator is one nobody can manage, since users are created regionally.
          </p>
          <Banner type="error" message={formError} />
          <form onSubmit={handleCreate}>
            <div className="review-grid">
              <div className="form-group">
                <label htmlFor="na-acronym">Acronym</label>
                <input id="na-acronym" className="form-control mono" value={acronym}
                  placeholder="e.g. SRLDC" maxLength={10}
                  style={{ textTransform: 'uppercase' }}
                  onChange={(e) => setAcronym(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
                <span className="settings-field-hint">
                  Permanent. It becomes the namespace this region’s users are named in.
                </span>
              </div>
              <div className="form-group">
                <label htmlFor="na-name">Region name</label>
                <input id="na-name" className="form-control" value={name}
                  placeholder="e.g. Southern Regional Load Despatch Centre"
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="na-admin-user">Administrator username</label>
                <input id="na-admin-user" className="form-control mono" value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)} />
                <span className="settings-field-hint">
                  {previewUsername
                    ? <>Will be created as <strong className="mono">{previewUsername}</strong></>
                    : 'Enter an acronym to see the full username.'}
                </span>
              </div>
              <div className="form-group">
                <label htmlFor="na-admin-name">Administrator name</label>
                <input id="na-admin-name" className="form-control" value={adminName}
                  placeholder="e.g. S. Kumar" onChange={(e) => setAdminName(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="na-admin-email">Administrator email</label>
                <input id="na-admin-email" type="email" className="form-control" value={adminEmail}
                  placeholder="name@example.in" onChange={(e) => setAdminEmail(e.target.value)} />
                <span className="settings-field-hint">
                  They start on the default password <strong className="mono">{DEFAULT_PASSWORD}</strong> and
                  are asked for an OTP at first sign-in.
                </span>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: '14px' }} disabled={creating}>
              {creating ? 'Creating…' : 'Create region and administrator'}
            </button>
          </form>
        </div>
      )}

      <div className="table-container" style={{ maxHeight: 'none' }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Region</th>
              <th>Acronym</th>
              <th>Administrator</th>
              <th style={{ textAlign: 'right' }}>Users</th>
              <th style={{ textAlign: 'right' }}>Plants</th>
              <th style={{ textAlign: 'right' }}>Discrepancies</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && regions.length === 0 ? (
              <SkeletonRows rows={4} columns={8} />
            ) : regions.length === 0 ? (
              <tr><td colSpan="8">
                <EmptyState title="No regions yet" hint="Create the first load despatch centre to begin." icon={Globe2} />
              </td></tr>
            ) : regions.map((r) => (
              <React.Fragment key={r.acronym}>
                <tr>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td><span className="region-badge">{r.acronym}</span></td>
                  <td className="mono" style={{ fontSize: '0.78rem' }}>
                    {r.administrators || <span style={{ color: 'var(--danger-text)' }}>none — unmanaged</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.user_count}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.plant_count}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.discrepancy_count.toLocaleString()}</td>
                  <td>
                    <span className={`status-badge ${r.status === 'Active' ? 'resolved' : 'pending'}`}>{r.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                        onClick={() => handleViewUsers(r)}>
                        <Users size={13} /> {openRegion === r.acronym ? 'Hide' : 'View users'}
                      </button>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 9px' }}
                        onClick={() => handleToggleStatus(r)}
                        title={r.status === 'Active' ? 'Suspend this region' : 'Reactivate this region'}>
                        {r.status === 'Active' ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>

                {openRegion === r.acronym && (
                  <tr className="review-row">
                    <td colSpan="8">
                      <div className="review-panel">
                        <div className="review-panel-head">
                          <h4>{r.acronym} accounts</h4>
                          <p>
                            Read-only here. Users are created and managed by {r.acronym}’s own
                            administrator — see the permission model in the README.
                          </p>
                        </div>
                        {usersLoading ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</p>
                        ) : regionUsers.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No accounts in this region yet.</p>
                        ) : (
                          <div className="table-container" style={{ maxHeight: '320px' }}>
                            <table className="custom-table">
                              <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Category</th><th>Created</th></tr></thead>
                              <tbody>
                                {regionUsers.map(u => (
                                  <tr key={u.username}>
                                    <td className="mono" style={{ fontSize: '0.78rem' }}>{u.username}</td>
                                    <td>{u.name}</td>
                                    <td>
                                      <span className={`energy-badge ${['ADMIN', 'SUPERADMIN'].includes(u.role) ? 'admin' : u.energy_category}`}>
                                        {u.role === 'SUPERADMIN' ? 'National' : u.role === 'ADMIN' ? 'Admin' : u.role}
                                      </span>
                                    </td>
                                    <td>{u.energy_category}</td>
                                    <td style={{ fontSize: '0.78rem' }}>{formatDateDMY(u.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <ShieldCheck size={14} />
        Signed in as <strong className="mono">{currentUser.username}</strong> — national administrator.
        Regions are isolated from one another; this page is the only view across them.
      </p>
    </div>
  );
}
