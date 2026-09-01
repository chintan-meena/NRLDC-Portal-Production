import { useState, useEffect } from 'react';
import { 
  getDiscrepancies, createDiscrepancy, reRaiseDiscrepancy, changeProfileSettings, 
  getConfig, uploadFiles, getOutages, createOutage, getMyCycleUploads, uploadCycleData,
  getWbesEntities, getUserAssignments, createUserAssignment, getQcaAssociation,
  getQcas, createTransferRequest, getTransferRequests, downloadFile
} from '../services/db';
import { RULES as PASSWORD_RULES, validatePassword } from '../utils/password';
import { Banner, EmptyState, SkeletonRows } from './Feedback';
import { categoryLabel } from '../utils/categories';
import { useFeedback } from '../hooks/useFeedback';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { originalFilename } from '../utils/filenames';
import { FILTERABLE_TYPES, DISCREPANCY_TYPES, MISC_TYPE } from '../utils/discrepancyTypes';
import { ACCEPT_ATTRIBUTE, ALLOWED_DESCRIPTION, MAX_UPLOAD_MB, validateFiles } from '../utils/uploads';
import { parseTimeBlocks } from '../utils/timeBlocks';
import { formatDateDMY, formatDateDMYHM, getStatusPriority, todayISO, daysAgoISO, nowDatetimeLocal } from '../utils/format';
import { AlertCircle, Plus, ClipboardList, Settings, CheckCircle2, XCircle, FileText, Upload, Calendar, RefreshCw, Download, User, Mail, Phone, Lock, Zap, Database, Search } from 'lucide-react';

export default function UserDashboard({ currentUser, onUserUpdate, activeTab, setActiveTab }) {
  // QCA coordination applies to Renewable Energy plants only. ISGS and States
  // users manage their own schedules directly and never see QCA controls.
  const isQcaUser = currentUser.role === 'QCA';
  const isRenewableUser = currentUser.energy_category === 'RE';

  const [discrepancies, setDiscrepancies] = useState([]);
  const { notice, notify, clearNotice } = useFeedback();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [config, setConfig] = useState({ maxDays: 5, lockoutAttempts: 3, allowExtended: true, extendedMaxDays: 15, reraiseWindow: 45, reraiseLimit: 2 });

  // Pagination states
  const [totalRecords, setTotalRecords] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(parseInt(localStorage.getItem('preferredPageSize') || '50'));

  // QCA states
  const [qcaAssignments, setQcaAssignments] = useState([]);
  const [qcaAssociation, setQcaAssociation] = useState(null);
  const [selectedPlantAcronym, setSelectedPlantAcronym] = useState('');
  const [wbesEntities, setWbesEntities] = useState([]);
  const [wbesSearch, setWbesSearch] = useState('');
  const [assignFromDate, setAssignFromDate] = useState(() => todayISO());
  const [assignSuccess, setAssignSuccess] = useState('');
  const [assignError, setAssignError] = useState('');

  // QCA Transfer states for plant users
  const [qcasList, setQcasList] = useState([]);
  const [selectedTargetQca, setSelectedTargetQca] = useState('');
  // Tomorrow, in local time — toISOString() would roll back a day at IST.
  const [transferEffectiveDate, setTransferEffectiveDate] = useState(() => daysAgoISO(-1));
  const [myTransferRequests, setMyTransferRequests] = useState([]);
  const [transferSuccess, setTransferSuccess] = useState('');
  const [transferError, setTransferError] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);


  // Outages States
  const [outages, setOutages] = useState([]);
  const [outageUnitNumber, setOutageUnitNumber] = useState('');
  const [outageType, setOutageType] = useState('Partial Outage');
  const [outageFrom, setOutageFrom] = useState('');
  const [outageTo, setOutageTo] = useState('');
  const [outageReason, setOutageReason] = useState('');
  const [outageError, setOutageError] = useState('');
  const [outageSuccess, setOutageSuccess] = useState('');

  // Cycle Data Upload States
  const [cycleUploads, setCycleUploads] = useState([]);
  const [cycleStartDate, setCycleStartDate] = useState('');
  const [cycleEndDate, setCycleEndDate] = useState('');
  const [cycleFile, setCycleFile] = useState(null);
  const [cycleError, setCycleError] = useState('');
  const [cycleSuccess, setCycleSuccess] = useState('');

  // Form States
  const [reRaiseReqNo, setReRaiseReqNo] = useState(null);
  const [correctionDate, setCorrectionDate] = useState('');
  const [timeBlocks, setTimeBlocks] = useState('');
  const [reason, setReason] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Multiselect Reason States
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [miscReasonText, setMiscReasonText] = useState('');

  // Filter States
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // Profile Settings States
  const [settingsSubTab, setSettingsSubTab] = useState('profile');
  const [profileName, setProfileName] = useState('');
  const [email1, setEmail1] = useState('');
  const [email2, setEmail2] = useState('');
  const [email3, setEmail3] = useState('');
  const [mobile, setMobile] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');

  // Password Update States
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [selectedRequest, setSelectedRequest] = useState(null);

  // One shared vocabulary, so a filter can never name a type nothing can be
  // filed under. See src/utils/discrepancyTypes.js.
  const availableReasons = [...DISCREPANCY_TYPES, MISC_TYPE];

  /** Which tabs display the discrepancy list or its statistics. */
  const TABS_NEEDING_DISCREPANCIES = ['dashboard', 'raise_request'];

  /**
   * Filing rules, fetched once. They govern what the raise-request form will
   * accept; they do not change when the user switches tab or turns a page.
   */
  async function loadConfig() {
    try {
      setConfig(await getConfig());
    } catch (err) {
      console.error('[UserDashboard] loadConfig error:', err.message);
    }
  }

  async function loadData() {
    setLoadError('');
    setIsLoading(true);
    try {
      const params = {
        username: currentUser.username,
        page: currentPage,
        limit: pageSize,
        fromDate: fromDateFilter || undefined,
        toDate: toDateFilter || undefined,
      };
      if (typeFilter !== 'ALL') {
        params.type = typeFilter;
      }

      // Only the tabs that show the list pay for the query. Opening Unit
      // Outages used to fetch every discrepancy as well, which is the slowest
      // call on the page and nothing on that tab displays it.
      if (TABS_NEEDING_DISCREPANCIES.includes(activeTab)) {
        const discsRes = await getDiscrepancies(params);
        setDiscrepancies(discsRes.data || []);
        setTotalRecords(discsRes.total || 0);
      }

      if (isQcaUser) {
        const assignments = await getUserAssignments(currentUser.username);
        setQcaAssignments(assignments || []);
      } else if (isRenewableUser) {
        // Only an RE plant can sit under a QCA, so only RE users need any of
        // the QCA association, roster or transfer data.
        const assoc = await getQcaAssociation(currentUser.username);
        setQcaAssociation(assoc || null);

        if (assoc?.qcaEligible) {
          const [qcasData, allTransfers] = await Promise.all([
            getQcas(),
            getTransferRequests()
          ]);
          setQcasList(qcasData || []);
          setMyTransferRequests(allTransfers ? allTransfers.filter(tr => tr.requested_by === currentUser.username) : []);
        } else {
          setQcasList([]);
          setMyTransferRequests([]);
        }
      } else {
        // ISGS / States user — no QCA involvement of any kind.
        setQcaAssociation(null);
        setQcasList([]);
        setMyTransferRequests([]);
      }

      if (activeTab === 'outages') {
        const outList = await getOutages(currentUser.username);
        setOutages(outList);
      }
      if (activeTab === 'cycle_upload') {
        const uploadList = await getMyCycleUploads(currentUser.username);
        setCycleUploads(uploadList);
      }
    } catch (err) {
      // Surface the failure instead of leaving an unexplained empty table.
      console.error('[UserDashboard] loadData error:', err.message);
      setLoadError(err.message || 'Could not load your data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  // Fetch immediately on entry. The 300ms debounce here caused the same
  // "loads, then reloads" flash as the admin dashboard: the tab painted with
  // the previous tab's data, then swapped to a skeleton a moment later. None of
  // these dependencies changes faster than a click.
  useEffect(() => {
    Promise.resolve().then(() => loadConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => loadData());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentPage, pageSize, fromDateFilter, toDateFilter, typeFilter]);

  useEffect(() => {
    if (currentUser) {
      Promise.resolve().then(() => {
        setProfileName(currentUser.name || '');
        setEmail1(currentUser.email || '');
        setEmail2(currentUser.email2 || '');
        setEmail3(currentUser.email3 || '');
        setMobile(currentUser.mobile || '');
      });
    }
  }, [currentUser]);

  const getDaysDiff = (dateStr) => {
    if (!dateStr) return null;
    const target = new Date(dateStr);
    const today = new Date();
    target.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.floor((today - target) / (1000 * 60 * 60 * 24));
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);

    // Check here as well as on the server, so the user is told immediately
    // rather than after an upload that was going to be refused anyway.
    const problem = validateFiles(files);
    if (problem) {
      setFormError(problem);
      e.target.value = '';
      return;
    }

    setFormError('');
    setSelectedFiles(prev => [...prev, ...files]);
    e.target.value = '';   // allow re-picking the same file after removing it
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, idx) => idx !== index));
  };

  // Compile tag string format for DB discrepancies tags column
  const getCompiledDiscrepancyType = () => {
    return selectedReasons.map(r => {
      if (r === 'Miscellaneous') {
        return miscReasonText ? `<Misc: ${miscReasonText}>` : '<Miscellaneous>';
      }
      return `<${r}>`;
    }).filter(t => t !== '').join(' ');
  };

  // Escape closes the detail dialog, and the list behind it stops scrolling.
  useModalDismiss(!!selectedRequest, () => setSelectedRequest(null));

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (isSubmitting) return;   // guard against a double click
    if (isQcaUser && !selectedPlantAcronym) { setFormError('Please select a plant from your assignments.'); return; }
    if (!correctionDate) { setFormError('Please select a correction date.'); return; }
    if (!timeBlocks.trim()) { setFormError('Please specify the affected time blocks.'); return; }
    const blockCheck = parseTimeBlocks(timeBlocks);
    if (!blockCheck.ok) { setFormError(blockCheck.error); return; }
    if (selectedReasons.length === 0) { setFormError('Please select at least one type of discrepancy.'); return; }
    if (selectedReasons.includes('Miscellaneous') && !miscReasonText.trim()) { setFormError('Please specify details for the miscellaneous reason.'); return; }
    if (!reason.trim()) { setFormError('Please enter detailed remarks explaining the discrepancy.'); return; }

    const diff = getDaysDiff(correctionDate);
    
    // Validate window limit
    if (reRaiseReqNo) {
      const windowLimit = parseInt(config.reraiseWindow || '45');
      if (diff > windowLimit) {
        setFormError(`Cannot re-raise. The correction date is ${diff} days old, exceeding the re-raise limit of ${windowLimit} days.`);
        return;
      }
    } else {
      const maxAllowed = config.allowExtended ? (config.extendedMaxDays || 15) : config.maxDays;
      if (diff > maxAllowed) {
        setFormError(`Cannot file discrepancy. Selected date is ${diff} days old, which exceeds the allowed limit of ${maxAllowed} days.`);
        return;
      }
    }

    // Validate Excel File format
    if (selectedFiles.length > 0) {
      const invalidFile = selectedFiles.find(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        const isExcel = ext === 'xlsx' || ext === 'xls';
        const startsWithSummary = file.name.startsWith('NetSchdReportSummary@');
        const containsRev = file.name.includes('@rev(');
        return !isExcel || !startsWithSummary || !containsRev;
      });

      if (invalidFile) {
        setFormError('Please upload the Net Schedule Report summary from WBES link (filename must start with NetSchdReportSummary@, contain revision details, and be an Excel file).');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let uploadedFilenames = [];
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        selectedFiles.forEach(file => {
          formData.append('files', file);
        });
        const uploadRes = await uploadFiles(formData);
        if (uploadRes.success) {
          uploadedFilenames = uploadRes.filenames;
        }
      }

      const discrepancyType = getCompiledDiscrepancyType();

      if (reRaiseReqNo) {
        // Re-raise submission
        await reRaiseDiscrepancy(reRaiseReqNo, currentUser.username, reason, discrepancyType, uploadedFilenames);
        setFormSuccess('Discrepancy re-raised successfully!');
      } else {
        // Standard new creation
        const targetAcronym = isQcaUser ? selectedPlantAcronym : currentUser.wbes_acronym;
        await createDiscrepancy(currentUser.username, correctionDate, blockCheck.normalised, reason, discrepancyType, uploadedFilenames, targetAcronym);
        setFormSuccess('Discrepancy filed successfully and dispatched to NRLDC operations!');
      }

      setCorrectionDate(''); 
      setTimeBlocks(''); 
      setReason(''); 
      setSelectedReasons([]);
      setMiscReasonText('');
      setSelectedFiles([]);
      setSelectedPlantAcronym('');
      setReRaiseReqNo(null);
      await loadData();
    } catch (err) {
      setFormError(err.message || 'Failed to file discrepancy.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSearchPlants = async (e) => {
    if (e) e.preventDefault();
    setAssignError('');
    try {
      const data = await getWbesEntities(wbesSearch);
      setWbesEntities(data || []);
    } catch (err) {
      setAssignError(err.message || 'Failed to search plants.');
    }
  };

  const handleAddPlantAssignment = async (acronym) => {
    setAssignError('');
    setAssignSuccess('');
    if (!assignFromDate) {
      setAssignError('Please specify the effective From Date.');
      return;
    }
    try {
      const res = await createUserAssignment(currentUser.username, acronym, assignFromDate);
      if (res.success) {
        setAssignSuccess(res.message);
        setWbesSearch('');
        setWbesEntities([]);
        await loadData();
      }
    } catch (err) {
      setAssignError(err.message || 'Failed to assign plant.');
    }
  };

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    setTransferSuccess('');
    setTransferError('');
    if (!selectedTargetQca) {
      setTransferError('Please select a target QCA.');
      return;
    }
    if (!transferEffectiveDate) {
      setTransferError('Please select an effective date.');
      return;
    }
    if (qcaAssociation && qcaAssociation.qcaUsername === selectedTargetQca) {
      setTransferError('Selected QCA is already your current QCA.');
      return;
    }
    try {
      setSubmittingTransfer(true);
      await createTransferRequest(currentUser.wbes_acronym, selectedTargetQca, transferEffectiveDate, currentUser.username);
      setTransferSuccess('Transfer request submitted successfully. It is now pending NRLDC Admin approval.');
      setSelectedTargetQca('');
      const allTransfers = await getTransferRequests();
      setMyTransferRequests(allTransfers ? allTransfers.filter(tr => tr.requested_by === currentUser.username) : []);
    } catch (err) {
      setTransferError(err.message || 'Failed to submit transfer request.');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const handleReRaiseClick = (disc) => {
    // 1. Set reRaise reference
    setReRaiseReqNo(disc.req_no);
    
    // 2. Prepopulate form values
    setCorrectionDate(disc.correction_for_date?.slice(0, 10) || '');
    setTimeBlocks(disc.time_blocks || '');
    if (isQcaUser) {
      setSelectedPlantAcronym(disc.wbes_acronym || '');
    }
    
    // 3. Prepopulate discrepancy types
    const matches = disc.discrepancy_type ? (disc.discrepancy_type.match(/<[^>]+>/g) || []) : [];
    const parsed = matches.map(m => m.slice(1, -1));
    const reasons = [];
    let miscText = '';
    parsed.forEach(p => {
      if (p.startsWith('Misc: ')) {
        reasons.push('Miscellaneous');
        miscText = p.substring(6);
      } else if (p === 'Miscellaneous') {
        reasons.push('Miscellaneous');
      } else {
        reasons.push(p);
      }
    });
    setSelectedReasons(reasons);
    setMiscReasonText(miscText);

    // 4. Prepopulate reason with header block
    setReason(`[New Remarks]: \n\n-----------------\nPrevious Remarks (Req #${disc.req_no}):\n${disc.request_content}`);

    // 5. Navigate to raise form tab
    setActiveTab('raise_request');
  };

  // Filed Outages Submit
  const handleOutageSubmit = async (e) => {
    e.preventDefault();
    setOutageError('');
    setOutageSuccess('');

    if (!outageUnitNumber.trim() || !outageFrom || !outageTo || !outageReason.trim()) {
      setOutageError('Please fill in all mandatory outage details.');
      return;
    }

    const now = new Date();
    if (new Date(outageTo) > now) {
      setOutageError('Outage Date & Time To cannot be in the future.');
      return;
    }
    if (new Date(outageFrom) > now) {
      setOutageError('Outage Date & Time From cannot be in the future.');
      return;
    }

    try {
      setIsSubmitting(true);
      await createOutage({
        username: currentUser.username,
        generator_name: currentUser.name,
        unit_number: outageUnitNumber.trim(),
        outage_type: outageType,
        outage_from: outageFrom,
        outage_to: outageTo,
        reason: outageReason.trim()
      });
      setOutageSuccess('Generating Unit Outage filed successfully in registry!');
      setOutageUnitNumber('');
      setOutageFrom('');
      setOutageTo('');
      setOutageReason('');
      await loadData();
    } catch (err) {
      setOutageError(err.message || 'Failed to file outage.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cycle Data Excel Submit
  const handleCycleSubmit = async (e) => {
    e.preventDefault();
    setCycleError('');
    setCycleSuccess('');

    if (!cycleStartDate || !cycleEndDate || !cycleFile) {
      setCycleError('Please specify the date duration range and pick the Excel data sheet.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('username', currentUser.username);
      formData.append('startDate', cycleStartDate);
      formData.append('endDate', cycleEndDate);
      formData.append('file', cycleFile);

      await uploadCycleData(formData);
      setCycleSuccess('Open / Closed Cycle Generation Excel uploaded successfully!');
      setCycleStartDate('');
      setCycleEndDate('');
      setCycleFile(null);
      // Reset input element
      const fileInput = document.getElementById('cycle-picker');
      if (fileInput) fileInput.value = '';
      await loadData();
    } catch (err) {
      setCycleError(err.message || 'Failed to upload cycle data.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProfileSettingsSubmit = async (e) => {
    e.preventDefault();
    setSettingsError('');
    setSettingsSuccess('');

    if (!profileName.trim() || !email1.trim()) {
      setSettingsError('Station Name and Primary Email are required.');
      return;
    }

    try {
      const res = await changeProfileSettings(currentUser.username, {
        name: profileName.trim(),
        email: email1.trim(),
        email2: email2.trim() || null,
        email3: email3.trim() || null,
        mobile: mobile.trim() || null
      });
      if (res.success) {
        setSettingsSuccess('Profile details updated successfully!');
        if (onUserUpdate) {
          const updatedUser = {
            ...currentUser,
            name: profileName.trim(),
            email: email1.trim(),
            email2: email2.trim() || null,
            email3: email3.trim() || null,
            mobile: mobile.trim() || null
          };
          onUserUpdate(updatedUser);
          localStorage.setItem('nrldc_session_user', JSON.stringify(updatedUser));
        }
      }
    } catch (err) {
      setSettingsError(err.message || 'Failed to update profile.');
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (!password || !confirmPassword) {
      setPasswordError('Please fill in both new password fields.');
      return;
    }
    const policyError = validatePassword(password);
    if (policyError) {
      setPasswordError(policyError);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    try {
      const res = await changeProfileSettings(currentUser.username, { password, currentPassword });
      if (res.success) {
        setPasswordSuccess('Password updated successfully!');
        setCurrentPassword('');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setPasswordError(err.message || 'Failed to update password.');
    }
  };

  const daysDiff = getDaysDiff(correctionDate);
  const maxAllowedDays = config.allowExtended ? (config.extendedMaxDays || 15) : config.maxDays;
  const isDateInvalid = daysDiff !== null && daysDiff > maxAllowedDays;

  // Filter Logic is performed on the server side, but status sorting is client-side
  const filteredDiscrepancies = [...discrepancies].sort((a, b) => {
    const pA = getStatusPriority(a.status);
    const pB = getStatusPriority(b.status);
    if (pA !== pB) return pA - pB;
    return (b.req_no || 0) - (a.req_no || 0);
  });

  return (
    <div className="dashboard-layout">
      {activeTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="flex-row-between">
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ClipboardList /><span>View, Track & Manage Discrepancies</span>
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                History and status of schedule correction requests raised by your station.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => { setReRaiseReqNo(null); setCorrectionDate(''); setTimeBlocks(''); setReason(''); setSelectedReasons([]); setMiscReasonText(''); setActiveTab('raise_request'); }}>
              <Plus size={16} /> Raise New Discrepancy
            </button>
          </div>

          {/* Filters Bar */}
          <div className="glass-panel" style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ud-correction-from-date">Correction From Date</label>
              <input id="ud-correction-from-date" type="date" className="form-control" value={fromDateFilter} onChange={(e) => setFromDateFilter(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ud-correction-to-date">Correction To Date</label>
              <input id="ud-correction-to-date" type="date" className="form-control" value={toDateFilter} onChange={(e) => setToDateFilter(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="ud-discrepancy-type-filter">Discrepancy Type Filter</label>
              <select id="ud-discrepancy-type-filter" className="form-control" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="ALL">All Types</option>
                {FILTERABLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button className="btn btn-secondary" style={{ height: '40px' }} onClick={() => { setFromDateFilter(''); setToDateFilter(''); setTypeFilter('ALL'); }}>
              Reset Filters
            </button>
          </div>

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

          {/* Table */}
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Req No</th>
                  <th>Filed Date</th>
                  <th>Correction Date</th>
                  <th>Days Diff</th>
                  <th>Type of Discrepancy</th>
                  <th>Time Blocks</th>
                  <th>Reason / Details</th>
                  <th>Attachments</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && filteredDiscrepancies.length === 0 ? (
                  <SkeletonRows rows={6} columns={10} />
                ) : filteredDiscrepancies.length === 0 ? (
                  <tr>
                    <td colSpan="10">
                      <EmptyState
                        title="No discrepancies to show"
                        hint={fromDateFilter || toDateFilter || typeFilter !== 'ALL'
                          ? 'No requests match the current filters. Try widening the date range or resetting the filters.'
                          : 'Requests you file will appear here. Use "File Discrepancy" to raise one.'}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredDiscrepancies.map((disc) => {
                    const diffNow = getDaysDiff(disc.correction_for_date);
                    const reraiseWin = parseInt(config.reraiseWindow || '45');
                    const reraiseLim = parseInt(config.reraiseLimit || '2');
                    
                    const isExceededWindow = diffNow > reraiseWin;
                    const isExceededLimit = (disc.reraise_count || 0) >= reraiseLim;
                    const isTooOldToReRaise = isExceededWindow || isExceededLimit;
                    
                    let disableReason = '';
                    if (isExceededWindow) disableReason = `Older than window limit of ${reraiseWin} days`;
                    else if (isExceededLimit) disableReason = `Exceeded max limit of ${reraiseLim} re-raises`;

                    return (
                      <tr key={disc.req_no} className={`${disc.energy_category} status-${disc.status.toLowerCase()}`} style={{ cursor: 'pointer' }}>
                        <td onClick={() => setSelectedRequest(disc)} style={{ fontWeight: 'bold' }}>#{disc.req_no}</td>
                        <td onClick={() => setSelectedRequest(disc)}>{formatDateDMY(disc.request_date)}</td>
                        <td onClick={() => setSelectedRequest(disc)} style={{ fontWeight: '500' }}>{formatDateDMY(disc.correction_for_date)}</td>
                        <td onClick={() => setSelectedRequest(disc)}>
                          <span style={{ color: disc.days_diff > config.maxDays ? 'var(--warn-strong)' : 'var(--text-primary)', fontWeight: disc.days_diff > config.maxDays ? 'bold' : 'normal' }}>
                            {disc.days_diff} day{disc.days_diff !== 1 ? 's' : ''}
                            {disc.days_diff > config.maxDays && <span style={{ marginLeft: '4px' }} title={`Beyond regulation limit of ${config.maxDays} days`}>⚠️</span>}
                          </span>
                        </td>
                        <td onClick={() => setSelectedRequest(disc)} style={{ maxWidth: '180px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {disc.discrepancy_type ? (
                              disc.discrepancy_type.match(/<[^>]+>/g)?.map((tag, idx) => (
                                <span key={idx} style={{
                                  background: 'rgba(59,130,246,0.1)',
                                  color: 'var(--link-text)',
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
                        <td onClick={() => setSelectedRequest(disc)} style={{ maxWidth: '120px', wordBreak: 'break-word', whiteSpace: 'normal', fontSize: '0.8rem' }}>{disc.time_blocks}</td>
                        <td onClick={() => setSelectedRequest(disc)} style={{ maxWidth: '350px', textOverflow: 'ellipsis', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', whiteSpace: 'normal' }} title={disc.request_content}>
                          {disc.request_content}
                        </td>
                        <td onClick={() => setSelectedRequest(disc)}>
                          {disc.files && disc.files.length > 0 ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--accent-blue)' }}>
                              <FileText size={12} />{disc.files.length} attached
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>}
                        </td>
                        <td onClick={() => setSelectedRequest(disc)}>
                          <span className={`status-badge ${disc.status.toLowerCase()}`}>
                            {disc.status === 'Resolved' && <CheckCircle2 size={12} />}
                            {disc.status === 'Rejected' && <XCircle size={12} />}
                            {disc.status === 'Pending' && <AlertCircle size={12} />}
                            {disc.status}
                          </span>
                        </td>
                        <td>
                          {isRenewableUser && qcaAssociation?.qcaEligible && qcaAssociation?.assignedToQCA ? (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>View Only (QCA Managed)</span>
                          ) : (disc.status === 'Resolved' || disc.status === 'Rejected' || disc.status === 'Returned') ? (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={(e) => { e.stopPropagation(); handleReRaiseClick(disc); }}
                              disabled={isTooOldToReRaise}
                              title={isTooOldToReRaise ? `Disabled: ${disableReason}` : `Re-raise discrepancy (Used: ${disc.reraise_count || 0}/${reraiseLim})`}
                            >
                              <RefreshCw size={12} /> Raise Again
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Awaiting RLDC Review</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
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

      {activeTab === 'raise_request' && (
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <Calendar />
            <span>{reRaiseReqNo ? `Re-raise Discrepancy (Req #${reRaiseReqNo})` : 'Schedule Correction Request Form'}</span>
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '25px', borderBottom: '1px solid var(--border-color)', paddingBottom: '15px' }}>
            {reRaiseReqNo 
              ? `You are re-raising an existing discrepancy. Remarks typed will be saved, and status reset to Pending.`
              : `As per prevailing regulations (IEGC 2023, 49(11)(b)), standard discrepancy filing is within ${config.maxDays} days. ${config.allowExtended ? `An extended discrepancy filing limit is ${config.extendedMaxDays} days.` : ''}`
            }
          </p>

          <Banner type="error" message={formError} />

          <Banner type="success" message={formSuccess} />

          {isRenewableUser && qcaAssociation?.qcaEligible && qcaAssociation?.assignedToQCA ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', width: '100%' }}>
              <div style={{ padding: '30px', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <AlertCircle size={36} style={{ color: 'var(--warn-strong)' }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Filing Restricted</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: 0 }}>
                  Your plant <strong>{currentUser.wbes_acronym}</strong> is currently managed by QCA <strong>{qcaAssociation.qcaName}</strong>.
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
                  Only authorized QCA coordinators can file discrepancies on your behalf.
                </p>
              </div>

              {/* Request Transfer Section */}
              <div style={{ padding: '25px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '10px' }}>Request QCA Transfer</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '20px' }}>
                  If you need to change your registered QCA, select the target QCA and effective date below to submit a transfer request to the NRLDC Admin.
                </p>

                <Banner type="error" message={transferError} />

                <Banner type="success" message={transferSuccess} />

                <form onSubmit={handleTransferSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor="ud-target-qca">Target QCA <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                      <select id="ud-target-qca"
                        className="form-control"
                        value={selectedTargetQca}
                        onChange={(e) => setSelectedTargetQca(e.target.value)}
                        required
                      >
                        <option value="">-- Select QCA --</option>
                        {qcasList
                          .filter(q => q.username !== qcaAssociation?.qcaUsername)
                          .map(q => (
                            <option key={q.username} value={q.username}>
                              {q.qca_name} ({q.name})
                            </option>
                          ))
                        }
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor="ud-effective-date">Effective Date <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                      <input id="ud-effective-date"
                        type="date"
                        className="form-control"
                        value={transferEffectiveDate}
                        onChange={(e) => setTransferEffectiveDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingTransfer}
                    style={{ width: '100%', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                  >
                    {submittingTransfer ? 'Submitting Request...' : 'Submit Transfer Request'}
                  </button>
                </form>
              </div>

              {/* Transfer Request History */}
              {myTransferRequests.length > 0 && (
                <div style={{ padding: '25px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '15px' }}>My Transfer Requests</h3>
                  <div className="table-container">
                    <table className="custom-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>To QCA</th>
                          <th>Effective Date</th>
                          <th>Status</th>
                          <th>Submitted At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myTransferRequests.map((tr) => {
                          const matchingQca = qcasList.find(q => q.username === tr.to_username);
                          const targetQcaLabel = matchingQca ? matchingQca.qca_name : tr.to_username;
                          return (
                            <tr key={tr.id}>
                              <td>#{tr.id}</td>
                              <td style={{ fontWeight: 'bold' }}>{targetQcaLabel}</td>
                              <td>{formatDateDMY(tr.effective_date)}</td>
                              <td>
                                <span className={`status-badge ${tr.status.toLowerCase()}`}>
                                  {tr.status}
                                </span>
                              </td>
                              <td>{formatDateDMYHM(tr.created_at)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleFormSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-initiating-entity">Initiating Entity</label>
                  <input id="ud-initiating-entity" type="text" className="form-control" value={currentUser.name} disabled />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-correction-for-date">Correction For Date</label>
                  <input id="ud-correction-for-date"
                    type="date"
                    className="form-control"
                    value={correctionDate}
                    onChange={(e) => setCorrectionDate(e.target.value)}
                    style={{ border: isDateInvalid ? '1px solid #dc2626' : '' }}
                  />
                  {correctionDate && (
                    <span style={{ fontSize: '0.8rem', marginTop: '4px', color: isDateInvalid ? 'var(--danger-text)' : (daysDiff > config.maxDays ? '#f59e0b' : 'var(--status-resolved-text)'), fontWeight: '500', display: 'block' }}>
                      {isDateInvalid
                        ? `⚠️ Disallowed: date is ${daysDiff} days old (limit: ${maxAllowedDays} days)`
                        : (daysDiff > config.maxDays 
                            ? `⚠ Extended Filing: The selected date is ${daysDiff} days old and exceeds the prescribed filing period of ${config.maxDays} days under IEGC 2023, Regulation 49(11)(b). Users are advised to submit discrepancies within the prescribed timeline.`
                            : `✅ Valid: date is ${daysDiff} day${daysDiff !== 1 ? 's' : ''} old.`
                          )}
                    </span>
                  )}
                </div>
              </div>

              {isQcaUser && (
                <div className="form-group">
                  <label htmlFor="ud-select-plant-wbes-acronym">Select Plant (WBES Acronym) <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                  {reRaiseReqNo ? (
                    <input id="ud-select-plant-wbes-acronym" 
                      type="text" 
                      className="form-control" 
                      value={selectedPlantAcronym} 
                      disabled 
                      style={{ background: 'var(--bg-tertiary)', cursor: 'not-allowed', fontWeight: 'bold' }} 
                    />
                  ) : (
                    <select
                      className="form-control"
                      value={selectedPlantAcronym}
                      onChange={(e) => setSelectedPlantAcronym(e.target.value)}
                      required
                    >
                      <option value="">-- Choose Assigned Plant --</option>
                      {qcaAssignments
                        .filter(a => !a.to_date || new Date(a.to_date) >= new Date())
                        .map(a => (
                          <option key={a.wbes_acronym} value={a.wbes_acronym}>
                            {a.wbes_acronym} ({a.plant_name})
                          </option>
                        ))
                      }
                    </select>
                  )}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="ud-auto-populated-email">Auto-populated Email</label>
                <input id="ud-auto-populated-email" type="text" className="form-control" value={currentUser.email} disabled />
              </div>

              {/* Checkbox Discrepancy Type */}
              <div className="form-group">
                <label>Type of Discrepancy (Select applicable categories)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', background: 'var(--bg-tertiary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '6px' }}>
                {availableReasons.map((reasonOpt, idx) => {
                  const isChecked = selectedReasons.includes(reasonOpt);
                  return (
                    <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)', margin: 0 }}>
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        onChange={() => {
                          if (isChecked) {
                            setSelectedReasons(prev => prev.filter(r => r !== reasonOpt));
                          } else {
                            setSelectedReasons(prev => [...prev, reasonOpt]);
                          }
                        }}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <span>{reasonOpt}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {selectedReasons.includes("Miscellaneous") && (
              <div className="form-group" style={{ animation: 'modalFadeIn 0.2s ease-out' }}>
                <label htmlFor="ud-specify-miscellaneous-reason">Specify Miscellaneous Reason</label>
                <input id="ud-specify-miscellaneous-reason" 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Schedule mismatch in bilateral exchange parameters" 
                  value={miscReasonText} 
                  onChange={(e) => setMiscReasonText(e.target.value)} 
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="ud-affected-time-blocks">Affected Time Blocks</label>
              <input
                id="ud-affected-time-blocks"
                type="text"
                className="form-control"
                inputMode="numeric"
                placeholder="e.g. 4,5,84 or 85-87,95,96"
                value={timeBlocks}
                onChange={(e) => setTimeBlocks(e.target.value)}
              />
              {/* Live feedback: numbers, commas and ranges only, blocks 1-96. */}
              {timeBlocks.trim() && (() => {
                const check = parseTimeBlocks(timeBlocks);
                return check.ok ? (
                  <small style={{ color: 'var(--status-resolved-text)', fontSize: '0.75rem' }}>
                    ✓ {check.blocks.length} block{check.blocks.length === 1 ? '' : 's'} selected — will be saved as {check.normalised}
                  </small>
                ) : (
                  <small style={{ color: 'var(--danger-text)', fontSize: '0.75rem' }}>{check.error}</small>
                );
              })()}
            </div>

            <div className="form-group">
              <label htmlFor="ud-remarks-explanation-highlight-blocks-what-should-have-been-schedule">Remarks & Explanation (Highlight blocks & what should have been schedule)</label>
              <textarea id="ud-remarks-explanation-highlight-blocks-what-should-have-been-schedule" rows="6" className="form-control" placeholder="Explain the discrepancy in detail..." value={reason} onChange={(e) => setReason(e.target.value)}></textarea>
            </div>

            <div className="form-group">
              <label>Upload Supporting Documents (Optional - excel sheet from WBES recommended)</label>
              <div className="file-upload-zone" onClick={() => document.getElementById('file-picker').click()}>
                <Upload size={32} style={{ color: 'var(--text-secondary)', marginBottom: '8px' }} />
                <p style={{ fontSize: '0.9rem', fontWeight: '500' }}>Click to select Net Schedule Summary</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>File name must match format: NetSchdReportSummary@...</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{ALLOWED_DESCRIPTION} only, up to {MAX_UPLOAD_MB} MB per file.</p>
                <input type="file" id="file-picker" multiple accept={ACCEPT_ATTRIBUTE} style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
              {selectedFiles.length > 0 && (
                <div className="file-list">
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} className="file-row">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={14} style={{ color: 'var(--accent-blue)' }} />{file.name}</span>
                      <button type="button" className="file-remove" onClick={() => removeFile(idx)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setActiveTab('dashboard')}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={isDateInvalid || isSubmitting}>
                {isSubmitting
                  ? (selectedFiles.length > 0 ? 'Uploading attachments…' : 'Submitting…')
                  : (reRaiseReqNo ? 'Re-Raise Discrepancy' : 'Submit Request')}
              </button>
            </div>
          </form>
          )}

          {/* Request Association Section for independent RE plant users.
              QCA coordination applies to Renewable Energy plants only, so ISGS
              and States users never see this. */}
          {currentUser.role === 'USER' && isRenewableUser && qcaAssociation?.qcaEligible && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', marginTop: '30px' }}>
              <div style={{ padding: '25px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '10px' }}>Request QCA Association</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '20px' }}>
                  If you want to associate this independent plant with a Coordinating Agency (QCA), select the target QCA and effective date below to submit an association request to the NRLDC Admin.
                </p>

                <Banner type="error" message={transferError} />

                <Banner type="success" message={transferSuccess} />

                <form onSubmit={handleTransferSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor="ud-target-qca-2">Target QCA <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                      <select id="ud-target-qca-2"
                        className="form-control"
                        value={selectedTargetQca}
                        onChange={(e) => setSelectedTargetQca(e.target.value)}
                        required
                      >
                        <option value="">-- Select QCA --</option>
                        {qcasList.map(q => (
                          <option key={q.username} value={q.username}>
                            {q.qca_name} ({q.name})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor="ud-effective-date-2">Effective Date <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                      <input id="ud-effective-date-2"
                        type="date"
                        className="form-control"
                        value={transferEffectiveDate}
                        onChange={(e) => setTransferEffectiveDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingTransfer}
                    style={{ width: '100%', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                  >
                    {submittingTransfer ? 'Submitting Request...' : 'Submit Association Request'}
                  </button>
                </form>
              </div>

              {/* Transfer Request History */}
              {myTransferRequests.length > 0 && (
                <div style={{ padding: '25px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '15px' }}>My Association Requests</h3>
                  <div className="table-container">
                    <table className="custom-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>To QCA</th>
                          <th>Effective Date</th>
                          <th>Status</th>
                          <th>Submitted At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myTransferRequests.map((tr) => {
                          const matchingQca = qcasList.find(q => q.username === tr.to_username);
                          const targetQcaLabel = matchingQca ? matchingQca.qca_name : tr.to_username;
                          return (
                            <tr key={tr.id}>
                              <td>#{tr.id}</td>
                              <td style={{ fontWeight: 'bold' }}>{targetQcaLabel}</td>
                              <td>{formatDateDMY(tr.effective_date)}</td>
                              <td>
                                <span className={`status-badge ${tr.status.toLowerCase()}`}>
                                  {tr.status}
                                </span>
                              </td>
                              <td>{formatDateDMYHM(tr.created_at)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Outages tab */}
      {activeTab === 'outages' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          <div className="glass-panel" style={{ padding: '30px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <Zap style={{ color: 'var(--accent-teal)' }} /><span>Generating Unit Outage Filing Form</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              Submit generating unit outage details (Forced or Partial outages) for scheduling database updates.
            </p>

            <Banner type="error" message={outageError} />

            <Banner type="success" message={outageSuccess} />

            <form onSubmit={handleOutageSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '15px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-generator-acronym-wbes">Generator Acronym (WBES)</label>
                  <input id="ud-generator-acronym-wbes" type="text" className="form-control" value={`${currentUser.name} (${currentUser.wbes_acronym || 'No Acronym'})`} disabled />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-unit-number-affected">Unit Number Affected</label>
                  <input id="ud-unit-number-affected" type="text" className="form-control" placeholder="e.g. Unit 3 or Unit 5" value={outageUnitNumber} onChange={(e) => setOutageUnitNumber(e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="ud-type-of-outage">Type of Outage</label>
                <select id="ud-type-of-outage" className="form-control" value={outageType} onChange={(e) => setOutageType(e.target.value)}>
                  <option value="Partial Outage">Partial Outage</option>
                  <option value="Forced Outage">Forced Outage</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '15px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-outage-date-amp-time-from">Outage Date &amp; Time From</label>
                  <input id="ud-outage-date-amp-time-from" type="datetime-local" className="form-control" value={outageFrom} onChange={(e) => setOutageFrom(e.target.value)} max={nowDatetimeLocal()} required />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-outage-date-amp-time-to">Outage Date &amp; Time To</label>
                  <input id="ud-outage-date-amp-time-to" type="datetime-local" className="form-control" value={outageTo} onChange={(e) => setOutageTo(e.target.value)} max={nowDatetimeLocal()} required />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="ud-reason-of-outage-specify-proper-and-exact-details">Reason of Outage (Specify proper and exact details)</label>
                <textarea id="ud-reason-of-outage-specify-proper-and-exact-details" rows="4" className="form-control" placeholder="e.g. Boiler tube leakage, PA FAN-3A TRIPPED..." value={outageReason} onChange={(e) => setOutageReason(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="submit" className="btn btn-teal" disabled={isSubmitting}>
                  {isSubmitting ? 'Filing…' : 'File Outage Details'}
                </button>
              </div>
            </form>
          </div>

          {/* Outages List */}
          <div className="table-container">
            <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={16} style={{ color: 'var(--accent-teal)' }} />
              <span>Your Filed Outages Registry</span>
            </h3>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Unit Number</th>
                  <th>Outage Type</th>
                  <th>Outage Date From</th>
                  <th>Outage Date To</th>
                  <th>Reason of Outage</th>
                  <th>Approval Status</th>
                </tr>
              </thead>
              <tbody>
                {outages.length === 0 ? (
                  <tr>
                    <td colSpan="7">
                      <EmptyState title="No outages filed" hint="Unit outages you report will be listed here." icon={Zap} />
                    </td>
                  </tr>
                ) : (
                  outages.map((out) => (
                    <tr key={out.id}>
                      <td>{formatDateDMYHM(out.created_at)}</td>
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cycle Data Upload tab */}
      {activeTab === 'cycle_upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          <div className="glass-panel" style={{ padding: '30px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <Database style={{ color: 'var(--accent-blue)' }} /><span>Open / Closed Cycle Generation Data Upload</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              Select duration date range and upload Open, Cycle, and Closed Cycle operation data sheets.
            </p>

            <Banner type="error" message={cycleError} />

            <Banner type="success" message={cycleSuccess} />

            <form onSubmit={handleCycleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '15px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-duration-start-date">Duration Start Date</label>
                  <input id="ud-duration-start-date" type="date" className="form-control" value={cycleStartDate} onChange={(e) => setCycleStartDate(e.target.value)} required />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="ud-duration-end-date">Duration End Date</label>
                  <input id="ud-duration-end-date" type="date" className="form-control" value={cycleEndDate} onChange={(e) => setCycleEndDate(e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label>Cycle Data Excel File</label>
                <input 
                  type="file" 
                  id="cycle-picker"
                  className="form-control" 
                  onChange={(e) => setCycleFile(e.target.files[0])} 
                  required 
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  Please upload .xlsx or .xls sheets containing unit cycle metrics.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="submit" className="btn btn-teal" disabled={isSubmitting}>
                  {isSubmitting ? 'Uploading…' : 'Upload Cycle Data'}
                </button>
              </div>
            </form>
          </div>

          {/* Cycle Uploads List */}
          <div className="table-container">
            <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={16} style={{ color: 'var(--accent-blue)' }} />
              <span>Your Cycle Data Upload History</span>
            </h3>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Upload Timestamp</th>
                  <th>Date Range Duration</th>
                  <th>Excel Sheet Filename</th>
                  <th>Download / View</th>
                </tr>
              </thead>
              <tbody>
                {cycleUploads.length === 0 ? (
                  <tr>
                    <td colSpan="4">
                      <EmptyState title="No cycle data uploaded" hint="Files you upload for a date range will be listed here." icon={Database} />
                    </td>
                  </tr>
                ) : (
                  cycleUploads.map((up) => {
                    const cleanName = originalFilename(up.filename);
                    return (
                      <tr key={up.id}>
                        <td>{formatDateDMYHM(up.created_at)}</td>
                        <td style={{ fontWeight: '500' }}>{formatDateDMY(up.start_date)} to {formatDateDMY(up.end_date)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{cleanName}</td>
                        <td>
                          <button type="button" onClick={() => downloadFile(`/upload/${encodeURIComponent(up.filename)}`, up.filename).catch(err => notify('error', err.message))} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: '4px 8px' }}>
                            <Download size={12} /> Download
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
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '700px', margin: '0 auto', width: '100%' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <Settings /><span>Profile Settings</span>
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            Update your station contact methods or security options.
          </p>

          {/* Sub Tab Navigation */}
          <div className="category-tabs" style={{ marginBottom: '25px', display: 'flex', gap: '10px' }}>
            <button className={`category-tab ${settingsSubTab === 'profile' ? 'active' : ''}`} onClick={() => { setSettingsSubTab('profile'); setSettingsError(''); setSettingsSuccess(''); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '8px 16px' }}>
              <User size={14} /> Profile Information
            </button>
            <button className={`category-tab ${settingsSubTab === 'security' ? 'active' : ''}`} onClick={() => { setSettingsSubTab('security'); setPasswordError(''); setPasswordSuccess(''); setCurrentPassword(''); setPassword(''); setConfirmPassword(''); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '8px 16px' }}>
              <Lock size={14} /> Security Settings
            </button>
          </div>

          {/* Profile details tab */}
          {settingsSubTab === 'profile' && (
            <form onSubmit={handleProfileSettingsSubmit}>
              <Banner type="error" message={settingsError} />

              <Banner type="success" message={settingsSuccess} />

              <div className="form-group">
                <label htmlFor="ud-username-station-id">Username / Station ID</label>
                <input id="ud-username-station-id" type="text" className="form-control" value={currentUser.username} disabled style={{ background: 'var(--bg-tertiary)', cursor: 'not-allowed' }} />
              </div>

              <div className="form-group">
                <label htmlFor="ud-station-name">Station Name</label>
                <input id="ud-station-name" type="text" className="form-control" value={profileName} onChange={(e) => setProfileName(e.target.value)} required />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Example: ANTA Gas Plant NTPC</span>
              </div>

              <div className="form-group">
                <label htmlFor="ud-wbes-acronym-registered">WBES Acronym (Registered)</label>
                <input id="ud-wbes-acronym-registered" type="text" className="form-control" value={currentUser.wbes_acronym || ''} disabled style={{ background: 'var(--bg-tertiary)', cursor: 'not-allowed', fontWeight: 'bold' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Registered WBES Acronym mapping. Contact RLDC Administrator to update this acronym.</span>
              </div>

              <div className="form-group">
                <label htmlFor="ud-primary-email-mandatory">Primary Email (Mandatory)</label>
                <div style={{ position: 'relative' }}>
                  <input id="ud-primary-email-mandatory" type="email" className="form-control" value={email1} onChange={(e) => setEmail1(e.target.value)} required style={{ paddingLeft: '36px' }} />
                  <Mail size={14} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label htmlFor="ud-secondary-email-optional">Secondary Email (Optional)</label>
                  <div style={{ position: 'relative' }}>
                    <input id="ud-secondary-email-optional" type="email" className="form-control" placeholder="email2@domain.com" value={email2} onChange={(e) => setEmail2(e.target.value)} style={{ paddingLeft: '36px' }} />
                    <Mail size={14} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="ud-tertiary-email-optional">Tertiary Email (Optional)</label>
                  <div style={{ position: 'relative' }}>
                    <input id="ud-tertiary-email-optional" type="email" className="form-control" placeholder="email3@domain.com" value={email3} onChange={(e) => setEmail3(e.target.value)} style={{ paddingLeft: '36px' }} />
                    <Mail size={14} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="ud-mobile-number-optional">Mobile Number (Optional)</label>
                <div style={{ position: 'relative' }}>
                  <input id="ud-mobile-number-optional" type="text" className="form-control" placeholder="+91 XXXXXXXXXX" value={mobile} onChange={(e) => setMobile(e.target.value)} style={{ paddingLeft: '36px' }} />
                  <Phone size={14} style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Can be configured for future 2FA SMS logons.</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '25px' }}>
                <button type="submit" className="btn btn-teal">Save Contact Details</button>
              </div>
            </form>
          )}

          {/* Security tab */}
          {settingsSubTab === 'security' && (
            <form onSubmit={handlePasswordSubmit}>
              <Banner type="error" message={passwordError} />

              <Banner type="success" message={passwordSuccess} />

              <div className="form-group">
                <label htmlFor="ud-current-password">Current Password</label>
                <input id="ud-current-password" type="password" className="form-control" placeholder="Enter your current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
              </div>

              <div className="form-group">
                <label htmlFor="ud-new-password">New Password</label>
                <input id="ud-new-password" type="password" className="form-control" placeholder="Enter new password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
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
                <label htmlFor="ud-confirm-new-password">Confirm New Password</label>
                <input id="ud-confirm-new-password" type="password" className="form-control" placeholder="Verify password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
                {confirmPassword && password !== confirmPassword && (
                  <small style={{ color: 'var(--danger-text)', fontSize: '0.75rem' }}>Passwords do not match.</small>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '25px' }}>
                <button type="submit" className="btn btn-teal">Change Password</button>
              </div>
            </form>
          )}
        </div>
      )}

      {isQcaUser && activeTab === 'my_plants' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="flex-row-between">
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Database /><span>My Plant Assignments (QCA Registry)</span>
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                Manage the generator stations that you file discrepancies for.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
            {/* Left Column: My Active & Historical Assignments */}
            <div className="glass-panel" style={{ padding: '25px' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '15px', fontWeight: '600' }}>Current & Past Assignments</h3>
              <div className="table-container">
                <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Plant Acronym</th>
                      <th>Plant Name</th>
                      <th>From Date</th>
                      <th>To Date (Active)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qcaAssignments.length === 0 ? (
                      <tr>
                        <td colSpan="4">
                          <EmptyState title="No plants assigned" hint="Plants assigned to you will appear here. Use the search above to claim one." />
                        </td>
                      </tr>
                    ) : (
                      qcaAssignments.map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 'bold' }}>{a.wbes_acronym}</td>
                          <td>{a.plant_name}</td>
                          <td>{formatDateDMY(a.from_date)}</td>
                          <td>{a.to_date ? formatDateDMY(a.to_date) : <span className="status-badge resolved" style={{ padding: '2px 6px', fontSize: '0.7rem' }}>Active</span>}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Search & Add Plants */}
            <div className="glass-panel" style={{ padding: '25px' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '10px', fontWeight: '600' }}>Add / Request Plant Assignment</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '15px' }}>
                Search for a registered WBES station. Direct assignment takes place if it has no active owner; otherwise, a Transfer Request will be sent to the administrator.
              </p>

              <Banner type="error" message={assignError} />

              <Banner type="success" message={assignSuccess} />

              <form onSubmit={handleSearchPlants} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search plant name or acronym..."
                    value={wbesSearch}
                    onChange={(e) => setWbesSearch(e.target.value)}
                    style={{ paddingLeft: '32px' }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '13px', color: 'var(--text-muted)' }} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Search
                </button>
              </form>

              {wbesEntities.length > 0 && (
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Effective From Date:</span>
                    <input
                      type="date"
                      className="form-control"
                      value={assignFromDate}
                      onChange={(e) => setAssignFromDate(e.target.value)}
                      style={{ width: '135px', height: '28px', padding: '0 6px', fontSize: '0.8rem' }}
                    />
                  </div>
                  <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                    {wbesEntities.map((entity) => (
                      <div key={entity.wbes_acronym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{entity.wbes_acronym}</strong>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{entity.plant_name} ({entity.energy_category})</div>
                          {entity.current_owner ? (
                            <span style={{ fontSize: '0.7rem', color: 'var(--warn-text)', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '4px' }}>
                              Owner: {entity.current_owner_qca || entity.current_owner}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.7rem', color: 'var(--status-resolved-text)', background: '#d1fae5', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '4px' }}>
                              Unassigned
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn btn-teal"
                          style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                          onClick={() => handleAddPlantAssignment(entity.wbes_acronym)}
                        >
                          {entity.current_owner ? 'Request Transfer' : 'Assign'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedRequest && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={18} /><span>Request Detail: Req #{selectedRequest.req_no}</span>
              </h3>
              <button type="button" className="modal-close" onClick={() => setSelectedRequest(null)} aria-label="Close dialog">&times;</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem' }}>
                <div><span style={{ color: 'var(--text-secondary)' }}>Filer Station:</span> <strong>{selectedRequest.request_by}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Category:</span> <span className={`energy-badge ${selectedRequest.energy_category}`}>{categoryLabel(selectedRequest.energy_category)}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Request Date:</span> {formatDateDMY(selectedRequest.request_date)}</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Correction Date:</span> {formatDateDMY(selectedRequest.correction_for_date)}</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Days Mismatch:</span> <strong style={{ color: selectedRequest.days_diff > config.maxDays ? 'var(--danger-text)' : 'var(--text-primary)' }}>{selectedRequest.days_diff} days</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Status:</span> <span className={`status-badge ${selectedRequest.status.toLowerCase()}`}>{selectedRequest.status}</span></div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Type of Discrepancy Tags:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedRequest.discrepancy_type ? (
                    selectedRequest.discrepancy_type.match(/<[^>]+>/g)?.map((tag, idx) => (
                      <span key={idx} style={{
                        background: 'rgba(59,130,246,0.1)',
                        color: 'var(--link-text)',
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
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Remarks / Explanation:</span>
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
                  <span style={{ color: 'var(--warn-strong)', fontSize: '0.85rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Feedback / Return Comments:</span>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
              <button className="btn btn-primary" onClick={() => setSelectedRequest(null)}>Close Details</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
