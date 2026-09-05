/**
 * registrationPdf.js — a small PDF the applicant can keep after signing up.
 *
 * Built entirely in the browser with jsPDF, from data the applicant already
 * has on screen. Nothing is fetched, and the password is deliberately never
 * included. It is a record of what was submitted and that it is awaiting an
 * administrator's approval — useful to quote a request number in a follow-up.
 */

import { jsPDF } from 'jspdf';

const BRAND = '#0f766e';   // teal, matching the portal accent
const INK = '#1f2937';
const MUTED = '#6b7280';

/**
 * Build the PDF document from the registration details.
 * `details` mirrors the confirmation screen; `mobile` is optional.
 */
export function buildRegistrationPdf({
  requestId, username, wbesAcronym, accountType, category, region, name, email, mobile,
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 56;
  let y = 64;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BRAND);
  doc.text('RLDC Scheduling Discrepancy Portal', marginX, y);

  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(MUTED);
  doc.text('Registration acknowledgement', marginX, y);

  y += 10;
  doc.setDrawColor(BRAND);
  doc.setLineWidth(1.2);
  doc.line(marginX, y, pageW - marginX, y);

  // ── Status note ─────────────────────────────────────────────────────────--
  y += 26;
  doc.setFontSize(10.5);
  doc.setTextColor(INK);
  const note = doc.splitTextToSize(
    'Your registration has been submitted and is pending approval by an administrator. '
    + 'You cannot sign in until it is approved. Keep this document for your records — '
    + 'quote the request number below in any follow-up.',
    pageW - marginX * 2,
  );
  doc.text(note, marginX, y);
  y += note.length * 15 + 12;

  // ── Details table ───────────────────────────────────────────────────────--
  const rows = [
    ['Request number', requestId != null ? `#${requestId}` : '—'],
    ['Username', username || '—'],
    ['WBES acronym', wbesAcronym || '—'],
    ['Account type', accountType || '—'],
    ['Category', category || '—'],
    ['Load despatch centre (RLDC)', region || '—'],
    ['Registered name', name || '—'],
    ['Email', email || '—'],
    ['Mobile', mobile || '—'],
  ];

  const labelX = marginX;
  const valueX = marginX + 190;
  const rowH = 26;

  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) {
      doc.setFillColor(244, 246, 248);
      doc.rect(marginX - 8, y - 16, pageW - marginX * 2 + 16, rowH, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text(String(label), labelX, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(INK);
    doc.text(doc.splitTextToSize(String(value), pageW - valueX - marginX), valueX, y);
    y += rowH;
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  y += 18;
  doc.setDrawColor(224, 227, 233);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, pageW - marginX, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text(
    `Generated ${new Date().toLocaleString('en-IN')} · This is not proof of an active account.`,
    marginX, y,
  );

  return doc;
}

/** File name for the saved PDF, e.g. "registration-DADRI_RE.pdf". */
function fileNameFor(details) {
  const tag = (details.wbesAcronym || details.username || 'details')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `registration-${tag}.pdf`;
}

/** Build and trigger a download of the registration PDF. */
export function downloadRegistrationPdf(details) {
  const doc = buildRegistrationPdf(details);
  doc.save(fileNameFor(details));
}
