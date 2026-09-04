/**
 * Integration tests for utils/uploadSweep.js against a real database and disk.
 *
 * Proves the two halves that the pure unit test cannot: that referenced
 * filenames are correctly gathered from the discrepancy JSONB arrays and the
 * cycle-data column, and that the end-to-end sweep deletes only true orphans.
 *
 * Needs PostgreSQL. Run with `npm run test:integration`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupTestDb, teardownTestDb } = require('../helpers/testdb');
const { referencedFilenames, sweepOrphanUploads } = require('../../utils/uploadSweep');

let pool;
let dir;

const DAY = 24 * 60 * 60 * 1000;

function writeFileAged(name, ageDays) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, 'x');
  const when = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(p, when, when);
}

before(async () => {
  pool = await setupTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrldc-sweep-'));

  // A filer and a discrepancy that references one attachment.
  await pool.query(
    `INSERT INTO users (username, name, role, region, email, password_hash, energy_category, wbes_acronym)
     VALUES ('u@nrldc','U','USER','NRLDC','u@x','h','ISGS','')`
  );
  await pool.query(
    `INSERT INTO discrepancies (region, request_by, correction_for_date, time_blocks, request_content, energy_category, files)
     VALUES ('NRLDC','u@nrldc','2026-06-01','1','x','ISGS', '["referenced.xlsx"]'::jsonb)`
  );
  // A cycle-data row references another.
  await pool.query(
    `INSERT INTO cycle_data_uploads (username, start_date, end_date, filename)
     VALUES ('u@nrldc','2026-06-01','2026-06-02','cycle-ref.xlsx')`
  );
});

after(async () => {
  await teardownTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('referencedFilenames gathers names from discrepancies and cycle uploads', async () => {
  const refs = await referencedFilenames(pool);
  assert.equal(refs.has('referenced.xlsx'), true);
  assert.equal(refs.has('cycle-ref.xlsx'), true);
  assert.equal(refs.has('never-uploaded.xlsx'), false);
});

test('the sweep deletes old orphans but keeps referenced and recent files', async () => {
  writeFileAged('referenced.xlsx', 30);  // referenced → keep despite age
  writeFileAged('cycle-ref.xlsx', 30);   // referenced → keep
  writeFileAged('old-orphan.xlsx', 10);  // unreferenced + old → delete
  writeFileAged('recent-orphan.xlsx', 1); // unreferenced but recent → keep

  const result = await sweepOrphanUploads(pool, dir, 5);
  assert.equal(result.deleted, 1);

  assert.equal(fs.existsSync(path.join(dir, 'referenced.xlsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'cycle-ref.xlsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'recent-orphan.xlsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'old-orphan.xlsx')), false);
});

test('a sweep of a non-existent directory is a no-op, not a crash', async () => {
  const result = await sweepOrphanUploads(pool, path.join(dir, 'does-not-exist'), 5);
  assert.deepEqual(result, { deleted: 0, scanned: 0 });
});
