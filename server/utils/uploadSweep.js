/**
 * utils/uploadSweep.js — Remove uploaded files nothing references any more.
 *
 * Files land in server/upload/ the moment they are uploaded, before the
 * discrepancy (or cycle-data row) that would reference them is saved. If the
 * user abandons the form, the file stays on disk forever. Over time that is
 * unbounded growth, and any authenticated user can drive it.
 *
 * This sweep deletes a file only when BOTH are true:
 *   • nothing in the database references it (no discrepancy files / admin_files /
 *     consent_files entry, no cycle-data row), and
 *   • it is older than a grace period — long enough that a file uploaded during
 *     a slow multi-step filing is never swept out from under it.
 *
 * The grace period is deliberately generous (days, not hours): deleting a file
 * a user is about to attach is far worse than keeping an orphan a little longer.
 */

const fs = require('fs');
const path = require('path');
const { logEvent } = require('./log');

/**
 * Which of `files` are safe to delete: not referenced, and last modified before
 * `cutoffMs`. Pure, so it is unit-tested without touching the disk.
 *
 * @param {{name: string, mtimeMs: number}[]} files   candidate files on disk
 * @param {Set<string>} referenced                    stored names still in use
 * @param {number} cutoffMs                            delete only if mtime < this
 * @returns {string[]} names to delete
 */
function selectOrphans(files, referenced, cutoffMs) {
  return files
    .filter(f => !referenced.has(f.name) && f.mtimeMs < cutoffMs)
    .map(f => f.name);
}

/**
 * Collect every stored filename the database still points at.
 * Discrepancy attachments live in three JSONB arrays; cycle-data uploads in a
 * plain column.
 */
async function referencedFilenames(db) {
  const referenced = new Set();

  const disc = await db.query(`
    SELECT jsonb_array_elements_text(files)         AS name FROM discrepancies WHERE jsonb_typeof(files) = 'array'
    UNION SELECT jsonb_array_elements_text(admin_files)   FROM discrepancies WHERE jsonb_typeof(admin_files) = 'array'
    UNION SELECT jsonb_array_elements_text(consent_files) FROM discrepancies WHERE jsonb_typeof(consent_files) = 'array'
    UNION SELECT filename FROM cycle_data_uploads
  `);
  for (const row of disc.rows) {
    if (row.name) referenced.add(path.basename(String(row.name)));
  }
  return referenced;
}

/**
 * Run one sweep of `uploadDir`, deleting orphaned files older than `graceDays`.
 * Never throws — a failed sweep must not take the server down.
 *
 * @returns {Promise<{deleted: number, scanned: number}>}
 */
async function sweepOrphanUploads(db, uploadDir, graceDays = 5) {
  try {
    if (!fs.existsSync(uploadDir)) return { deleted: 0, scanned: 0 };

    const referenced = await referencedFilenames(db);
    const cutoffMs = Date.now() - graceDays * 24 * 60 * 60 * 1000;

    const entries = await fs.promises.readdir(uploadDir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const stat = await fs.promises.stat(path.join(uploadDir, e.name));
        files.push({ name: e.name, mtimeMs: stat.mtimeMs });
      } catch { /* vanished between readdir and stat — ignore */ }
    }

    const orphans = selectOrphans(files, referenced, cutoffMs);
    let deleted = 0;
    for (const name of orphans) {
      try {
        await fs.promises.unlink(path.join(uploadDir, name));
        deleted++;
      } catch { /* already gone */ }
    }

    if (deleted > 0) {
      await logEvent('info', `[UPLOAD SWEEP] Removed ${deleted} orphaned upload(s) older than ${graceDays} day(s).`);
    }
    return { deleted, scanned: files.length };
  } catch (err) {
    console.error('[UPLOAD SWEEP]', err.message);
    return { deleted: 0, scanned: 0 };
  }
}

module.exports = { selectOrphans, referencedFilenames, sweepOrphanUploads };
