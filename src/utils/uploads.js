/**
 * uploads.js — Allowed upload types (client side).
 *
 * Mirrors server/config/uploads.js so the file picker shows the right filter
 * and the user gets an immediate message instead of a round trip. The server
 * enforces the real rule — this is convenience only.
 *
 * IF YOU ADD A TYPE, ADD IT IN BOTH PLACES:
 *   server/config/uploads.js   ← the one that actually enforces
 *   src/utils/uploads.js       ← this file, for the picker and the hint
 */

// .xlsm (macro-enabled) and .csv are deliberately excluded — see the note in
// server/config/uploads.js. Only PDF and plain Excel, uniform for all users.
export const ALLOWED_EXTENSIONS = ['.pdf', '.xlsx', '.xls'];

export const MAX_UPLOAD_MB = 25;

/** Value for an <input type="file"> accept attribute. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(',');

/** Human-readable list, e.g. for a hint under the upload box. */
export const ALLOWED_DESCRIPTION = 'PDF and Excel (.xlsx, .xls)';

function extensionOf(name) {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i).toLowerCase();
}

/**
 * Check a list of File objects. Returns an error string for the first problem
 * found, or null when every file is acceptable.
 */
export function validateFiles(files) {
  for (const file of files) {
    if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
      return `"${file.name}" is not an accepted file type. Please upload ${ALLOWED_DESCRIPTION}.`;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      return `"${file.name}" is larger than ${MAX_UPLOAD_MB} MB. Please attach a smaller file.`;
    }
  }
  return null;
}
