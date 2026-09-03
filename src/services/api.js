/**
 * api.js — Frontend service layer
 * Replaces the old localStorage-based db.js.
 * All functions call the Express/PostgreSQL backend at /api/*.
 *
 * Every request carries the bearer token issued at login; the backend
 * establishes who the caller is from that token alone.
 */

const BASE = '/api';
const TOKEN_KEY = 'nrldc_session_token';
// Proof that this browser has already passed an OTP. It outlives the session
// token deliberately — that is the whole point: signing out and back in the
// next morning should not cost another email.
const DEVICE_KEY = 'nrldc_device_token';

// ─── Session token ───────────────────────────────────────────────────────────
// Every authenticated request carries the bearer token issued at login. The
// backend derives the caller's identity from it, so no endpoint trusts a
// username sent in a body or query string.

export const setAuthToken = (token) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
};

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

export const clearAuthToken = () => {
  localStorage.removeItem(TOKEN_KEY);
};

// Storage can be unavailable (private windows, blocked site data). Losing the
// device token only costs one extra OTP, so every access fails quietly.
const getDeviceToken = () => {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
};

const setDeviceToken = (token) => {
  try { if (token) localStorage.setItem(DEVICE_KEY, token); } catch { /* one more OTP, no worse */ }
};

export const clearDeviceToken = () => {
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* nothing to do */ }
};

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

/** Clears the cached session and returns to the login screen. */
function handleExpiredSession() {
  clearAuthToken();
  localStorage.removeItem('nrldc_session_user');
  // A hard reload drops all in-memory state and lands on the login screen.
  window.location.reload();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) }),
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    handleExpiredSession();
    throw new Error('Your session has expired. Please log in again.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Download a protected file. Browsers cannot attach an Authorization header to
 * a plain <a href> or window.open, so the file is fetched with the token and
 * handed to the user as a blob. This keeps the token out of URLs and server
 * access logs.
 */
export const downloadFile = async (path, fallbackName = 'download') => {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });

  if (res.status === 401) {
    handleExpiredSession();
    throw new Error('Your session has expired. Please log in again.');
  }
  if (!res.ok) {
    let message = `Download failed (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* response was not JSON */ }
    throw new Error(message);
  }

  // Prefer the filename the server put in Content-Disposition.
  let filename = fallbackName;
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename[^;=\n]*=(?:UTF-8'')?["']?([^"';\n]+)/i);
  if (match && match[1]) filename = decodeURIComponent(match[1].trim());

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// ─── Config ──────────────────────────────────────────────────────────────────

let cachedConfig = null;

export const getConfig = async () => {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await apiFetch('/config');
  return cachedConfig;
};

export const updateConfig = async (newConfig) => {
  cachedConfig = null;
  return apiFetch('/config', { method: 'PATCH', body: newConfig });
};

export const testSMTPSettings = async (settings) => {
  return apiFetch('/config/test-smtp', { method: 'POST', body: settings });
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Step one. Sends whatever device token this browser holds: if the server
 * still recognises it, the login completes here with no OTP and no email.
 */
export const loginStep1 = async (username, password) => {
  const result = await apiFetch('/auth/login', {
    method: 'POST',
    body: { username, password, deviceToken: getDeviceToken() },
  });
  if (result.token) setAuthToken(result.token);
  return result;
};

/**
 * Step two. A correct code also returns a device token, which this browser
 * keeps so the next sign-in within the trust window needs no code.
 */
export const verifyOTP = async (username, otp) => {
  const result = await apiFetch('/auth/verify-otp', { method: 'POST', body: { username, otp } });
  if (result.token) setAuthToken(result.token);
  if (result.deviceToken) setDeviceToken(result.deviceToken);
  return result;
};

/**
 * Sign out. Tells the server to revoke this token before discarding it, so a
 * copied token cannot keep being used for the rest of its 8-hour life. The
 * local session is cleared even if that call fails.
 */
/**
 * Submit a self-service registration. Creates a request for an administrator
 * to approve — not an account — so no token is involved.
 */
export const registerAccount = async (payload) => {
  return apiFetch('/auth/register', { method: 'POST', body: payload });
};

/**
 * Public WBES acronym search for the sign-up screen. Returns the registerable
 * entities matching the term — { wbes_acronym, name, region } — so an applicant
 * can pick their plant and have the display name, region and username filled in.
 * No token: the caller is not signed in yet.
 */
export const searchWbesForRegistration = async (search) => {
  const q = new URLSearchParams({ search });
  return apiFetch(`/auth/wbes-lookup?${q.toString()}`);
};

export const getRegistrations = async (status = 'ALL') => {
  return apiFetch(`/users/registrations?status=${encodeURIComponent(status)}`);
};

/**
 * Approve or reject a registration. `edits` carries any corrections the admin
 * made on the approval screen — only the fields they actually changed. The
 * server applies them over the stored application; everything it does not
 * receive comes from the original submission.
 */
export const processRegistration = async (id, status, note = '', edits = null) => {
  return apiFetch(`/users/registrations/${id}/process`, {
    method: 'PATCH',
    body: edits && Object.keys(edits).length > 0 ? { status, note, edits } : { status, note },
  });
};

/**
 * Ask an administrator to reset a password. Public — the caller is locked out,
 * so there is no token. Nothing changes until an admin approves it.
 */
export const requestPasswordReset = async (username, reason = '') => {
  return apiFetch('/auth/request-password-reset', {
    method: 'POST',
    body: { username, reason },
  });
};

export const getPasswordResets = async (status = 'ALL') => {
  return apiFetch(`/users/password-resets?status=${encodeURIComponent(status)}`);
};

export const processPasswordReset = async (id, status, note = '') => {
  return apiFetch(`/users/password-resets/${id}/process`, {
    method: 'PATCH',
    body: { status, note },
  });
};

export const logout = async () => {
  try {
    if (getAuthToken()) {
      await apiFetch('/auth/logout', { method: 'POST' });
    }
  } catch {
    // Network or server error — sign out locally regardless.
  } finally {
    clearAuthToken();
    localStorage.removeItem('nrldc_session_user');
  }
};

// ─── Users ───────────────────────────────────────────────────────────────────

export const getUsers = async () => {
  return apiFetch('/users');
};

export const registerUser = async (userData) => {
  return apiFetch('/users', { method: 'POST', body: userData });
};

export const toggleUserLock = async (username) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/lock`, { method: 'PATCH' });
};

export const changeProfileSettings = async (username, profileDataOrPassword) => {
  const body = typeof profileDataOrPassword === 'string' ? { password: profileDataOrPassword } : profileDataOrPassword;
  return apiFetch(`/users/${encodeURIComponent(username)}/profile`, {
    method: 'PATCH',
    body: body,
  });
};

export const toggleUserBypass2FA = async (username) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/bypass-2fa`, { method: 'PATCH' });
};

export const resetUserPasswordAdmin = async (username) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/reset-password`, {
    method: 'POST'
  });
};

/** Ask for a reset code by email. No second code is sent while one is live. */
export const forgotPassword = async (username) => {
  return apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: { username }
  });
};

/**
 * Finish the reset with the emailed code and a password of the user's own
 * choosing. Their trusted devices are dropped server-side, so this browser's
 * stale device token goes too.
 */
export const resetPasswordWithCode = async (username, otp, password) => {
  const result = await apiFetch('/auth/reset-password', {
    method: 'POST',
    body: { username, otp, password },
  });
  if (result.success) clearDeviceToken();
  return result;
};

// ─── Trusted devices and the mail budget ─────────────────────────────────────

export const getTrustedDevices = async (username) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/devices`);
};

export const revokeTrustedDevices = async (username) => {
  const result = await apiFetch(`/users/${encodeURIComponent(username)}/devices`, { method: 'DELETE' });
  clearDeviceToken();
  return result;
};

// ─── Trades and consent ─────────────────────────────────────────────────────

// Plant acronyms across every region. A trader naming the other side of a
// trade needs entities their own centre does not despatch, which the
// region-scoped register above deliberately will not return.
export const searchWbesDirectory = async (search, region) => {
  const q = new URLSearchParams({ search });
  if (region) q.set('region', region);
  return apiFetch(`/users/wbes-directory?${q.toString()}`);
};

// The seller's region answers: 'consent' or 'refuse'.
export const decideConsent = async (reqNo, decision, remark) =>
  apiFetch(`/discrepancies/${encodeURIComponent(reqNo)}/consent`, {
    method: 'PATCH', body: { decision, remark },
  });

// The buyer's region writes down consent obtained off the portal. The remark
// is mandatory — it is the only evidence the ticket will carry.
export const recordOfflineConsent = async (reqNo, remark, files) =>
  apiFetch(`/discrepancies/${encodeURIComponent(reqNo)}/offline-consent`, {
    method: 'PATCH', body: { remark, files },
  });

// ─── Regions (national level) ────────────────────────────────────────────────

export const getRegions = async () => apiFetch('/regions');

export const createRegion = async (payload) =>
  apiFetch('/regions', { method: 'POST', body: payload });

export const updateRegion = async (acronym, changes) =>
  apiFetch(`/regions/${encodeURIComponent(acronym)}`, { method: 'PATCH', body: changes });

export const getRegionUsers = async (acronym) =>
  apiFetch(`/regions/${encodeURIComponent(acronym)}/users`);

// Give a region an administrator it does not have. National-level: a region
// without one cannot create its own users, so nobody inside it can fix it.
export const addRegionAdmin = async (acronym, payload) =>
  apiFetch(`/regions/${encodeURIComponent(acronym)}/admins`, { method: 'POST', body: payload });

// Raise an account that already belongs to the region to administer it — the
// recovery path when a region has its users but no administrator.
export const promoteRegionAdmin = async (acronym, username) =>
  apiFetch(`/regions/${encodeURIComponent(acronym)}/admins/promote`, { method: 'POST', body: { username } });

// Remove an administrator (demote to a regular user; ?hard deletes an unused
// bootstrap admin outright, falling back to demote if it is referenced).
export const removeRegionAdmin = async (acronym, username, { hard = false } = {}) =>
  apiFetch(`/regions/${encodeURIComponent(acronym)}/admins/${encodeURIComponent(username)}${hard ? '?hard=1' : ''}`,
    { method: 'DELETE' });

export const getMailUsage = async () => {
  return apiFetch('/config/mail-usage');
};

export const updateUserAdmin = async (username, userData) => {
  return apiFetch(`/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: userData,
  });
};

export const updateAdminPreference = async (username, preferredLanding) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/landing`, {
    method: 'PATCH',
    body: { preferredLanding },
  });
};

// ─── Discrepancies ────────────────────────────────────────────────────────────

export const uploadFiles = async (formData) => {
  const res = await fetch(`${BASE}/discrepancies/upload`, {
    method: 'POST',
    headers: authHeaders(),   // no Content-Type: the browser sets the multipart boundary
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

export const getDiscrepancies = async (params = {}) => {
  let queryParts = [];
  if (typeof params === 'string') {
    queryParts.push(`username=${encodeURIComponent(params)}`);
  } else if (params && typeof params === 'object') {
    const { username, fromDate, toDate, page, limit, status, category, search, type } = params;
    if (username) queryParts.push(`username=${encodeURIComponent(username)}`);
    if (fromDate) queryParts.push(`fromDate=${encodeURIComponent(fromDate)}`);
    if (toDate) queryParts.push(`toDate=${encodeURIComponent(toDate)}`);
    if (page) queryParts.push(`page=${page}`);
    if (limit) queryParts.push(`limit=${limit}`);
    if (status) queryParts.push(`status=${encodeURIComponent(status)}`);
    if (category) queryParts.push(`category=${encodeURIComponent(category)}`);
    if (search) queryParts.push(`search=${encodeURIComponent(search)}`);
    if (type) queryParts.push(`type=${encodeURIComponent(type)}`);
  }
  const query = queryParts.length > 0 ? '?' + queryParts.join('&') : '';
  return apiFetch(`/discrepancies${query}`);
};

/**
 * File a discrepancy.
 *
 * `trade` is for a Traders account only — { buyerRegion, sellerRegion,
 * buyerAcronym, sellerAcronym } — and the server refuses it from anyone else
 * rather than ignoring it. Passed as an object rather than four more
 * positional arguments, which at this length would be unreadable at the call
 * site and easy to transpose.
 */
export const createDiscrepancy = async (username, correctionDate, timeBlocks, requestContent, discrepancyType, files, wbes_acronym = null, trade = null) => {
  return apiFetch('/discrepancies', {
    method: 'POST',
    body: { username, correctionDate, timeBlocks, requestContent, discrepancyType, files, wbes_acronym, ...(trade || {}) },
  });
};

/**
 * Decide a filing. `flagged` is honoured only on a rejection — it records the
 * RLDC's judgement that this filer keeps raising the same thing, and feeds the
 * flagged tracker.
 */
export const processDiscrepancy = async (reqNo, status, comment, adminFiles, rejectionReason, flagged = false, flagNote = '') => {
  return apiFetch(`/discrepancies/${reqNo}/process`, {
    method: 'PATCH',
    body: { status, comment, adminFiles, rejectionReason, flagged, flagNote },
  });
};

/** Filers the RLDC has repeatedly marked, over a rolling window or a month. */
export const getFlaggedTracker = async ({ days = 30, fromDate, toDate } = {}) => {
  const q = fromDate && toDate
    ? `fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`
    : `days=${days}`;
  return apiFetch(`/discrepancies/flagged-tracker?${q}`);
};

export const reRaiseDiscrepancy = async (reqNo, username, requestContent, discrepancyType, files) => {
  return apiFetch(`/discrepancies/${reqNo}/reraise`, {
    method: 'PATCH',
    body: { username, requestContent, discrepancyType, files },
  });
};

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const getLogs = async () => {
  return apiFetch('/logs');
};

export const clearLogs = async () => {
  await apiFetch('/logs', { method: 'DELETE' });
  return [];
};

// logEvent is a no-op on the frontend — the backend logs all events internally.
// This stub is kept so old imports don't break.
export const logEvent = (type, message) => {
  // Events are logged by the backend automatically on every API call.
  console.debug(`[LOG stub] ${type}: ${message}`);
};

// initDB is a no-op — PostgreSQL is initialized via seed.js
export const initDB = () => {
  // No-op: DB is managed by the backend.
};

// ─── Outages ──────────────────────────────────────────────────────────────────

export const getOutages = async (username = null, fromDate = null, toDate = null) => {
  let query = '';
  const params = [];
  if (username) params.push(`username=${encodeURIComponent(username)}`);
  if (fromDate) params.push(`fromDate=${encodeURIComponent(fromDate)}`);
  if (toDate) params.push(`toDate=${encodeURIComponent(toDate)}`);
  if (params.length > 0) query = '?' + params.join('&');
  return apiFetch(`/outages${query}`);
};

export const createOutage = async (outageData) => {
  return apiFetch('/outages', { method: 'POST', body: outageData });
};

export const processOutageAdmin = async (id, status) => {
  return apiFetch(`/outages/${id}/process`, {
    method: 'PATCH',
    body: { status }
  });
};

export const updateOutageAdmin = async (id, outageData) => {
  return apiFetch(`/outages/${id}`, {
    method: 'PATCH',
    body: outageData
  });
};

export const deleteOutageAdmin = async (id) => {
  return apiFetch(`/outages/${id}`, {
    method: 'DELETE'
  });
};

// ─── Cycle Data ───────────────────────────────────────────────────────────────

export const uploadCycleData = async (formData) => {
  const res = await fetch(`${BASE}/cycle-data/upload`, {
    method: 'POST',
    headers: authHeaders(),   // no Content-Type: the browser sets the multipart boundary
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// The backend scopes this to the authenticated caller; the argument is kept
// for call-site compatibility and is no longer sent.
export const getMyCycleUploads = async () => {
  return apiFetch('/cycle-data/my-uploads');
};

export const getAdminCycleUploads = async (fromDate = null, toDate = null) => {
  let query = '';
  const params = [];
  if (fromDate) params.push(`fromDate=${encodeURIComponent(fromDate)}`);
  if (toDate) params.push(`toDate=${encodeURIComponent(toDate)}`);
  if (params.length > 0) query = '?' + params.join('&');
  return apiFetch(`/cycle-data/admin-list${query}`);
};

// ─── QCA & Plant Assignments ───────────────────────────────────────────────

/**
 * The entity register.
 *
 * `region` narrows to one region and is honoured for a national caller only —
 * everyone else is already confined to their own. `includeBlocked` is for the
 * registry tab in User Management, which has to show blocked acronyms so an
 * administrator can unblock them; every other caller is picking something to
 * use and gets the usable ones.
 */
export const getWbesEntities = async (search = '', { region, includeBlocked } = {}) => {
  const q = new URLSearchParams();
  if (search) q.set('search', search);
  if (region) q.set('region', region);
  if (includeBlocked) q.set('includeBlocked', '1');
  const query = q.toString();
  return apiFetch(`/users/wbes-entities${query ? `?${query}` : ''}`);
};

// Register one WBES acronym in the caller's region. { wbes_acronym, name, energy_category }
export const registerWbesEntity = async (payload) => {
  return apiFetch('/users/wbes-entities', { method: 'POST', body: payload });
};

/**
 * Register up to ten acronyms typed or pasted into the grid.
 *
 * `entries` is [{ name, wbes_acronym }]. `region` is required of a national
 * caller and ignored for a regional one, whose region comes from their account.
 */
export const batchRegisterWbesEntities = async (entries, region = null) => {
  return apiFetch('/users/wbes-entities/batch', {
    method: 'POST',
    body: region ? { entries, region } : { entries },
  });
};

/** Remove an acronym. Refused with 409 if anything references it. */
export const deleteWbesEntity = async (acronym) => {
  return apiFetch(`/users/wbes-entities/${encodeURIComponent(acronym)}`, { method: 'DELETE' });
};

/** Freeze or unfreeze an acronym. */
export const setWbesEntityBlocked = async (acronym, blocked, reason = '') => {
  return apiFetch(`/users/wbes-entities/${encodeURIComponent(acronym)}/block`, {
    method: 'PATCH',
    body: { blocked, reason },
  });
};

// Load the national register from an uploaded .xlsx — national administrator
// only. Pass a FormData carrying the file under "file". Each row lands in the
// region its own Region column names.
export const bulkUploadWbesEntities = async (formData) => {
  const res = await fetch(`${BASE}/users/wbes-entities/bulk`, {
    method: 'POST',
    headers: authHeaders(),   // no Content-Type: the browser sets the multipart boundary
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

export const getUserAssignments = async (username) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/assignments`);
};

export const createUserAssignment = async (username, wbes_acronym, from_date, to_date = null) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/assignments`, {
    method: 'POST',
    body: { wbes_acronym, from_date, to_date }
  });
};

export const updateUserAssignment = async (id, from_date, to_date = null) => {
  return apiFetch(`/users/assignments/${id}`, {
    method: 'PATCH',
    body: { from_date, to_date }
  });
};

export const getTransferRequests = async () => {
  return apiFetch('/users/transfer-requests');
};

export const createTransferRequest = async (wbes_acronym, to_username, effective_date, requested_by) => {
  return apiFetch('/users/transfer-requests', {
    method: 'POST',
    body: { wbes_acronym, to_username, effective_date, requested_by }
  });
};

export const processTransferRequest = async (id, status) => {
  return apiFetch(`/users/transfer-requests/${id}/process`, {
    method: 'PATCH',
    body: { status }
  });
};

export const getQcaAssociation = async (username) => {
  return apiFetch(`/users/${encodeURIComponent(username)}/qca-association`);
};

export const getQcas = async () => {
  return apiFetch('/users/qcas');
};

