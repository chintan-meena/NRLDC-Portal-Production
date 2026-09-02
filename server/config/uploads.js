const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * config/uploads.js — What may be uploaded to the portal.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  TO ALLOW A NEW FILE TYPE, ADD ONE LINE TO THE LIST BELOW.          │
 *  │  Nothing else needs changing — the server and the browser file       │
 *  │  picker both read this list.                                         │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * Each entry needs three things:
 *
 *   ext    the file extension, lower-case, with the dot. THIS is what decides
 *          whether a file is accepted.
 *   mime   the MIME type(s) browsers send for it. Used only as a fallback for
 *          files uploaded with no extension at all, because browsers and
 *          operating systems report these inconsistently.
 *   label  what to call it in error messages and the file picker.
 *
 * To find the MIME type of a file on a Mac:
 *     file --mime-type -b yourfile.docx
 *
 * Example — to also allow Word documents, add:
 *
 *   { ext: '.docx', label: 'Word',
 *     mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
 *
 * After editing, restart the backend (Ctrl+C then ./start.sh). No database
 * change and no frontend change is needed.
 */

const ALLOWED_UPLOAD_TYPES = [
  {
    ext: '.pdf',
    label: 'PDF',
    mime: ['application/pdf'],
  },
  {
    ext: '.xlsx',
    label: 'Excel workbook',
    mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  {
    ext: '.xls',
    label: 'Excel 97-2003 workbook',
    mime: ['application/vnd.ms-excel', 'application/excel', 'application/x-excel'],
  },
  {
    ext: '.xlsm',
    label: 'Excel macro-enabled workbook',
    mime: ['application/vnd.ms-excel.sheet.macroEnabled.12'],
  },
  {
    ext: '.csv',
    label: 'CSV',
    mime: ['text/csv', 'application/csv', 'text/plain'],
  },
];

/**
 * Largest single file accepted, in megabytes. WBES schedule exports are small;
 * this is generous. Raise it here if a legitimate upload is ever refused.
 */
const MAX_UPLOAD_MB = 25;

// ─── Everything below is derived — you should not need to edit it ───────────

const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** e.g. ".pdf, .xlsx, .xls, .xlsm, .csv" — for the browser's file picker. */
const ACCEPT_ATTRIBUTE = ALLOWED_UPLOAD_TYPES.map(t => t.ext).join(',');

/** e.g. "PDF, Excel workbook, ..." — for messages shown to people. */
const ALLOWED_DESCRIPTION = ALLOWED_UPLOAD_TYPES
  .map(t => `${t.label} (${t.ext})`)
  .join(', ');

function extensionOf(filename) {
  const i = String(filename).lastIndexOf('.');
  return i === -1 ? '' : String(filename).slice(i).toLowerCase();
}

/**
 * True when the file is one of the types listed above.
 *
 * The extension is authoritative: it is what determines how the file will be
 * opened by whoever downloads it, and matching on MIME as well would let a
 * .txt through simply because CSV shares text/plain. A file with no extension
 * at all falls back to its MIME type so a legitimate upload is not blocked
 * outright.
 */
function isAllowedUpload(originalname, mimetype) {
  const ext = extensionOf(originalname);
  if (ext) {
    return ALLOWED_UPLOAD_TYPES.some(t => t.ext === ext);
  }
  const mime = String(mimetype || '').toLowerCase();
  return ALLOWED_UPLOAD_TYPES.some(t => t.mime.includes(mime));
}

/** A multer fileFilter that rejects anything not in the list. */
function uploadFileFilter(req, file, cb) {
  if (isAllowedUpload(file.originalname, file.mimetype)) return cb(null, true);

  const err = new Error(
    `"${file.originalname}" is not an accepted file type. Allowed types: ${ALLOWED_DESCRIPTION}.`
  );
  err.code = 'UNSUPPORTED_FILE_TYPE';
  cb(err);
}

/**
 * Build a configured multer instance plus an error wrapper for a destination
 * directory. Both upload routes use this so the rules cannot drift apart.
 */
function createUploader(destinationDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, destinationDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      // Keep the characters the WBES Net Schedule naming convention is built on
      // — '@', '(' and ')' — so a file uploaded as
      //   NetSchdReportSummary@ACR@rev(137)@date.xlsx
      // still reads as one afterwards. Stripping them to '_' (as this did) left
      // an ISGS/RE filer unable to submit: isNetScheduleSummary() no longer
      // matched the stored name, and the mandatory-attachment rule refused the
      // very file they had attached. '/' and every other path- or shell-unsafe
      // character is still replaced; the unique prefix already guarantees the
      // name cannot start with a dot or collide.
      const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.@()_-]/g, '_');
      const finalName = uniqueSuffix + '-' + cleanOriginalName;

      // Remember what we started writing. multer streams to disk as it reads,
      // so a file that later breaches the size limit still leaves a truncated
      // copy behind unless we delete it ourselves.
      req._uploadedPaths = req._uploadedPaths || [];
      req._uploadedPaths.push(path.join(destinationDir, finalName));

      cb(null, finalName);
    },
  });

  const upload = multer({
    storage,
    fileFilter: uploadFileFilter,
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  /** Remove anything written for a request that ended up being rejected. */
  function discardPartialUploads(req) {
    for (const p of req._uploadedPaths || []) {
      fs.promises.unlink(p).catch(() => { /* already gone */ });
    }
    req._uploadedPaths = [];
  }

  /**
   * Turn multer's rejections into a clear 400 rather than a generic 500, and
   * make sure nothing is left on disk when a request is refused.
   */
  function handleUploadErrors(handler) {
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (!err) return next();

        discardPartialUploads(req);

        if (err.code === 'UNSUPPORTED_FILE_TYPE') {
          return res.status(400).json({ error: err.message });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `That file is too large. The limit is ${MAX_UPLOAD_MB} MB per file.` });
        }
        console.error('[UPLOAD ERROR]', err);
        return res.status(400).json({ error: err.message || 'Upload failed.' });
      });
    };
  }

  return { upload, handleUploadErrors, discardPartialUploads };
}

module.exports = {
  createUploader,
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
  ACCEPT_ATTRIBUTE,
  ALLOWED_DESCRIPTION,
  isAllowedUpload,
  uploadFileFilter,
};
