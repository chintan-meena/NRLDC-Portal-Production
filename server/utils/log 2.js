/**
 * utils/log.js — Writing to the system log.
 *
 * There were seven copies of this function, one per route file, and they had
 * already begun to drift. One copy means one place to change when the log
 * grows a column — which is what happened when it gained a region.
 *
 * The region is taken from the current request rather than passed in, so the
 * 71 existing call sites did not have to change. An entry written outside a
 * request, or before the caller is known, has no region: those are visible
 * only to a national administrator, which is the right home for an event that
 * belongs to no one region — a failed login for an unknown username, say, or
 * an SMTP failure.
 */

const pool = require('../db');
const { currentRegion } = require('./requestContext');

/**
 * Record an event. Never throws: logging must not be able to fail the action
 * it is describing.
 *
 * @param {string} type    'info' | 'success' | 'warn' | 'error'
 * @param {string} message what happened, in plain words
 * @param {string} [region] override, for the rare caller that knows better
 *                          than the request context
 */
async function logEvent(type, message, region = undefined) {
  try {
    await pool.query(
      'INSERT INTO system_logs (type, message, region) VALUES ($1, $2, $3)',
      [type, message, region === undefined ? currentRegion() : region]
    );
  } catch (err) {
    console.error('[LOG]', err.message);
  }
}

module.exports = { logEvent };
