import { useState, useEffect } from 'react';
import { 
  getDiscrepancies, processDiscrepancy, getConfig, updateConfig, updateAdminPreference, 
  uploadFiles, testSMTPSettings, getOutages, getAdminCycleUploads, processOutageAdmin,
  getTransferRequests, processTransferRequest, updateOutageAdmin, deleteOutageAdmin,
  downloadFile, getMailUsage
} from '../services/db';
import {
  BarChart3, FileText, LayoutDashboard, Search,
  CheckCircle2, XCircle, Download, Check, Save, Zap, Undo2,
  Edit, Trash2, Mail
} from 'lucide-react';
import UserManagement from './UserManagement';
import ConfirmDialog from './ConfirmDialog';
import { Banner, EmptyState, SkeletonRows } from './Feedback';
import { useFeedback } from '../hooks/useFeedback';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { originalFilename } from '../utils/filenames';
import { FILTERABLE_TYPES } from '../utils/discrepancyTypes';
import { formatDateDMY, formatDateDMYHM, getStatusPriority, todayISO, daysAgoISO, shiftDaysISO, nowDatetimeLocal } from '../utils/format';


export default function AdminDashboard({ currentUser, onUserUpdate, activeTab }) {
  const { notice, notify, clearNotice, askConfirm, confirmProps } = useFeedback();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [discrepancies, setDiscrepancies] = useState([]);
  const [config, setConfig] = useState({ maxDays: 5, lockoutAttempts: 3, allowExtended: true, extendedMaxDays: 15, reraiseWindow: 45, reraiseLimit: 2, outage_ISGS: true, outage_RE: true, outage_States: false });

  // Outages & Cycle Upload lists (Admin view)
  const [outagesList, setOutagesList] = useState([]);
  const [cycleList, setCycleList] = useState([]);
  const [outageTypeFilter, setOutageTypeFilter] = useState('All');

  // Editing outage state
  const [editingOutage, setEditingOutage] = useState(null);
  const [editOutageUnitNumber, setEditOutageUnitNumber] = useState('');
  const [editOutageType, setEditOutageType] = useState('Partial Outage');
  const [editOutageFrom, setEditOutageFrom] = useState('');
  const [editOutageTo, setEditOutageTo] = useState('');
  const [editOutageReason, setEditOutageReason] = useState('');
  const [editOutageStatus, setEditOutageStatus] = useState('Pending');
  const [editOutageError, setEditOutageError] = useState('');
  const [editOutageSuccess, setEditOutageSuccess] = useState('');

  // Pagination states
  const [totalRecords, setTotalRecords] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(parseInt(localStorage.getItem('preferredPageSize') || '50'));

  // Transfer request approvals states
  const [transferRequests, setTransferRequests] = useState([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('both');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState(daysAgoISO(30));
  const [toDate, setToDate] = useState(todayISO());
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Working Date Mode Filters
  const [workingDateMode, setWorkingDateMode] = useState(false);
  const [workingDate, setWorkingDate] = useState(todayISO());

  // Modal state
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [correctiveAction, setCorrectiveAction] = useState('Approved and Resolved');
  const [rejectionReason, setRejectionReason] = useState('');
  const [adminAttachments, setAdminAttachments] = useState([]);
  const [modalMode, setModalMode] = useState('');

  // Settings state
  const [maxDays, setMaxDays] = useState(5);
  const [lockoutAttempts, setLockoutAttempts] = useState(3);
  const [allowExtended, setAllowExtended] = useState(true);
  const [extendedMaxDays, setExtendedMaxDays] = useState(15);
  const [reraiseWindow, setReraiseWindow] = useState(45);
  const [reraiseLimit, setReraiseLimit] = useState(2);
  const [require2FA, setRequire2FA] = useState(true);
  const [featureCycleData, setFeatureCycleData] = useState(true);
  const [outageISGS, setOutageISGS] = useState(true);
  const [outageRE, setOutageRE] = useState(true);
  const [outageStates, setOutageStates] = useState(false);
  const [landingPref, setLandingPref] = useState('both');
  const [configSuccess, setConfigSuccess] = useState('');

  // Mail budget. The plan allows a few hundred messages a day, and otpTrustDays
  // is the lever that decides how many the portal actually needs.
  const [otpTrustDays, setOtpTrustDays] = useState(7);
  const [resetOtpMinutes, setResetOtpMinutes] = useState(20);
  const [mailDailyCap, setMailDailyCap] = useState(280);
  const [mailUsage, setMailUsage] = useState(null);

  // SMTP States
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // SMTP Test States
  const [testRecipient, setTestRecipient] = useState('');
  const [smtpTestSuccess, setSmtpTestSuccess] = useState('');
  const [smtpTestError, setSmtpTestError] = useState('');
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);

  async function loadData() {
    setLoadError('');
    setIsLoading(true);
    try {
      const params = {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        category: categoryFilter !== 'both' ? categoryFilter : undefined,
        search: searchQuery || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
        page: currentPage,
        limit: pageSize
      };

      const [discsRes, cfg] = await Promise.all([
        getDiscrepancies(params),
        getConfig()
      ]);
      setDiscrepancies(discsRes.data || []);
      setTotalRecords(discsRes.total || 0);
      setConfig(cfg);
      setMaxDays(cfg.maxDays);
      setLockoutAttempts(cfg.lockoutAttempts);
      setAllowExtended(cfg.allowExtended === true || cfg.allowExtended === 'true');
      setExtendedMaxDays(cfg.extendedMaxDays || 15);
      setReraiseWindow(cfg.reraiseWindow || 45);
      setReraiseLimit(cfg.reraiseLimit || 2);
      setRequire2FA(cfg.require2FA !== false && cfg.require2FA !== 'false');
      setFeatureCycleData(cfg.feature_cycle_data !== false && cfg.feature_cycle_data !== 'false');
      setOutageISGS(cfg.outage_ISGS === true || cfg.outage_ISGS === 'true');
      setOutageRE(cfg.outage_RE === true || cfg.outage_RE === 'true');
      setOutageStates(cfg.outage_States === true || cfg.outage_States === 'true');
      setOtpTrustDays(cfg.otpTrustDays ?? 7);
      setResetOtpMinutes(cfg.resetOtpMinutes ?? 20);
      setMailDailyCap(cfg.mailDailyCap ?? 280);
      // Usage is informational — a failure here must not stop settings loading.
      getMailUsage().then(setMailUsage).catch(() => setMailUsage(null));
      setSmtpHost(cfg.smtpHost || 'smtp.gmail.com');
      setSmtpPort(cfg.smtpPort || '587');
      setSmtpSecure(cfg.smtpSecure === true || cfg.smtpSecure === 'true');
      setSmtpUser(cfg.smtpUser || '');
      setSmtpPass(cfg.smtpPass || '');
      setSmtpFrom(cfg.smtpFrom || '');

      if (activeTab === 'outages') {
        const outList = await getOutages(null, fromDate, toDate);
        setOutagesList(outList);
      }
      if (activeTab === 'cycle_downloads') {
        const cycleList = await getAdminCycleUploads(fromDate, toDate);
        setCycleList(cycleList);
      }
      if (activeTab === 'transfers') {
        const trList = await getTransferRequests();
        setTransferRequests(trList || []);
      }
    } catch (err) {
      // Surface the failure rather than leaving an unexplained empty table.
      console.error('[AdminDashboard] loadData error:', err.message);
      setLoadError(err.message || 'Could not load dashboard data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser) {
      const adminPref = currentUser.preferred_landing || 'both';
      Promise.resolve().then(() => {
        setCategoryFilter(adminPref);
        setLandingPref(adminPref);
      });
    }
  }, [currentUser]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 400); // 400ms debounce
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fromDate, toDate, categoryFilter, searchQuery, typeFilter, statusFilter, currentPage, pageSize]);

  const handleOpenActionModal = (req, mode) => {
    setSelectedRequest(req);
    setModalMode(mode);
    setCorrectiveAction(req.admin_comment || (mode === 'return' ? 'Returned from RLDC for Review' : 'Approved and Resolved'));
    setRejectionReason(req.rejection_reason || '');
    setAdminAttachments(req.admin_files || []);
  };

  const handleCloseModal = () => {
    setSelectedRequest(null);
    setModalMode('');
    setCorrectiveAction('Approved and Resolved');
    setRejectionReason('');
    setAdminAttachments([]);
  };

  const handleResolveSubmit = async (e) => {
    e.preventDefault();
    if (!correctiveAction.trim()) { notify('error', 'Please specify the corrective action taken.'); return; }

    try {
      const existingFilenames = adminAttachments.filter(f => typeof f === 'string');
      const newFiles = adminAttachments.filter(f => typeof f !== 'string');

      let uploadedFilenames = [];
      if (newFiles.length > 0) {
        const formData = new FormData();
        newFiles.forEach(file => {
          formData.append('files', file);
        });
        const uploadRes = await uploadFiles(formData);
        if (uploadRes.success) {
          uploadedFilenames = uploadRes.filenames;
        }
      }

      const finalAttachments = [...existingFilenames, ...uploadedFilenames];
      await processDiscrepancy(selectedRequest.req_no, 'Resolved', correctiveAction, finalAttachments, '');
      await loadData();
      handleCloseModal();
    } catch (err) {
      notify('error', err.message || 'Failed to process resolution.');
    }
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    if (!correctiveAction.trim()) { notify('error', 'Please specify the return comments / feedback.'); return; }

    try {
      const existingFilenames = adminAttachments.filter(f => typeof f === 'string');
      const newFiles = adminAttachments.filter(f => typeof f !== 'string');

      let uploadedFilenames = [];
      if (newFiles.length > 0) {
        const formData = new FormData();
        newFiles.forEach(file => {
          formData.append('files', file);
        });
        const uploadRes = await uploadFiles(formData);
        if (uploadRes.success) {
          uploadedFilenames = uploadRes.filenames;
        }
      }

      const finalAttachments = [...existingFilenames, ...uploadedFilenames];
      await processDiscrepancy(selectedRequest.req_no, 'Returned', correctiveAction, finalAttachments, '');
      await loadData();
      handleCloseModal();
    } catch (err) {
      notify('error', err.message || 'Failed to process return request.');
    }
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectionReason.trim()) { notify('error', 'Please specify the rejection reason.'); return; }
    try {
      await processDiscrepancy(selectedRequest.req_no, 'Rejected', '', [], rejectionReason);
      await loadData();
      handleCloseModal();
    } catch (err) {
      notify('error', err.message || 'Failed to reject discrepancy.');
    }
  };

  const handleProcessTransfer = (id, status) => {
    askConfirm({
      title: `${status} transfer request`,
      message: `Are you sure you want to ${status.toLowerCase()} this plant transfer request?`,
      confirmLabel: status,
      tone: status === 'Approved' ? 'warn' : 'danger',
      action: async () => {
        const res = await processTransferRequest(id, status);
        await loadData();
        if (res.success) notify('success', res.message);
      },
    });
  };

  const handleAdminFileChange = (e) => {
    const files = Array.from(e.target.files);
    setAdminAttachments(prev => [...prev, ...files]);
  };

  const removeAdminFile = (idx) => {
    setAdminAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigSuccess('');
    try {
      await updateConfig({
        maxDays: parseInt(maxDays),
        lockoutAttempts: parseInt(lockoutAttempts),
        allowExtended: String(allowExtended),
        extendedMaxDays: parseInt(extendedMaxDays),
        reraiseWindow: parseInt(reraiseWindow),
        reraiseLimit: parseInt(reraiseLimit),
        require2FA: String(require2FA),
        feature_cycle_data: String(featureCycleData),
        outage_ISGS: String(outageISGS),
        outage_RE: String(outageRE),
        outage_States: String(outageStates),
        otpTrustDays: parseInt(otpTrustDays),
        resetOtpMinutes: parseInt(resetOtpMinutes),
        mailDailyCap: parseInt(mailDailyCap),
        smtpHost,
        smtpPort,
        smtpSecure: String(smtpSecure),
        smtpUser,
        smtpPass,
        smtpFrom
      });
      await updateAdminPreference(currentUser.username, landingPref);
      if (onUserUpdate) {
        const updatedUser = { ...currentUser, preferred_landing: landingPref };
        onUserUpdate(updatedUser);
        localStorage.setItem('nrldc_session_user', JSON.stringify(updatedUser));
      }
      setConfigSuccess('System parameters, preferences, and SMTP settings updated successfully.');
      await loadData();
    } catch (err) {
      notify('error', err.message || 'Failed to save configuration settings.');
    }
  };

  const handleTestSmtp = async (e) => {
    e.preventDefault();
    setSmtpTestSuccess('');
    setSmtpTestError('');
    if (!testRecipient.trim()) {
      setSmtpTestError('Please enter a recipient email address to send the test message.');
      return;
    }
    setIsTestingSmtp(true);
    try {
      const res = await testSMTPSettings({
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser,
        smtpPass,
        smtpFrom,
        testRecipient
      });
      if (res.success) {
        setSmtpTestSuccess(res.message);
      } else {
        setSmtpTestError(res.error || 'SMTP test failed.');
      }
    } catch (err) {
      setSmtpTestError(err.message || 'SMTP test failed.');
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const handleProcessOutage = (id, status) => {
    askConfirm({
      title: `${status} outage report`,
      message: `Set the status of outage report #${id} to ${status}?`,
      confirmLabel: status,
      tone: 'warn',
      action: async () => {
        await processOutageAdmin(id, status);
        await loadData();
        notify('success', `Outage report #${id} marked ${status}.`);
      },
    });
  };

  const handleOpenEditOutage = (out) => {
    setEditingOutage(out);
    setEditOutageUnitNumber(out.unit_number);
    setEditOutageType(out.outage_type);
    
    const formatDateTimeLocal = (dateStr) => {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    
    setEditOutageFrom(formatDateTimeLocal(out.outage_from));
    setEditOutageTo(formatDateTimeLocal(out.outage_to));
    setEditOutageReason(out.reason);
    setEditOutageStatus(out.status);
    setEditOutageError('');
    setEditOutageSuccess('');
  };

  const handleEditOutageSubmit = async (e) => {
    e.preventDefault();
    setEditOutageError('');
    setEditOutageSuccess('');

    if (!editOutageUnitNumber.trim() || !editOutageFrom || !editOutageTo || !editOutageReason.trim()) {
      setEditOutageError('Please fill in all mandatory fields.');
      return;
    }

    const now = new Date();
    if (new Date(editOutageTo) > now) {
      setEditOutageError('Outage Date & Time To cannot be in the future.');
      return;
    }
    if (new Date(editOutageFrom) > now) {
      setEditOutageError('Outage Date & Time From cannot be in the future.');
      return;
    }

    try {
      await updateOutageAdmin(editingOutage.id, {
        unit_number: editOutageUnitNumber.trim(),
        outage_type: editOutageType,
        outage_from: editOutageFrom,
        outage_to: editOutageTo,
        reason: editOutageReason.trim(),
        status: editOutageStatus
      });
      setEditOutageSuccess('Outage entry updated successfully!');
      await loadData();
      setTimeout(() => {
        setEditingOutage(null);
      }, 800);
    } catch (err) {
      setEditOutageError(err.message || 'Failed to update outage.');
    }
  };

  const handleDeleteOutage = (id) => {
    askConfirm({
      title: 'Delete outage entry',
      message: `Permanently delete outage entry #${id}?\n\nThis cannot be undone.`,
      confirmLabel: 'Delete permanently',
      tone: 'danger',
      action: async () => {
        await deleteOutageAdmin(id);
        await loadData();
        notify('success', `Outage entry #${id} deleted.`);
      },
    });
  };

  // Working Date Mode Toggle
  const handleToggleWorkingDateMode = (checked) => {
    setWorkingDateMode(checked);
    if (checked) {
      setFromDate(workingDate);
      setToDate(workingDate);
    } else {
      // Revert to wide range default
      setFromDate('2026-06-01');
      setToDate('2026-07-15');
    }
  };

  const handleShiftDay = (days) => {
    const newDateStr = shiftDaysISO(workingDate, days);
    setWorkingDate(newDateStr);
    setFromDate(newDateStr);
    setToDate(newDateStr);
  };

  // Escape closes the open modal, and the page behind it stops scrolling.
  useModalDismiss(!!selectedRequest, handleCloseModal);
  useModalDismiss(!!editingOutage, () => setEditingOutage(null));

  // Filter Logic is performed on the server side, but status sorting is client-side
  const filteredRequests = [...discrepancies].sort((a, b) => {
    const pA = getStatusPriority(a.status);
    const pB = getStatusPriority(b.status);
    if (pA !== pB) return pA - pB;
    return (b.req_no || 0) - (a.req_no || 0);
  });

  const pendingRequests = discrepancies.filter(r => r.status === 'Pending');
  const totalPending = pendingRequests.length;
  const totalHistorical = discrepancies.filter(r => r.status !== 'Pending').length;

  const getChartData = () => {
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      dates.push(daysAgoISO(i));
    }
    return dates.map(date => ({
      date: date.slice(5),
      conventional: discrepancies.filter(r => r.request_date?.slice(0,10) === date && r.energy_category === 'ISGS').length,
      renewable: discrepancies.filter(r => r.request_date?.slice(0,10) === date && r.energy_category === 'RE').length,
    }));
  };

  const chartData = getChartData();
  const maxChartVal = Math.max(...chartData.map(d => d.conventional + d.renewable), 1);

  // Trigger Outage download CSV
  const handleOutagesDownload = () => {
    downloadFile(`/outages/download-excel?fromDate=${fromDate}&toDate=${toDate}&outageType=${outageTypeFilter}`, 'unit_outages.xlsx')
      .catch(err => notify('error', err.message));
  };

  // Trigger Cycle ZIP download
  const handleCycleDownload = () => {
    downloadFile(`/cycle-data/download-zip?fromDate=${fromDate}&toDate=${toDate}`, 'cycle_data.zip')
      .catch(err => notify('error', err.message));
  };

  return (
    <div className="dashboard-layout">
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

      {activeTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LayoutDashboard />
              <span>Operations Overview Dashboard</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
              NRLDC system status metrics for energy scheduling discrepancies.
            </p>
          </div>

          <div className="stats-grid">
            <div className="glass-panel stat-card" style={{ borderLeft: '4px solid var(--accent-blue)' }}>
              <div><span className="stat-label">Pending Filings</span><div className="stat-value">{totalPending}</div></div>
              <div className="stat-icon-wrapper" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)' }}><FileText size={24} /></div>
            </div>
            <div className="glass-panel stat-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div><span className="stat-label">Historical Requests</span><div className="stat-value">{totalHistorical}</div></div>
              <div className="stat-icon-wrapper" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}><CheckCircle2 size={24} /></div>
            </div>
          </div>

          <div className="chart-container glass-panel">
            <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart3 size={18} style={{ color: 'var(--accent-blue)' }} />
              Schedule Discrepancy Submission Trends (Last 7 Days)
            </h3>
            <div style={{ position: 'relative', height: '220px', width: '100%', marginTop: '10px' }}>
              <svg className="chart-svg" viewBox="0 0 700 200" preserveAspectRatio="none">
                <line x1="40" y1="40" x2="680" y2="40" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                <line x1="40" y1="90" x2="680" y2="90" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                <line x1="40" y1="140" x2="680" y2="140" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                <line x1="40" y1="180" x2="680" y2="180" stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
                {chartData.map((d, index) => {
                  const x = 70 + index * 85;
                  const convHeight = (d.conventional / maxChartVal) * 120;
                  const reHeight = (d.renewable / maxChartVal) * 120;
                  const convY = 180 - convHeight;
                  const reY = convY - reHeight;
                  return (
                    <g key={index}>
                      {d.conventional > 0 && <rect x={x} y={convY} width="35" height={convHeight} fill="url(#blueGrad)" rx="3" />}
                      {d.renewable > 0 && <rect x={x} y={reY} width="35" height={reHeight} fill="url(#tealGrad)" rx="3" />}
                      <text x={x + 17.5} y="195" fill="var(--text-secondary)" fontSize="10" textAnchor="middle">{d.date}</text>
                      {(d.conventional + d.renewable) > 0 && (
                        <text x={x + 17.5} y={reY - 8} fill="var(--text-primary)" fontSize="10" fontWeight="bold" textAnchor="middle">
                          {d.conventional + d.renewable}
                        </text>
                      )}
                    </g>
                  );
                })}
                <defs>
                  <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#1d4ed8" />
                  </linearGradient>
                  <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" /><stop offset="100%" stopColor="#0f766e" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'requests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="flex-row-between">
            <div>
              <h2>Discrepancy Requests</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                Manage energy station discrepancy filings, review details, and resolve/reject/return records.
              </p>
            </div>
            <div className="category-tabs">
              <button className={`category-tab ${categoryFilter === 'both' ? 'active' : ''}`} onClick={() => setCategoryFilter('both')}>All Categories</button>
              <button className={`category-tab ${categoryFilter === 'ISGS' ? 'active' : ''}`} onClick={() => setCategoryFilter('ISGS')}>ISGS</button>
              <button className={`category-tab ${categoryFilter === 'RE' ? 'active' : ''}`} onClick={() => setCategoryFilter('RE')}>RE</button>
              <button className={`category-tab ${categoryFilter === 'States' ? 'active' : ''}`} onClick={() => setCategoryFilter('States')}>States</button>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="ad-search-request">Search Request</label>
                <div style={{ position: 'relative' }}>
                  <input id="ad-search-request" type="text" className="form-control" placeholder="Req No, Station Name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ paddingLeft: '36px' }} />
                  <Search size={14} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                </div>
              </div>
              
              {!workingDateMode && (
                <>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor="ad-correction-from-date">Correction From Date</label>
                    <input id="ad-correction-from-date" type="date" className="form-control" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor="ad-correction-to-date">Correction To Date</label>
                    <input id="ad-correction-to-date" type="date" className="form-control" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  </div>
                </>
              )}

              {workingDateMode && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ad-working-date">Working Date</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input id="ad-working-date" type="date" className="form-control" value={workingDate} onChange={(e) => { setWorkingDate(e.target.value); setFromDate(e.target.value); setToDate(e.target.value); }} />
                    <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => handleShiftDay(-1)}>◀</button>
                    <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => handleShiftDay(1)}>▶</button>
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="ad-discrepancy-type">Discrepancy Type</label>
                <select id="ad-discrepancy-type" className="form-control" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }}>
                  <option value="ALL">All Types</option>
                  {FILTERABLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="ad-status-filter">Status</label>
                <select id="ad-status-filter" className="form-control" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}>
                  <option value="ALL">All Statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="Returned">Returned</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
              <button className="btn btn-secondary" style={{ height: '40px' }} onClick={() => { setSearchQuery(''); setFromDate(daysAgoISO(30)); setToDate(todayISO()); setWorkingDate(todayISO()); setWorkingDateMode(false); setTypeFilter('ALL'); setStatusFilter('ALL'); }}>
                Reset Filters
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <input type="checkbox" id="workingDateCheck" checked={workingDateMode} onChange={(e) => handleToggleWorkingDateMode(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <label htmlFor="workingDateCheck" style={{ cursor: 'pointer', margin: 0, fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                Enable Working Date Mode (filters single date sequentially)
              </label>
            </div>
          </div>

          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Req No</th>
                  <th>Request By</th>
                  <th>Filed Date</th>
                  <th>Correction Date</th>
                  <th>Days Diff</th>
                  <th>Category</th>
                  <th>Type of Discrepancy</th>
                  <th>Time Blocks</th>
                  <th>Attachments</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <SkeletonRows rows={7} columns={11} />
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan="11">
                      <EmptyState
                        title="No discrepancy records"
                        hint="Nothing matches the current filters. Try widening the date range, clearing the search, or switching the status filter to All."
                      />
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => (
                    <tr key={req.req_no} className={`${req.energy_category} status-${req.status.toLowerCase()}`} style={{ cursor: 'pointer' }}>
                      <td onClick={() => handleOpenActionModal(req, 'view')} style={{ fontWeight: 'bold' }}>#{req.req_no}</td>
                      <td onClick={() => handleOpenActionModal(req, 'view')} style={{ fontWeight: '500' }}>{req.request_by}</td>
                      <td onClick={() => handleOpenActionModal(req, 'view')}>{formatDateDMY(req.request_date)}</td>
                      <td onClick={() => handleOpenActionModal(req, 'view')}>{formatDateDMY(req.correction_for_date)}</td>
                      <td onClick={() => handleOpenActionModal(req, 'view')}>
                        <span style={{ color: req.days_diff > config.maxDays ? '#d97706' : 'var(--text-primary)', fontWeight: req.days_diff > config.maxDays ? 'bold' : 'normal' }}>
                          {req.days_diff} day{req.days_diff !== 1 ? 's' : ''}
                          {req.days_diff > config.maxDays && <span style={{ marginLeft: '4px' }} title={`Beyond regulation limit of ${config.maxDays} days`}>⚠️</span>}
                        </span>
                      </td>
                      <td onClick={() => handleOpenActionModal(req, 'view')}><span className={`energy-badge ${req.energy_category}`}>{req.energy_category}</span></td>
                      <td onClick={() => handleOpenActionModal(req, 'view')} style={{ maxWidth: '180px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {req.discrepancy_type ? (
                            req.discrepancy_type.match(/<[^>]+>/g)?.map((tag, idx) => (
                              <span key={idx} style={{
                                background: 'rgba(59,130,246,0.1)',
                                color: '#1d4ed8',
                                border: '1px solid rgba(59,130,246,0.2)',
                                borderRadius: '4px',
                                padding: '2px 6px',
                                fontSize: '0.72rem',
                                fontWeight: '600',
                                whiteSpace: 'normal',
                                wordBreak: 'break-word'
                              }}>
                                {tag.slice(1, -1)}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>General</span>
                          )}
                        </div>
                      </td>
                      <td onClick={() => handleOpenActionModal(req, 'view')} style={{ maxWidth: '120px', wordBreak: 'break-word', whiteSpace: 'normal', fontSize: '0.8rem' }}>{req.time_blocks}</td>
                      <td onClick={() => handleOpenActionModal(req, 'view')}>
                        {req.files && req.files.length > 0 ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--accent-blue)' }}>
                            <FileText size={12} />{req.files.length} attached
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>}
                      </td>
                      <td onClick={() => handleOpenActionModal(req, 'view')}>
                        <span className={`status-badge ${req.status.toLowerCase()}`}>{req.status}</span>
                      </td>
                      <td>
                        {req.status === 'Pending' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="btn btn-teal" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleOpenActionModal(req, 'resolve'); }}>Resolve</button>
                            <button className="btn btn-warning" style={{ padding: '4px 8px', fontSize: '0.75rem', background: '#d97706', color: '#fff' }} onClick={(e) => { e.stopPropagation(); handleOpenActionModal(req, 'return'); }}>Return</button>
                            <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleOpenActionModal(req, 'reject'); }}>Reject</button>
                          </div>
                        ) : (
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleOpenActionModal(req, 'view'); }}>Details</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalRecords > 0 && (
            <div className="flex-row-between" style={{ marginTop: '15px', background: 'var(--bg-secondary)', padding: '12px 20px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                <span>Show</span>
                <select 
                  className="form-control" 
                  style={{ width: '70px', height: '32px', padding: '0 8px', borderRadius: '6px', cursor: 'pointer' }}
                  value={pageSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setPageSize(val);
                    setCurrentPage(1);
                    localStorage.setItem('preferredPageSize', val);
                  }}
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
                <span style={{ color: 'var(--text-secondary)' }}>records per page (Total: {totalRecords})</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span style={{ padding: '6px 12px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                  Page {currentPage} of {Math.ceil(totalRecords / pageSize)}
                </span>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(totalRecords / pageSize)))}
                  disabled={currentPage === Math.ceil(totalRecords / pageSize) || totalRecords === 0}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outages list tab */}
      {activeTab === 'outages' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="flex-row-between">
            <div>
              <h2>Generating Unit Outages Logs</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                View and download the outages filed by conventional/RE generators.
              </p>
            </div>
            <button className="btn btn-teal" onClick={handleOutagesDownload} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Download size={16} /> Export Outages Report (CSV)
            </button>
          </div>

          {/* Filters Bar */}
          <div className="glass-panel" style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ad-outage-date-from">Outage Date From</label>
              <input id="ad-outage-date-from" type="date" className="form-control" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ad-outage-date-to">Outage Date To</label>
              <input id="ad-outage-date-to" type="date" className="form-control" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ad-outage-type">Outage Type</label>
              <select id="ad-outage-type" className="form-control" value={outageTypeFilter} onChange={(e) => setOutageTypeFilter(e.target.value)}>
                <option value="All">All Outage Types</option>
                <option value="Partial Outage">Partial Outage</option>
                <option value="Forced Outage">Forced Outage</option>
              </select>
            </div>
            <button className="btn btn-secondary" style={{ height: '40px' }} onClick={() => { setFromDate('2026-06-01'); setToDate('2026-07-15'); setOutageTypeFilter('All'); }}>
              Reset Range
            </button>
          </div>

          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Generator Station</th>
                  <th>Unit Number</th>
                  <th>Outage Type</th>
                  <th>Outage Date From</th>
                  <th>Outage Date To</th>
                  <th>Reason of Outage</th>
                  <th>Approval Status</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <SkeletonRows rows={5} columns={9} />
                ) : outagesList.filter(o => outageTypeFilter === 'All' || o.outage_type === outageTypeFilter).length === 0 ? (
                  <tr>
                    <td colSpan="9">
                      <EmptyState title="No outage reports" hint="No unit outages have been filed for this date range and type." />
                    </td>
                  </tr>
                ) : (
                  outagesList
                    .filter(o => outageTypeFilter === 'All' || o.outage_type === outageTypeFilter)
                    .map((out) => (
                      <tr key={out.id}>
                        <td>{formatDateDMYHM(out.created_at)}</td>
                        <td style={{ fontWeight: '500' }}>{out.generator_name} ({out.username})</td>
                        <td style={{ fontWeight: '600' }}>{out.unit_number}</td>
                        <td>
                          <span className={`status-badge ${out.outage_type === 'Forced Outage' ? 'rejected' : 'returned'}`}>
                            {out.outage_type}
                          </span>
                        </td>
                        <td>{formatDateDMYHM(out.outage_from)}</td>
                        <td>{formatDateDMYHM(out.outage_to)}</td>
                        <td>{out.reason}</td>
                        <td>
                          <span className={`status-badge ${out.status === 'Approved' ? 'resolved' : (out.status === 'Rejected' ? 'rejected' : 'pending')}`}>
                            {out.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            {out.status === 'Pending' && (
                              <>
                                <button
                                  className="btn btn-teal"
                                  style={{ padding: '4px 8px', fontSize: '0.75rem', height: '28px' }}
                                  onClick={() => handleProcessOutage(out.id, 'Approved')}
                                >
                                  Approve
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 8px', fontSize: '0.75rem', height: '28px', color: '#dc2626' }}
                                  onClick={() => handleProcessOutage(out.id, 'Rejected')}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.75rem', height: '28px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => handleOpenEditOutage(out)}
                            >
                              <Edit size={12} /> Edit
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.75rem', height: '28px', display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626' }}
                              onClick={() => handleDeleteOutage(out.id)}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cycle Downloads tab */}
      {activeTab === 'cycle_downloads' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="flex-row-between">
            <div>
              <h2>Open / Closed Cycle Generation Data</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                Download cycle operational excel sheets uploaded by select authorized utility stations.
              </p>
            </div>
            <button className="btn btn-teal" onClick={handleCycleDownload} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Download size={16} /> Download Selected Range Files (ZIP)
            </button>
          </div>

          {/* Filters Bar */}
          <div className="glass-panel" style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ad-cycle-period-from">Cycle Period From</label>
              <input id="ad-cycle-period-from" type="date" className="form-control" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ad-cycle-period-to">Cycle Period To</label>
              <input id="ad-cycle-period-to" type="date" className="form-control" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <button className="btn btn-secondary" style={{ height: '40px' }} onClick={() => { setFromDate('2026-06-01'); setToDate('2026-07-15'); }}>
              Reset Range
            </button>
          </div>

          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Upload Timestamp</th>
                  <th>Generator Utility</th>
                  <th>Cycle Duration Date Range</th>
                  <th>Filename</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <SkeletonRows rows={4} columns={5} />
                ) : cycleList.length === 0 ? (
                  <tr>
                    <td colSpan="5">
                      <EmptyState title="No cycle data uploads" hint="Uploads made by stations in this date range will appear here." />
                    </td>
                  </tr>
                ) : (
                  cycleList.map((c) => {
                    const cleanName = originalFilename(c.filename);
                    return (
                      <tr key={c.id}>
                        <td>{formatDateDMYHM(c.created_at)}</td>
                        <td style={{ fontWeight: '500' }}>{c.username}</td>
                        <td style={{ fontWeight: '600' }}>{formatDateDMY(c.start_date)} to {formatDateDMY(c.end_date)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{cleanName}</td>
                        <td>
                          <button type="button" onClick={() => downloadFile(`/upload/${encodeURIComponent(c.filename)}`, c.filename).catch(err => notify('error', err.message))} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: '4px 8px' }}>
                            <Download size={12} /> Download Excel
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '30px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
          
          {/* Operational Settings Form */}
          <div className="glass-panel" style={{ padding: '30px', height: 'fit-content' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <Save /><span>Discrepancy Filing Rules</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '25px', borderBottom: '1px solid var(--border-color)', paddingBottom: '15px' }}>
              Adjust the system lock thresholds, regulation limits, and default landing preferences.
            </p>

            <Banner type="success" message={configSuccess} />

            <form onSubmit={handleSaveConfig}>
              <div className="form-group">
                <label htmlFor="ad-maximum-discrepancy-filing-limit-days-iegc-6-5-33">Maximum Discrepancy Filing Limit (Days — IEGC 6.5.33)</label>
                <input id="ad-maximum-discrepancy-filing-limit-days-iegc-6-5-33" type="number" className="form-control" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>How far back users can submit new discrepancies. Default: 5 days.</span>
              </div>

              {/* Extended Filing Toggles */}
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '15px 0' }}>
                <input type="checkbox" id="allowExtended" checked={allowExtended} onChange={(e) => setAllowExtended(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <label htmlFor="allowExtended" style={{ cursor: 'pointer', marginBottom: 0, fontSize: '0.85rem', fontWeight: '500' }}>Allow filing beyond regulation limits (Extended Filing window)</label>
              </div>

              {allowExtended && (
                <div className="form-group" style={{ animation: 'modalFadeIn 0.2s ease-out' }}>
                  <label htmlFor="ad-extended-discrepancy-filing-limit-days">Extended Discrepancy Filing Limit (Days)</label>
                  <input id="ad-extended-discrepancy-filing-limit-days" type="number" className="form-control" value={extendedMaxDays} onChange={(e) => setExtendedMaxDays(e.target.value)} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Absolute maximum days back allowed when extended filing is active. Default: 15 days.</span>
                </div>
              )}

              {/* Reraise Window & Limit Parameters */}
              <div className="form-group">
                <label htmlFor="ad-re-raise-filing-window-time-limit-days">Re-Raise Filing Window Time Limit (Days)</label>
                <input id="ad-re-raise-filing-window-time-limit-days" type="number" className="form-control" value={reraiseWindow} onChange={(e) => setReraiseWindow(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>How many days back from correction date users can re-raise. Default: 45 days.</span>
              </div>

              <div className="form-group">
                <label htmlFor="ad-re-raise-count-limit-per-discrepancy">Re-Raise Count Limit (Per Discrepancy)</label>
                <input id="ad-re-raise-count-limit-per-discrepancy" type="number" className="form-control" value={reraiseLimit} onChange={(e) => setReraiseLimit(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>How many times a discrepancy can be re-opened. Default: 2 times.</span>
              </div>

              {/* ── Security & access ────────────────────────────────────
                  Login controls. These were previously buried under an
                  "Outage Form Access Controls" heading, which is not what
                  they govern. */}
              <h3 className="settings-heading">Security &amp; Access</h3>
              <p className="settings-hint">Who can sign in, and what they must present to do so.</p>

              {/* Master OTP switch — the escape hatch when mail delivery fails.
                  Individual accounts can also be exempted from User Management. */}
              <div className={`settings-toggle-card${require2FA ? '' : ' warn'}`}>
                <label htmlFor="ad-require-2fa" className="settings-toggle-label">
                  <input
                    id="ad-require-2fa"
                    type="checkbox"
                    checked={require2FA}
                    onChange={(e) => setRequire2FA(e.target.checked)}
                  />
                  <span>Require OTP (two-factor) at login</span>
                </label>
                <p className="settings-toggle-note" style={{ color: require2FA ? 'var(--text-secondary)' : '#b45309' }}>
                  {require2FA
                    ? 'Users receive a one-time code by email at every login. Turn this off if mail delivery breaks and people cannot sign in — everyone will then log in with their password alone.'
                    : 'OTP is OFF for everyone. Anyone with a valid password can sign in without a code. Turn this back on as soon as email delivery is working.'}
                </p>
                <p className="settings-toggle-note muted">
                  To exempt just one person instead, use the OTP column in User Management.
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="ad-login-fail-limit">Login Fail Limit before Account Lockout</label>
                <input id="ad-login-fail-limit" type="number" className="form-control" value={lockoutAttempts} onChange={(e) => setLockoutAttempts(e.target.value)} />
                <span className="settings-field-hint">Wrong passwords allowed before the account locks. Default: 3.</span>
              </div>

              {/* ── Feature availability ─────────────────────────────────── */}
              <h3 className="settings-heading">Feature Availability</h3>
              <p className="settings-hint">Which parts of the portal are switched on, and for whom.</p>

              <div className={`settings-toggle-card${featureCycleData ? '' : ' off'}`}>
                <label htmlFor="ad-feature-cycle-data" className="settings-toggle-label">
                  <input
                    id="ad-feature-cycle-data"
                    type="checkbox"
                    checked={featureCycleData}
                    onChange={(e) => setFeatureCycleData(e.target.checked)}
                  />
                  <span>Cycle Data upload and download</span>
                </label>
                <p className="settings-toggle-note">
                  {featureCycleData
                    ? 'Stations with the permission can upload Open/Closed Cycle sheets, and admins can download them.'
                    : 'Switched off. The Cycle Data tabs are hidden from everyone and the endpoints are closed. Existing uploads are kept and reappear if this is switched back on.'}
                </p>
              </div>

              <fieldset className="settings-fieldset">
                <legend>Unit outage filing</legend>
                <p className="settings-hint">Which energy categories may submit unit outages.</p>
                <label className="settings-check">
                  <input type="checkbox" checked={outageISGS} onChange={(e) => setOutageISGS(e.target.checked)} />
                  <span>ISGS</span>
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={outageRE} onChange={(e) => setOutageRE(e.target.checked)} />
                  <span>RE</span>
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={outageStates} onChange={(e) => setOutageStates(e.target.checked)} />
                  <span>States</span>
                </label>
              </fieldset>

              {/* ── Email budget ─────────────────────────────────────────
                  The mail plan is the tightest resource the portal has, and
                  running out of it is invisible from the outside: codes simply
                  stop arriving. These are the controls that decide how much
                  gets used, with today's usage beside them. */}
              <h3 className="settings-heading">Email Budget</h3>
              <p className="settings-hint">
                How much email the portal is allowed to send, and how hard it works to avoid needing to.
              </p>

              {mailUsage && (
                <div className={`mail-usage${mailUsage.remaining === 0 ? ' is-spent' : mailUsage.remaining <= mailUsage.cap * 0.2 ? ' is-low' : ''}`}>
                  <div className="mail-usage-head">
                    <Mail size={15} />
                    <strong>{mailUsage.sent} of {mailUsage.cap} messages sent today</strong>
                    <span className="mail-usage-remaining">{mailUsage.remaining} left</span>
                  </div>
                  <div className="mail-usage-bar">
                    <span style={{ width: `${Math.min(100, (mailUsage.sent / Math.max(1, mailUsage.cap)) * 100)}%` }} />
                  </div>
                  <p className="settings-toggle-note muted">
                    {mailUsage.trustedDevices} browser{mailUsage.trustedDevices === 1 ? '' : 's'} currently
                    trusted, so those users need no code for up to {mailUsage.trustDays} day{mailUsage.trustDays === 1 ? '' : 's'}.
                    {mailUsage.suppressed > 0 && (
                      <> <strong style={{ color: '#b45309' }}>{mailUsage.suppressed} message(s) were held back today after the cap was reached.</strong></>
                    )}
                  </p>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="ad-otp-trust-days">Ask for an OTP once every … days</label>
                <input id="ad-otp-trust-days" type="number" min="0" max="90" className="form-control"
                  value={otpTrustDays} onChange={(e) => setOtpTrustDays(e.target.value)} />
                <span className="settings-field-hint">
                  After a user verifies a code, that browser is trusted for this long and signs in
                  without one. This is the single biggest control on email usage — at 7 days, 200
                  users cost roughly 29 codes a day instead of one per login. Set to 0 to demand a
                  code every time.
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="ad-reset-otp-minutes">Password reset code valid for … minutes</label>
                <input id="ad-reset-otp-minutes" type="number" min="5" max="120" className="form-control"
                  value={resetOtpMinutes} onChange={(e) => setResetOtpMinutes(e.target.value)} />
                <span className="settings-field-hint">
                  No second code is emailed while one is still valid, so repeatedly pressing
                  &ldquo;Forgot password&rdquo; cannot drain the day&rsquo;s allowance. Default: 20 minutes.
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="ad-mail-daily-cap">Daily message limit</label>
                <input id="ad-mail-daily-cap" type="number" min="0" className="form-control"
                  value={mailDailyCap} onChange={(e) => setMailDailyCap(e.target.value)} />
                <span className="settings-field-hint">
                  The portal stops sending once it reaches this number and writes a log entry saying
                  so. Keep it below the provider&rsquo;s real limit — with a 300-a-day plan, 280 leaves
                  room for anything sent outside the portal.
                </span>
              </div>

              {/* SMTP Configuration Section */}
              <h3 style={{ marginTop: '30px', marginBottom: '10px', fontSize: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>SMTP Server Settings (2FA)</span>
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label htmlFor="ad-smtp-host">SMTP Host</label>
                  <input id="ad-smtp-host" type="text" className="form-control" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="ad-port">Port</label>
                  <input id="ad-port" type="text" className="form-control" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '15px 0' }}>
                <input type="checkbox" id="smtpSecure" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                <label htmlFor="smtpSecure" style={{ cursor: 'pointer', marginBottom: 0, fontSize: '0.85rem' }}>Use SSL/TLS</label>
              </div>

              <div className="form-group">
                <label htmlFor="ad-smtp-username-email">SMTP Username / Email</label>
                <input id="ad-smtp-username-email" type="email" className="form-control" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
              </div>

              <div className="form-group">
                <label htmlFor="ad-smtp-app-password">SMTP App Password</label>
                <div style={{ position: 'relative' }}>
                  <input id="ad-smtp-app-password" type={showPassword ? "text" : "password"} className="form-control" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
                  <button type="button" style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer' }} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="ad-sender-address-smtp-from">Sender Address (SMTP From)</label>
                <input id="ad-sender-address-smtp-from" type="text" className="form-control" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '25px' }}>
              {/* ── This admin's own preference, not a system-wide rule ──── */}
              <h3 className="settings-heading">Your Preferences</h3>
              <p className="settings-hint">Applies to your account only, not to other administrators.</p>

              <div className="form-group">
                <label htmlFor="ad-default-page-landing-view-preference">Default category when you open the portal</label>
                <select id="ad-default-page-landing-view-preference" className="form-control" value={landingPref} onChange={(e) => setLandingPref(e.target.value)}>
                  <option value="both">All Categories</option>
                  <option value="ISGS">ISGS energy only</option>
                  <option value="RE">RE energy only</option>
                  <option value="States">States only</option>
                </select>
              </div>

                <button type="submit" className="btn btn-primary">Save All Settings</button>
              </div>
            </form>
          </div>

          {/* Test SMTP Connection Section */}
          <div className="glass-panel" style={{ padding: '30px', height: 'fit-content' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <Download style={{ transform: 'rotate(-90deg)' }} /><span>Verify SMTP Setup</span>
            </h2>

            <Banner type="success" message={smtpTestSuccess} />

            <Banner type="error" message={smtpTestError} />

            <form onSubmit={handleTestSmtp}>
              <div className="form-group">
                <label htmlFor="ad-test-recipient-email-address">Test Recipient Email Address</label>
                <input id="ad-test-recipient-email-address" type="email" className="form-control" placeholder="recipient@domain.com" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '25px' }}>
                <button type="submit" className="btn btn-teal" disabled={isTestingSmtp}>
                  {isTestingSmtp ? 'Verifying Link...' : 'Test SMTP Connection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'transfers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2>QCA Plant Registry Transfer Requests</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
              Approve or reject requests raised by QCA coordinators to transfer plant assignments.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '25px' }}>
            <div className="table-container">
              <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Req ID</th>
                    <th>WBES Acronym</th>
                    <th>Current Owner QCA</th>
                    <th>New Owner QCA</th>
                    <th>Effective Date</th>
                    <th>Filed Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <SkeletonRows rows={4} columns={8} />
                  ) : transferRequests.length === 0 ? (
                    <tr>
                      <td colSpan="8">
                        <EmptyState title="No transfer requests" hint="QCA plant transfer requests awaiting your approval will appear here." />
                      </td>
                    </tr>
                  ) : (
                    transferRequests.map((tr) => (
                      <tr key={tr.id}>
                        <td>#{tr.id}</td>
                        <td style={{ fontWeight: 'bold' }}>{tr.wbes_acronym}</td>
                        <td>{tr.from_username || 'None (Direct)'}</td>
                        <td>{tr.to_username}</td>
                        <td>{formatDateDMY(tr.effective_date)}</td>
                        <td>{formatDateDMYHM(tr.created_at)}</td>
                        <td>
                          <span className={`status-badge ${tr.status.toLowerCase()}`}>
                            {tr.status}
                          </span>
                        </td>
                        <td>
                          {tr.status === 'Pending' ? (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button className="btn btn-teal" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleProcessTransfer(tr.id, 'Approved')}>Approve</button>
                              <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleProcessTransfer(tr.id, 'Rejected')}>Reject</button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Processed</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <UserManagement />
      )}


      {/* Action Modal */}
      {selectedRequest && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={18} /><span>Request Detail: Req #{selectedRequest.req_no}</span>
              </h3>
              <button type="button" className="modal-close" onClick={handleCloseModal} aria-label="Close dialog">&times;</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem' }}>
                <div><span style={{ color: 'var(--text-secondary)' }}>Filer Station:</span> <strong>{selectedRequest.request_by}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Category:</span> <span className={`energy-badge ${selectedRequest.energy_category}`}>{selectedRequest.energy_category}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Request Date:</span> {formatDateDMY(selectedRequest.request_date)}</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Correction Date:</span> {formatDateDMY(selectedRequest.correction_for_date)}</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Days Mismatch:</span> <strong style={{ color: selectedRequest.days_diff > config.maxDays ? '#dc2626' : 'var(--text-primary)' }}>{selectedRequest.days_diff} days</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Status:</span> <span className={`status-badge ${selectedRequest.status.toLowerCase()}`}>{selectedRequest.status}</span></div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Type of Discrepancy Tags:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedRequest.discrepancy_type ? (
                    selectedRequest.discrepancy_type.match(/<[^>]+>/g)?.map((tag, idx) => (
                      <span key={idx} style={{
                        background: 'rgba(59,130,246,0.1)',
                        color: '#1d4ed8',
                        border: '1px solid rgba(59,130,246,0.2)',
                        borderRadius: '4px',
                        padding: '3px 8px',
                        fontSize: '0.78rem',
                        fontWeight: '600'
                      }}>
                        {tag.slice(1, -1)}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None specified</span>
                  )}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Time Blocks Affected:</span>
                <div style={{ background: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.85rem' }}>{selectedRequest.time_blocks}</div>
              </div>

              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Request Content:</span>
                <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '6px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', maxHeight: '100px', overflowY: 'auto' }}>{selectedRequest.request_content}</div>
              </div>

              {selectedRequest.files && selectedRequest.files.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>Attached Documents:</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedRequest.files.map((file, idx) => {
                      const displayName = originalFilename(file);
                      return (
                        <button key={idx} type="button" onClick={() => downloadFile(`/upload/${encodeURIComponent(file)}`, file).catch(err => notify('error', err.message))} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '6px 10px', width: 'fit-content' }}>
                          <Download size={12} /> {displayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedRequest.status === 'Resolved' && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <span style={{ color: 'var(--status-resolved-text)', fontSize: '0.85rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Corrective Action Taken:</span>
                  <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '10px' }}>{selectedRequest.admin_comment}</div>

                  {selectedRequest.admin_files && selectedRequest.admin_files.length > 0 && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>Supportive Admin Files:</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {selectedRequest.admin_files.map((file, idx) => {
                          const displayName = originalFilename(file);
                          return (
                            <button key={idx} type="button" onClick={() => downloadFile(`/upload/${encodeURIComponent(file)}`, file).catch(err => notify('error', err.message))} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', padding: '5px 8px', width: 'fit-content' }}>
                              <Download size={12} /> {displayName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedRequest.status === 'Returned' && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <span style={{ color: '#d97706', fontSize: '0.85rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Feedback / Return Comments:</span>
                  <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem' }}>{selectedRequest.admin_comment}</div>
                </div>
              )}

              {selectedRequest.status === 'Rejected' && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <span style={{ color: 'var(--status-rejected-text)', fontSize: '0.85rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Rejection Reason:</span>
                  <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem' }}>{selectedRequest.rejection_reason}</div>
                </div>
              )}
            </div>

            {modalMode === 'resolve' && (
              <form onSubmit={handleResolveSubmit} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label>Corrective Action Taken</label>
                    
                    {/* Template presets */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button type="button" className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => setCorrectiveAction('Approved and Resolved')}>
                        Approved &amp; Resolved
                      </button>
                      <button type="button" className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => setCorrectiveAction('Resolved for certain time blocks. Kindly check WBES latest revision.')}>
                        Resolved for Certain Blocks
                      </button>
                    </div>
                  </div>
                  <textarea rows="3" className="form-control" placeholder="Enter details of corrective actions taken on the scheduling server..." value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="ad-attach-supportive-file-response-optional">Attach supportive file response (Optional)</label>
                  <input id="ad-attach-supportive-file-response-optional" type="file" multiple className="form-control" onChange={handleAdminFileChange} />
                  {adminAttachments.length > 0 && (
                    <div className="file-list" style={{ marginTop: '8px' }}>
                      {adminAttachments.map((f, i) => (
                        <div key={i} className="file-row">
                          <span>{typeof f === 'string' ? originalFilename(f) : f.name}</span>
                          <button type="button" className="file-remove" onClick={() => removeAdminFile(i)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(13,148,136,0.05)', border: '1px solid rgba(13,148,136,0.2)', borderRadius: '6px', marginBottom: '15px', fontSize: '0.75rem', color: '#047857' }}>
                  <Check size={14} /><span>Submitting will trigger a notification email stating the issue is Cleared.</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancel</button>
                  <button type="submit" className="btn btn-teal">Approve &amp; Resolve</button>
                </div>
              </form>
            )}

            {modalMode === 'return' && (
              <form onSubmit={handleReturnSubmit} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                <div className="form-group">
                  <label htmlFor="ad-feedback-return-reason-comments">Feedback / Return Reason comments</label>
                  <textarea id="ad-feedback-return-reason-comments" rows="3" className="form-control" placeholder="Enter feedback details for returning..." value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} required />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', marginBottom: '15px', fontSize: '0.75rem', color: '#b45309' }}>
                  <Undo2 size={14} /><span>Submitting will return this request back to the user to review and correct.</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancel</button>
                  <button type="submit" className="btn btn-warning" style={{ background: '#d97706', color: '#fff' }}>Return to User</button>
                </div>
              </form>
            )}

            {modalMode === 'reject' && (
              <form onSubmit={handleRejectSubmit} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                <div className="form-group">
                  <label htmlFor="ad-rejection-reason">Rejection Reason</label>
                  <textarea id="ad-rejection-reason" rows="3" className="form-control" placeholder="Provide detailed feedback on why this correction was rejected..." value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} required />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', marginBottom: '15px', fontSize: '0.75rem', color: '#b91c1c' }}>
                  <XCircle size={14} /><span>Submitting will trigger a rejection email warning.</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancel</button>
                  <button type="submit" className="btn btn-danger">Reject Filing</button>
                </div>
              </form>
            )}

            {modalMode === 'view' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '15px', gap: '10px' }}>
                <div>
                  <button className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={() => downloadFile(`/discrepancies/${selectedRequest.req_no}/export-excel`, `discrepancy_report_req_${selectedRequest.req_no}.xlsx`).catch(err => notify('error', err.message))}>
                    <Download size={14} /> Export to Excel
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {selectedRequest.status === 'Pending' && (
                    <>
                      <button className="btn btn-teal" onClick={() => setModalMode('resolve')}>Resolve</button>
                      <button className="btn btn-warning" style={{ background: '#d97706', color: '#fff' }} onClick={() => setModalMode('return')}>Return</button>
                      <button className="btn btn-danger" onClick={() => setModalMode('reject')}>Reject</button>
                    </>
                  )}
                  <button className="btn btn-primary" onClick={handleCloseModal}>Close Details</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Outage Modal */}
      {editingOutage && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content glass-panel" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={18} /><span>Edit Outage Entry #{editingOutage.id}</span>
              </h3>
              <button type="button" className="modal-close" onClick={() => setEditingOutage(null)} aria-label="Close dialog">&times;</button>
            </div>
            
            <Banner type="error" message={editOutageError} />

            <Banner type="success" message={editOutageSuccess} />

            <form onSubmit={handleEditOutageSubmit}>
              <div className="form-group">
                <label htmlFor="ad-unit-number-affected">Unit Number Affected</label>
                <input id="ad-unit-number-affected" 
                  type="text" 
                  className="form-control" 
                  value={editOutageUnitNumber} 
                  onChange={(e) => setEditOutageUnitNumber(e.target.value)} 
                  required 
                />
              </div>

              <div className="form-group">
                <label htmlFor="ad-type-of-outage">Type of Outage</label>
                <select id="ad-type-of-outage" 
                  className="form-control" 
                  value={editOutageType} 
                  onChange={(e) => setEditOutageType(e.target.value)}
                >
                  <option value="Partial Outage">Partial Outage</option>
                  <option value="Forced Outage">Forced Outage</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="ad-outage-date-amp-time-from">Outage Date &amp; Time From</label>
                <input id="ad-outage-date-amp-time-from" 
                  type="datetime-local" 
                  className="form-control" 
                  value={editOutageFrom} 
                  onChange={(e) => setEditOutageFrom(e.target.value)} 
                  max={nowDatetimeLocal()}
                  required 
                />
              </div>

              <div className="form-group">
                <label htmlFor="ad-outage-date-amp-time-to">Outage Date &amp; Time To</label>
                <input id="ad-outage-date-amp-time-to" 
                  type="datetime-local" 
                  className="form-control" 
                  value={editOutageTo} 
                  onChange={(e) => setEditOutageTo(e.target.value)} 
                  max={nowDatetimeLocal()}
                  required 
                />
              </div>

              <div className="form-group">
                <label htmlFor="ad-reason-of-outage">Reason of Outage</label>
                <textarea id="ad-reason-of-outage" 
                  rows="3" 
                  className="form-control" 
                  value={editOutageReason} 
                  onChange={(e) => setEditOutageReason(e.target.value)} 
                  required 
                />
              </div>

              <div className="form-group">
                <label htmlFor="ad-approval-status">Approval Status</label>
                <select id="ad-approval-status" 
                  className="form-control" 
                  value={editOutageStatus} 
                  onChange={(e) => setEditOutageStatus(e.target.value)}
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingOutage(null)}>Cancel</button>
                <button type="submit" className="btn btn-teal">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
