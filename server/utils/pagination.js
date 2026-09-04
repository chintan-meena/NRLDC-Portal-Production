/**
 * utils/pagination.js — Turn raw ?page/?limit query values into safe bounds.
 *
 * The list endpoints took `page` and `limit` straight from the query string and
 * fed them to LIMIT/OFFSET through parseInt. A non-numeric value became `NaN`
 * and the query threw a 500; a huge value pulled the whole table into memory; a
 * negative value produced a negative OFFSET and another 500. All three are
 * caller-triggerable, so the bounds are enforced here in one place.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * @param {{page?: any, limit?: any}} query
 * @param {{defaultLimit?: number, maxLimit?: number}} [opts]
 * @returns {{page: number, limit: number, offset: number}}
 *   Always a page ≥ 1 and a limit within [1, maxLimit]; a missing or unparseable
 *   value falls back to the default rather than erroring.
 */
function clampPagination(query = {}, opts = {}) {
  const maxLimit = opts.maxLimit || MAX_LIMIT;
  const defaultLimit = opts.defaultLimit || DEFAULT_LIMIT;

  const rawLimit = parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, rawLimit))
    : defaultLimit;

  const rawPage = parseInt(query.page, 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;

  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { clampPagination, DEFAULT_LIMIT, MAX_LIMIT };
