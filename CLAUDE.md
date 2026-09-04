# CLAUDE.md — orientation for this repo

NRLDC Schedule Discrepancy Portal: a production, multi-region portal where power
stations file schedule discrepancies against an RLDC, admins process them, and
QCAs coordinate renewable-plant ownership and transfers. Served single-origin in
production (one Express process serves both the API and the built React app).

## Stack & layout

- **Frontend** — React 19 + Vite 8, in `src/`. No router: the active screen is
  tab state in `src/App.jsx`. The service layer is `src/services/api.js` (every
  request carries a bearer token). Two screens dominate: `UserDashboard.jsx` and
  `AdminDashboard.jsx` (~2k lines each — earmarked for splitting).
- **Backend** — Express 4 + PostgreSQL (`pg`), in `server/`. CommonJS. Routes in
  `server/routes/`, shared logic in `server/utils/`, auth in `server/middleware/`
  and `server/auth/`. `server/index.js` is the entry point.
- **Schema** — one idempotent `server/schema.sql` (CREATE ... IF NOT EXISTS,
  guarded `DO $$` migration blocks). `migrate.js` re-applies it without dropping
  data; `seed.js`/`init_fresh.js` DROP everything (dev only).

## Running it

```bash
npm install && (cd server && npm install)   # deps for both projects
npm run dev:all          # Vite + backend together (dev)
npm run build            # build the frontend into dist/
npm start                # production: one process serves API + dist/
```

Backend config is `server/.env` (git-ignored; see `server/.env.example`). In
production, `NODE_ENV=production` turns on CSP/HSTS, makes a missing
`SESSION_SECRET` fatal, and makes the destructive seeders refuse to run.
Deployment runbook: `DEPLOYMENT.md`. Ops commands: `./nrldc.sh` (status, migrate,
harden, regions, mail, logs).

## Tests & lint

```bash
npm run lint             # lints src/ AND server/ (root eslint.config.js)
npm test                 # backend unit tests (node:test, no database)
npm run test:integration # backend integration tests (needs PostgreSQL)
npm run test:all         # both
```

- Tests live in `server/test/unit/` (pure functions, no DB) and
  `server/test/integration/` (DB-backed). Built on Node's `node:test` — no test
  framework dependency.
- Integration tests use `server/test/helpers/testdb.js`, which **only ever
  touches a database whose name ends in `_test`** (default `nrldc_test`, override
  with `PGDATABASE_TEST`). It creates/wipes that DB from `schema.sql` each run, so
  it can never touch the real `nrldc_portal`.
- CI (`.github/workflows/ci.yml`) runs lint + build + unit + integration on every
  PR, with a Postgres service for the integration layer.

## Invariants worth preserving

These are load-bearing; a change that breaks one is a regression, not a cleanup.

- **Identity comes from the token, never the body.** Routes read the caller from
  `req.auth` (set by `middleware/auth.js`); no endpoint trusts a `username` in a
  body or query string.
- **Region isolation.** An ADMIN sees and writes only its own region. A
  SUPERADMIN (national admin, `region IS NULL`) can create an admin elsewhere and
  owns GLOBAL settings, but has no extra per-region visibility. Cross-region
  writes are rejected — see the plant-region guards in `routes/users.js`.
- **QCA ⇒ RE.** A QCA account must be energy_category `RE` (DB constraint
  `qca_is_renewable_only`). QCA management is for RE plants only.
- **Transfer safety.** `utils/transferConflicts.js` refuses a transfer whose
  effective date is on or before (`>=`) a date the outgoing QCA already filed
  for; otherwise history would be corrupted. This rule is covered by
  `test/integration/transferConflicts.test.js` — keep it green.
- **DATE columns are plain `YYYY-MM-DD` strings** (`db.js` sets a type parser for
  oid 1082). Never round-trip a schedule date through `toISOString()` — it shifts
  a day at IST.
- **Shared client/server utils are hand-mirrored** (`src/utils/*` ↔
  `server/utils/*`: timeBlocks, financialYear, usernames, wbesTypes, trade,
  discrepancyTypes, filenames, password). Change both, or they drift. Unit tests
  cover the server copies.
- **SESSION_SECRET must be identical across every process** behind a load
  balancer, or tokens issued by one process are rejected by another.
- **Two kinds of account lock, told apart by `locked_at`.** A failed-attempt
  lockout sets `locked_at` and expires on its own after `lockoutMinutes`
  (default 60); a deliberate admin lock leaves `locked_at` NULL and is permanent.
  `auth/lockout.js` is the one place that rule lives — never auto-clear a lock
  whose `locked_at` is NULL. Login errors are deliberately generic (no "account
  exists" / attempt-count leak); keep them that way.
- **Settings are cached in-process** (`utils/settings.js`, ~30s TTL) and
  invalidated by `setSetting`. Any code that writes a `config` row by another
  path must call `invalidateSetting`/`clearSettingsCache` or reads stay stale
  until the TTL lapses.

## Out of scope by decision

- **Monitoring/observability** — not being built. The baseline (`system_logs`,
  `/api/health`, `nrldc.sh logs`) stays.
- **Simulation** (`routes/simulation.js`, `utils/simulation.js`) — left untouched;
  superadmin-only, read-only, non-persisting. Nothing in the live filing/transfer
  path depends on it.
