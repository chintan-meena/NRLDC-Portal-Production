/**
 * utils/requestContext.js — Who is making the current request, without passing it around.
 *
 * The system log is per region, so every entry needs to know which region it
 * belongs to. Threading that through 71 logEvent() calls across seven files
 * would be a lot of churn for one field, and the failure of missing one is
 * quiet: the entry simply becomes invisible to the admin who should see it.
 *
 * Node's AsyncLocalStorage carries it instead. A middleware opens a store for
 * each request, and anything running inside that request — however deep — can
 * read the caller's region without being handed it.
 *
 * This is deliberately used for *annotation* only. Nothing reads the store to
 * decide what a caller may do: authorisation always comes from req.auth, which
 * is explicit and cannot be inherited by accident.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Express middleware. Mount it after authentication so req.auth is populated;
 * on public routes the store simply starts empty.
 */
function requestContext(req, res, next) {
  storage.run(
    { region: req.auth?.region ?? null, username: req.auth?.username ?? null },
    () => next()
  );
}

/**
 * Name the region for the rest of this request.
 *
 * Used by the login routes, which only learn whose region it is after looking
 * the account up — by which point the store already exists.
 */
function setContextRegion(region) {
  const store = storage.getStore();
  if (store) store.region = region ?? null;
}

/** The current request's region, or null outside a request or before login. */
function currentRegion() {
  return storage.getStore()?.region ?? null;
}

/** The current request's username, or null. */
function currentUsername() {
  return storage.getStore()?.username ?? null;
}

module.exports = { requestContext, setContextRegion, currentRegion, currentUsername };
