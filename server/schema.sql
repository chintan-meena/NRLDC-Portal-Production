-- NRLDC Schedule Discrepancy Portal — PostgreSQL Schema
-- Run this file to create all tables (idempotent)

-- Users table (roles: ADMIN or USER only)
-- ─── Regions ────────────────────────────────────────────────────────────────
-- The load despatch centres this deployment serves. A region is created by the
-- national administrator and is the organisational namespace everything else
-- hangs off.
--
-- The acronym is the primary key rather than a surrogate integer. It is a
-- natural key that is already the namespace users are named in
-- (<name>@<acronym>), it already appears as a VARCHAR in five tables, and using
-- it means existing rows need no renumbering — an integer id would have meant
-- rewriting every region column in the database for no gain in meaning.
CREATE TABLE IF NOT EXISTS regions (
  acronym VARCHAR(10) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The five Indian RLDCs, so an existing deployment keeps working unchanged.
-- Further regions are created through the portal, not here.
INSERT INTO regions (acronym, name) VALUES
  ('NRLDC',  'Northern Regional Load Despatch Centre'),
  ('ERLDC',  'Eastern Regional Load Despatch Centre'),
  ('WRLDC',  'Western Regional Load Despatch Centre'),
  ('SRLDC',  'Southern Regional Load Despatch Centre'),
  ('NERLDC', 'North Eastern Regional Load Despatch Centre')
ON CONFLICT (acronym) DO NOTHING;

CREATE TABLE IF NOT EXISTS wbes_entities (
  wbes_acronym VARCHAR(50) PRIMARY KEY,
  -- The region that despatches this plant. Acronyms are unique nationally, so
  -- this decides which admin administers it, not which name it may hold.
  region VARCHAR(10) NOT NULL DEFAULT 'NRLDC' REFERENCES regions(acronym) ON UPDATE CASCADE,
  name VARCHAR(200) NOT NULL,
  -- A plant's energy category is a property of the plant itself, not of
  -- whichever user currently holds the acronym. QCA management is permitted
  -- for RE plants only, so this column is what that rule is enforced against.
  energy_category VARCHAR(20) NOT NULL DEFAULT 'RE' CHECK (energy_category IN ('ISGS', 'RE', 'States', 'Traders')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER', 'QCA')),
  -- Which load despatch centre this account belongs to. An ADMIN administers
  -- exactly this region; a USER or QCA is a station within it. A SUPERADMIN
  -- sees every region, and its own value here is only a home label.
  -- NULL for the national administrator, which belongs to no single region.
  region VARCHAR(10) REFERENCES regions(acronym) ON UPDATE CASCADE,
  email VARCHAR(200) NOT NULL,
  email2 VARCHAR(200),
  email3 VARCHAR(200),
  mobile VARCHAR(20),
  password_hash VARCHAR(200) NOT NULL,
  energy_category VARCHAR(20) NOT NULL DEFAULT 'ISGS' CHECK (energy_category IN ('ISGS', 'RE', 'States', 'Traders')),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  preferred_landing VARCHAR(20) DEFAULT 'both',
  bypass_2fa BOOLEAN NOT NULL DEFAULT FALSE,
  can_upload_cycle_data BOOLEAN NOT NULL DEFAULT FALSE,
  wbes_acronym VARCHAR(50) NOT NULL DEFAULT '',
  qca_name VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- QCAs coordinate Renewable Energy plants only.
  CONSTRAINT qca_is_renewable_only CHECK (role <> 'QCA' OR energy_category = 'RE')
);

-- Discrepancies table
CREATE TABLE IF NOT EXISTS discrepancies (
  req_no SERIAL PRIMARY KEY,
  -- Set by the RLDC when rejecting, to mark a filer repeatedly raising the
  -- same thing. Never inferred — see the migration block below.
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_note TEXT NOT NULL DEFAULT '',
  -- Stamped when the record is filed rather than derived from the filer's
  -- account. A user moving between regions must not drag their filing history
  -- with them: the record belongs to the region that despatched it.
  region VARCHAR(10) NOT NULL DEFAULT 'NRLDC',
  request_by VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  correction_for_date DATE NOT NULL,
  days_diff INTEGER NOT NULL DEFAULT 0,
  time_blocks TEXT NOT NULL,
  request_content TEXT NOT NULL,
  discrepancy_type TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Resolved', 'Rejected', 'Returned', 'Awaiting Consent')),
  energy_category VARCHAR(20) NOT NULL DEFAULT 'ISGS',
  files JSONB NOT NULL DEFAULT '[]',
  admin_comment TEXT NOT NULL DEFAULT '',
  admin_files JSONB NOT NULL DEFAULT '[]',
  rejection_reason TEXT NOT NULL DEFAULT '',
  resolved_time TIMESTAMPTZ,
  reraise_count INTEGER NOT NULL DEFAULT 0,
  wbes_acronym VARCHAR(50) REFERENCES wbes_entities(wbes_acronym) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User-Plant Assignments table
CREATE TABLE IF NOT EXISTS user_plant_assignments (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  wbes_acronym VARCHAR(50) NOT NULL REFERENCES wbes_entities(wbes_acronym) ON UPDATE CASCADE ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_plant_period UNIQUE (username, wbes_acronym, from_date)
);

-- Transfer Requests table
CREATE TABLE IF NOT EXISTS transfer_requests (
  id SERIAL PRIMARY KEY,
  wbes_acronym VARCHAR(50) NOT NULL REFERENCES wbes_entities(wbes_acronym) ON UPDATE CASCADE ON DELETE CASCADE,
  from_username VARCHAR(100) REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
  to_username VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  requested_by VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outages table
CREATE TABLE IF NOT EXISTS outages (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
  generator_name VARCHAR(200) NOT NULL,
  unit_number VARCHAR(50) NOT NULL,
  outage_type VARCHAR(50) NOT NULL,
  outage_from TIMESTAMPTZ NOT NULL,
  outage_to TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cycle data uploads table
CREATE TABLE IF NOT EXISTS cycle_data_uploads (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  filename VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System logs table
-- Region is nullable here: an event that belongs to no single region (a
-- failed login for an unknown username, an SMTP failure) is visible only to a
-- super-admin, which NULL expresses better than a guess.
CREATE TABLE IF NOT EXISTS system_logs (
  region VARCHAR(10),
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warn', 'error')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Config table (key-value store)
-- Settings, per region.
--
-- Most settings belong to one region: each despatch centre sets its own filing
-- window, re-raise limits and lockout threshold. A few cannot be regional
-- because there is only one of the underlying thing — one Brevo account, one
-- daily mail allowance — and those live under the reserved region 'GLOBAL',
-- writable only by a super-admin. See GLOBAL_KEYS in routes/config.js.
CREATE TABLE IF NOT EXISTS config (
  key VARCHAR(100) NOT NULL,
  region VARCHAR(10) NOT NULL DEFAULT 'NRLDC',
  value TEXT NOT NULL,
  PRIMARY KEY (key, region)
);

-- Login OTPs. Stored in the database rather than in process memory so that a
-- server restart does not strand everyone mid-login, and so more than one
-- server process can verify a code. The code itself is kept as an HMAC, never
-- in the clear.
-- A code is now tagged with what it is for ('login' or 'reset'), so one user
-- can hold a live login code and a live password-reset code at once. Codes are
-- transient — the longest lives 20 minutes — so a database that predates the
-- column is simply rebuilt rather than migrated, losing nothing but codes that
-- were about to expire anyway.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'login_otps')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'login_otps'
                AND column_name = 'purpose') THEN
    DROP TABLE login_otps;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS login_otps (
  username VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  purpose VARCHAR(20) NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'reset')),
  otp_hash VARCHAR(128) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, purpose)
);

-- Devices a user has already proved themselves on with an OTP.
--
-- The portal's mail allowance is 300 messages a day, so asking for a code at
-- every login is not affordable: 200 users signing in twice a day would need
-- 400. Verifying a code instead registers that browser as trusted for a while
-- (otpTrustDays, default 7), and logins from it skip the code entirely. That
-- turns "an OTP per login" into "an OTP per user per week".
--
-- The trust is bound to a random secret held by that one browser, not to the
-- account, so knowing the password is still not enough to log in from anywhere
-- else. Only the hash is stored, so a database dump does not yield usable
-- device tokens.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  label VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- How much of today's mail allowance has been used.
--
-- Running out of mail silently is the failure that matters: users stop
-- receiving codes and nothing says why. One row per day, counting what was
-- sent and what was held back once the cap was reached, so the admin can see
-- the usage and the log can explain a refusal.
CREATE TABLE IF NOT EXISTS mail_quota (
  day DATE PRIMARY KEY,
  sent INTEGER NOT NULL DEFAULT 0,
  suppressed INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revoked session tokens. Tokens are stateless and signed, so logging out has
-- to record the token id until its natural expiry; the middleware refuses any
-- token listed here. Rows are pruned once they can no longer be presented.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Self-service registration requests. Someone signing up does not become a
-- user: the request waits here until an administrator approves it, and only
-- then is an account created. Their chosen password is carried across as a
-- hash, so nobody — including the admin — ever sees it.
--
-- The row keeps what the applicant actually submitted, unedited. An admin can
-- correct details at the moment of approval (a plant that typed RE when it is
-- ISGS, or misspelt its acronym); the corrections go into the account and are
-- recorded in review_note, so the application and the decision stay separable.
CREATE TABLE IF NOT EXISTS registration_requests (
  id SERIAL PRIMARY KEY,
  region VARCHAR(10) NOT NULL DEFAULT 'NRLDC' REFERENCES regions(acronym) ON UPDATE CASCADE,
  username VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'QCA')),
  email VARCHAR(200) NOT NULL,
  mobile VARCHAR(20),
  password_hash VARCHAR(200) NOT NULL,
  energy_category VARCHAR(20) NOT NULL CHECK (energy_category IN ('ISGS', 'RE', 'States', 'Traders')),
  wbes_acronym VARCHAR(50) NOT NULL,
  qca_name VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The QCA/RE rule applies before the account exists, not just after.
  CONSTRAINT qca_registration_is_renewable CHECK (role <> 'QCA' OR energy_category = 'RE')
);

-- Password reset requests. The portal already emails a temporary password, but
-- that is useless when mail delivery is the thing that is broken — which is
-- exactly when someone is locked out. This is the offline path: the user asks,
-- an administrator approves, and the account goes back to the known default
-- password, which the user is told to change once they are in.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Migrations for pre-existing databases ──────────────────────────────────

-- ─── Flagged filing ────────────────────────────────────────────────────────
-- Marked by the RLDC at the moment of rejection, not inferred by the system.
-- The judgement of whether a filer is repeatedly raising the same thing is the
-- despatch centre's to make; the portal counts what they marked, and reports
-- the proportion against a per-region threshold.
ALTER TABLE discrepancies ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE discrepancies ADD COLUMN IF NOT EXISTS flag_note TEXT NOT NULL DEFAULT '';

-- The tracker counts marked rejections per filer over a rolling window.
CREATE INDEX IF NOT EXISTS idx_disc_flagged
  ON discrepancies (region, flagged, resolved_time DESC) WHERE flagged;

-- ─── The national role is not a region ──────────────────────────────────────
-- SUPERADMIN sits above the regions, so it belongs to none of them. Its region
-- is NULL, and the constraint below makes that the only valid shape: a
-- national account cannot carry a region, and every other account must.
--
-- This was previously conflated — the NRLDC administrator had been promoted to
-- SUPERADMIN, which made one region's admin silently national.
ALTER TABLE users ALTER COLUMN region DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'national_role_has_no_region') THEN
    ALTER TABLE users ADD CONSTRAINT national_role_has_no_region CHECK (
      (role = 'SUPERADMIN' AND region IS NULL) OR
      (role <> 'SUPERADMIN' AND region IS NOT NULL)
    ) NOT VALID;
  END IF;
END $$;

-- ─── Regions become a table ─────────────────────────────────────────────────
-- Regions used to be a CHECK constraint listing five fixed values, so adding
-- one meant a schema change. They are rows now, created through the portal.
--
-- Every step below is additive and safe to re-run. The CHECK constraints are
-- replaced by foreign keys, which say the same thing but against live data.

CREATE TABLE IF NOT EXISTS regions (
  acronym VARCHAR(10) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO regions (acronym, name) VALUES
  ('NRLDC',  'Northern Regional Load Despatch Centre'),
  ('ERLDC',  'Eastern Regional Load Despatch Centre'),
  ('WRLDC',  'Western Regional Load Despatch Centre'),
  ('SRLDC',  'Southern Regional Load Despatch Centre'),
  ('NERLDC', 'North Eastern Regional Load Despatch Centre')
ON CONFLICT (acronym) DO NOTHING;

-- Any region already referenced by data but missing from the table is adopted
-- rather than rejected, so a deployment that added one by hand still migrates.
INSERT INTO regions (acronym, name)
SELECT DISTINCT region, region || ' Regional Load Despatch Centre'
  FROM users WHERE region IS NOT NULL
ON CONFLICT (acronym) DO NOTHING;

-- Discrepancies gain their own region, backfilled from whoever filed them.
ALTER TABLE discrepancies ADD COLUMN IF NOT EXISTS region VARCHAR(10);
UPDATE discrepancies d
   SET region = u.region
  FROM users u
 WHERE d.request_by = u.username AND d.region IS DISTINCT FROM u.region;
UPDATE discrepancies SET region = 'NRLDC' WHERE region IS NULL;
ALTER TABLE discrepancies ALTER COLUMN region SET NOT NULL;
ALTER TABLE discrepancies ALTER COLUMN region SET DEFAULT 'NRLDC';

-- Swap the fixed CHECK constraints for foreign keys.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE contype = 'c'
       AND conrelid IN ('users'::regclass, 'wbes_entities'::regclass, 'registration_requests'::regclass)
       AND pg_get_constraintdef(oid) LIKE '%NERLDC%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
      (SELECT conrelid::regclass FROM pg_constraint WHERE conname = c LIMIT 1), c);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_region_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_region_fkey
      FOREIGN KEY (region) REFERENCES regions(acronym) ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wbes_entities_region_fkey') THEN
    ALTER TABLE wbes_entities ADD CONSTRAINT wbes_entities_region_fkey
      FOREIGN KEY (region) REFERENCES regions(acronym) ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_requests_region_fkey') THEN
    ALTER TABLE registration_requests ADD CONSTRAINT registration_requests_region_fkey
      FOREIGN KEY (region) REFERENCES regions(acronym) ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discrepancies_region_fkey') THEN
    ALTER TABLE discrepancies ADD CONSTRAINT discrepancies_region_fkey
      FOREIGN KEY (region) REFERENCES regions(acronym) ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_disc_region ON discrepancies (region);

-- ─── Regions ────────────────────────────────────────────────────────────────
-- Everything that existed before regions belongs to NRLDC, which is what the
-- defaults below say. Nothing here loses data: each step is additive, and the
-- backfill names the region every existing row already implicitly had.

ALTER TABLE users            ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'NRLDC';
ALTER TABLE wbes_entities    ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'NRLDC';
ALTER TABLE system_logs      ADD COLUMN IF NOT EXISTS region VARCHAR(10);
ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'NRLDC';

-- The fixed-list CHECKs that used to live here are gone: regions are rows now,
-- and the foreign keys added above enforce the same thing against live data.
-- Re-adding them would undo that and make a sixth region impossible.
DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_region_check;
  ALTER TABLE wbes_entities DROP CONSTRAINT IF EXISTS wbes_entities_region_check;
  ALTER TABLE registration_requests DROP CONSTRAINT IF EXISTS registration_requests_region_check;
END $$;

-- SUPERADMIN did not exist before, so the role constraint has to be replaced
-- rather than added to.
DO $$
DECLARE
  con text;
BEGIN
  SELECT conname INTO con FROM pg_constraint
   WHERE conrelid = 'users'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%role%ADMIN%'
     AND pg_get_constraintdef(oid) NOT LIKE '%SUPERADMIN%'
   LIMIT 1;
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', con);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check_v2') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check_v2
      CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER', 'QCA'));
  END IF;
END $$;

-- A plant's region follows its registered user where one exists, so an
-- existing multi-region import stays consistent.
UPDATE wbes_entities w
   SET region = u.region
  FROM users u
 WHERE UPPER(u.wbes_acronym) = UPPER(w.wbes_acronym)
   AND w.region IS DISTINCT FROM u.region;

-- ─── Settings become per-region ─────────────────────────────────────────────
-- The config table was keyed on `key` alone. It gains a region, the handful of
-- settings that cannot be regional move to the reserved 'GLOBAL' region, and
-- the primary key widens to match.
ALTER TABLE config ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'NRLDC';

UPDATE config
   SET region = 'GLOBAL'
 WHERE region <> 'GLOBAL'
   AND (key LIKE 'smtp%' OR key IN ('mailDailyCap', 'otpTrustDays', 'resetOtpMinutes'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'config'::regclass AND contype = 'p'
       AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE config DROP CONSTRAINT config_pkey;
    ALTER TABLE config ADD PRIMARY KEY (key, region);
  END IF;
END $$;

-- Add the plant energy category, backfilling from the plant's registered user
-- where one exists (plants with no user default to RE, matching prior behaviour).
ALTER TABLE wbes_entities
  ADD COLUMN IF NOT EXISTS energy_category VARCHAR(20) NOT NULL DEFAULT 'RE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wbes_entities_energy_category_check'
  ) THEN
    ALTER TABLE wbes_entities
      ADD CONSTRAINT wbes_entities_energy_category_check
      CHECK (energy_category IN ('ISGS', 'RE', 'States', 'Traders'));
  END IF;
END $$;

UPDATE wbes_entities w
   SET energy_category = u.energy_category
  FROM users u
 WHERE UPPER(u.wbes_acronym) = UPPER(w.wbes_acronym)
   AND u.role = 'USER'
   AND w.energy_category <> u.energy_category;

-- Any QCA account sitting on a non-RE category predates the rule; correct it.
UPDATE users SET energy_category = 'RE' WHERE role = 'QCA' AND energy_category <> 'RE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'qca_is_renewable_only'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT qca_is_renewable_only
      CHECK (role <> 'QCA' OR energy_category = 'RE');
  END IF;
END $$;

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Every column below is one the portal filters, sorts or joins on. Without
-- these, each dashboard load is a sequential scan of the whole table.

-- Discrepancy list: filtered by date range, status, category and owner, and
-- always ordered by req_no.
CREATE INDEX IF NOT EXISTS idx_disc_correction_date ON discrepancies (correction_for_date DESC);
CREATE INDEX IF NOT EXISTS idx_disc_status          ON discrepancies (status);
CREATE INDEX IF NOT EXISTS idx_disc_request_by      ON discrepancies (LOWER(request_by));
CREATE INDEX IF NOT EXISTS idx_disc_wbes            ON discrepancies (wbes_acronym);
CREATE INDEX IF NOT EXISTS idx_disc_category        ON discrepancies (energy_category);
CREATE INDEX IF NOT EXISTS idx_disc_request_date    ON discrepancies (request_date DESC);
-- The common admin view: a date window narrowed by status.
CREATE INDEX IF NOT EXISTS idx_disc_date_status     ON discrepancies (correction_for_date DESC, status);

-- Plant assignments are looked up by plant and by holder, both date-bounded.
CREATE INDEX IF NOT EXISTS idx_upa_acronym  ON user_plant_assignments (wbes_acronym, from_date DESC);
CREATE INDEX IF NOT EXISTS idx_upa_username ON user_plant_assignments (LOWER(username), from_date DESC);

-- Transfer requests: the admin queue plus each user's own requests.
CREATE INDEX IF NOT EXISTS idx_tr_status   ON transfer_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tr_parties  ON transfer_requests (LOWER(requested_by), LOWER(to_username));

-- Outages and cycle uploads are listed per user and per date window.
CREATE INDEX IF NOT EXISTS idx_outages_user  ON outages (username, outage_from DESC);
CREATE INDEX IF NOT EXISTS idx_outages_from  ON outages (outage_from DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_user    ON cycle_data_uploads (username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_range   ON cycle_data_uploads (start_date, end_date);

-- Users are looked up case-insensitively at every login, and by plant.
CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_wbes           ON users (UPPER(wbes_acronym));
CREATE INDEX IF NOT EXISTS idx_users_role_category  ON users (role, energy_category);

-- Registration queue: the admin list, plus the guards that stop two people
-- claiming the same username or plant while a request is still pending.
-- Partial, so a rejected request does not block a corrected re-application.
CREATE INDEX IF NOT EXISTS idx_regreq_status ON registration_requests (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_regreq_pending_username
  ON registration_requests (LOWER(username)) WHERE status = 'Pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_regreq_pending_acronym
  ON registration_requests (UPPER(wbes_acronym)) WHERE status = 'Pending';

-- Password reset queue. The unique index is partial so one user cannot pile up
-- pending requests, while still being able to ask again after a decision.
CREATE INDEX IF NOT EXISTS idx_pwreset_status ON password_reset_requests (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pwreset_pending_username
  ON password_reset_requests (LOWER(username)) WHERE status = 'Pending';

-- Log tail and token/OTP expiry sweeps.
CREATE INDEX IF NOT EXISTS idx_logs_created   ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revoked_expiry ON revoked_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_expiry     ON login_otps (expires_at);
CREATE INDEX IF NOT EXISTS idx_device_user   ON trusted_devices (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_device_expiry ON trusted_devices (expires_at);

-- Region scoping. Every admin listing filters on one of these.
CREATE INDEX IF NOT EXISTS idx_users_region     ON users (region);
CREATE INDEX IF NOT EXISTS idx_entities_region  ON wbes_entities (region);
CREATE INDEX IF NOT EXISTS idx_logs_region      ON system_logs (region, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_regreq_region    ON registration_requests (region, status);

-- Substring search across the free-text discrepancy fields. A trigram index is
-- what makes "... LIKE '%text%'" fast; it needs the pg_trgm extension, which
-- requires elevated rights. If that is unavailable the search still works, just
-- with a scan, so the failure is deliberately non-fatal.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_disc_content_trgm ON discrepancies USING gin (request_content gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_disc_type_trgm    ON discrepancies USING gin (discrepancy_type gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable (%) — text search will work without a trigram index.', SQLERRM;
END $$;

-- ─── Default settings ───────────────────────────────────────────────────────

-- Regional settings: one row per region, so each despatch centre can diverge.
-- The cross join means adding a region to the list below is all it takes to
-- give it a full set of defaults.
INSERT INTO config (key, region, value)
SELECT d.key, r.region, d.value
  FROM (VALUES
    ('maxDays', '5'),
    ('lockoutAttempts', '3'),
    ('allowExtended', 'true'),
    ('extendedMaxDays', '15'),
    ('reraiseWindow', '45'),
    ('reraiseLimit', '2'),
    ('outage_ISGS', 'true'),
    ('outage_RE', 'true'),
    ('outage_States', 'false'),
    -- Master two-factor switch for this region. When 'false', OTP is skipped
    -- and login completes on the password alone. An operational escape hatch
    -- for when mail delivery breaks; see also each user's bypass_2fa flag.
    ('require2FA', 'true'),
    -- Cycle Data upload/download. Switch off to hide the feature entirely
    -- without deleting anything already uploaded.
    ('feature_cycle_data', 'true'),
    -- The day of the *following* month after which a correction period closes
    -- for good. 15 means "the 15th of the month after". Absolute: nothing may
    -- be filed for that period afterwards, whatever the day count allows.
    ('postFactoCutoffDay', '15'),
    -- What share of a filer's discrepancies being marked flagged by the RLDC
    -- flags them in the tracker. 40 = 40%.
    ('flaggedThresholdPercent', '40')
  ) AS d(key, value)
  CROSS JOIN (VALUES ('NRLDC'), ('ERLDC'), ('WRLDC'), ('SRLDC'), ('NERLDC')) AS r(region)
ON CONFLICT (key, region) DO NOTHING;

-- Global settings: there is one mail account and one daily allowance, so these
-- cannot be regional. Only a super-admin may change them.
INSERT INTO config (key, region, value) VALUES
  -- How long a browser stays trusted after its user verifies an OTP. The
  -- single biggest control on mail usage: at 7 days, 200 users cost about 29
  -- codes a day instead of one per login. Set to '0' to demand one every time.
  ('otpTrustDays', 'GLOBAL', '7'),
  -- How long an emailed password-reset code stays valid. No second code is
  -- sent while one is live, so a user hammering "forgot password" cannot
  -- drain the day's allowance.
  ('resetOtpMinutes', 'GLOBAL', '20'),
  -- Messages the portal will send in a day before it stops. Deliberately below
  -- the provider's real limit, so the portal refuses on its own terms with a
  -- log entry rather than having the provider reject mail silently.
  ('mailDailyCap', 'GLOBAL', '280')
ON CONFLICT (key, region) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Traders, and the inter-regional consent workflow.
--
-- A trader buys power in one region and sells it in another, so a discrepancy
-- they raise is not one region's business alone: the region that has to change
-- a schedule is not always the region that can confirm the trade happened.
-- That is what the consent step is for, and it is the first thing in this
-- portal that two regions touch.
--
-- The columns below are all nullable and all unused by an ordinary filing. A
-- discrepancy raised by a station carries NULL in every one of them and moves
-- through exactly the states it always did.
-- ─────────────────────────────────────────────────────────────────────────────

-- Existing databases: widen the category constraints in place. Dropping and
-- re-adding is the only way to change a CHECK, and it is safe here because the
-- new set is a superset of the old — no existing row can fail it.
DO $$
DECLARE
  t TEXT;
  c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'wbes_entities', 'registration_requests'] LOOP
    c := t || '_energy_category_check';
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c);
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (energy_category IN (''ISGS'', ''RE'', ''States'', ''Traders''))',
      t, c);
  END LOOP;
END $$;

-- The consent state. 'Awaiting Consent' is a discrepancy sitting with the
-- seller's region, which has not yet said whether the trade is theirs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discrepancies_status_check') THEN
    ALTER TABLE discrepancies DROP CONSTRAINT discrepancies_status_check;
  END IF;
  ALTER TABLE discrepancies ADD CONSTRAINT discrepancies_status_check
    CHECK (status IN ('Pending', 'Resolved', 'Rejected', 'Returned', 'Awaiting Consent'));
END $$;

-- Who traded with whom. Free of foreign keys on purpose: a counterpart region
-- that does not use this portal still has to be nameable, and a region row may
-- not exist for it. The application validates against the region registry and
-- falls back to the five RLDC codes, which are fixed by the grid, not by us.
ALTER TABLE discrepancies
  ADD COLUMN IF NOT EXISTS buyer_region         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS seller_region        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS buyer_wbes_acronym   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS seller_wbes_acronym  VARCHAR(50);

-- The consent trail. Kept separate from `status` so it survives the ticket
-- moving on: once the seller has consented the status becomes 'Pending', and
-- without these columns there would be nothing left to show that consent was
-- ever given, by whom, or on what evidence.
--
--   consent_state  NULL | 'Awaiting' | 'Consented' | 'Refused'
--   consent_mode   'portal'  — the seller's own administrator answered here
--                  'offline' — the buyer recorded consent obtained elsewhere
ALTER TABLE discrepancies
  ADD COLUMN IF NOT EXISTS consent_state   VARCHAR(12),
  ADD COLUMN IF NOT EXISTS consent_mode    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS consent_by      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_remark  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consent_files   JSONB NOT NULL DEFAULT '[]';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discrepancies_consent_state_check') THEN
    ALTER TABLE discrepancies ADD CONSTRAINT discrepancies_consent_state_check
      CHECK (consent_state IS NULL OR consent_state IN ('Awaiting', 'Consented', 'Refused'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discrepancies_consent_mode_check') THEN
    ALTER TABLE discrepancies ADD CONSTRAINT discrepancies_consent_mode_check
      CHECK (consent_mode IS NULL OR consent_mode IN ('portal', 'offline'));
  END IF;
  -- Offline consent without a remark is an unexplained override. The whole
  -- point of the offline path is that it leaves a record of who agreed to
  -- what, so an empty one is refused by the database and not merely by a form.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discrepancies_offline_consent_remark_check') THEN
    ALTER TABLE discrepancies ADD CONSTRAINT discrepancies_offline_consent_remark_check
      CHECK (consent_mode <> 'offline' OR length(trim(consent_remark)) > 0);
  END IF;
END $$;

-- Both regions of a trade list the ticket, so both ends are indexed.
CREATE INDEX IF NOT EXISTS idx_disc_buyer_region  ON discrepancies (buyer_region)  WHERE buyer_region IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_disc_seller_region ON discrepancies (seller_region) WHERE seller_region IS NOT NULL;

-- The national administrator despatches nothing itself, but it is an account
-- in the WBES sense and NLDC is its acronym.
INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category)
SELECT 'NLDC', r.acronym, 'National Load Despatch Centre', 'ISGS'
  FROM regions r WHERE r.acronym = 'NRLDC'
ON CONFLICT (wbes_acronym) DO NOTHING;

UPDATE users SET wbes_acronym = 'NLDC'
 WHERE role = 'SUPERADMIN' AND COALESCE(NULLIF(TRIM(wbes_acronym), ''), '') = '';
