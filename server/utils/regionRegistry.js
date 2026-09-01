/**
 * utils/regionRegistry.js — The list of regions, cached.
 *
 * Regions used to be a constant array. They are rows now, created by the
 * national administrator, so the list has to come from the database — but it is
 * consulted on nearly every request and changes perhaps a handful of times in
 * the life of the deployment. So it is read once at startup and refreshed
 * whenever a region is created or changed.
 *
 * The cache is a convenience for validation and for building menus. It is never
 * the thing that enforces anything: the foreign keys on users.region,
 * wbes_entities.region, registration_requests.region and discrepancies.region
 * are what actually make an unknown region impossible, and those hold whether
 * or not this cache is stale.
 */

const pool = require('../db');

let acronyms = new Set();
let rows = [];
let loaded = false;

/** Re-read the regions table. Called at startup and after any change. */
async function refresh() {
  try {
    const res = await pool.query(
      'SELECT acronym, name, status, created_by, created_at FROM regions ORDER BY acronym'
    );
    rows = res.rows;
    acronyms = new Set(rows.map(r => r.acronym));
    loaded = true;
  } catch (err) {
    // A failure here must not take the server down: the foreign keys still
    // enforce correctness, and the cache refills on the next change.
    console.error('[REGIONS] Could not refresh the region list:', err.message);
  }
  return rows;
}

/** Every region, cached. */
function allRegions() {
  return rows;
}

/** Just the acronyms, for menus and validation. */
function regionCodes() {
  return rows.map(r => r.acronym);
}

/**
 * Is this a region that exists?
 *
 * Returns false before the first load rather than true, so a request arriving
 * during startup is refused rather than admitted on an empty cache.
 */
function isValidRegion(acronym) {
  if (!acronym) return false;
  return acronyms.has(String(acronym).toUpperCase());
}

/** Whether the cache has been populated at least once. */
function isLoaded() {
  return loaded;
}

/**
 * Authoritative check, straight from the table.
 *
 * Used where being wrong matters more than being fast — creating an account in
 * a region, say — so a cache that has not caught up cannot admit or refuse the
 * wrong thing.
 */
async function regionExists(acronym) {
  if (!acronym) return false;
  const res = await pool.query(
    'SELECT 1 FROM regions WHERE acronym = $1 AND status = $2 LIMIT 1',
    [String(acronym).toUpperCase(), 'Active']
  );
  return res.rows.length > 0;
}

module.exports = { refresh, allRegions, regionCodes, isValidRegion, isLoaded, regionExists };
