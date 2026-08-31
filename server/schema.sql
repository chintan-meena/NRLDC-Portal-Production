-- NRLDC Schedule Discrepancy Portal — PostgreSQL Schema
-- Run this file to create all tables (idempotent)

-- Users table (roles: ADMIN or USER only)
CREATE TABLE IF NOT EXISTS wbes_entities (
  wbes_acronym VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  -- A plant's energy category is a property of the plant itself, not of
  -- whichever user currently holds the acronym. QCA management is permitted
  -- for RE plants only, so this column is what that rule is enforced against.
  energy_category VARCHAR(20) NOT NULL DEFAULT 'RE' CHECK (energy_category IN ('ISGS', 'RE', 'States')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'USER', 'QCA')),
  email VARCHAR(200) NOT NULL,
  email2 VARCHAR(200),
  email3 VARCHAR(200),
  mobile VARCHAR(20),
  password_hash VARCHAR(200) NOT NULL,
  energy_category VARCHAR(20) NOT NULL DEFAULT 'ISGS' CHECK (energy_category IN ('ISGS', 'RE', 'States')),
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
  request_by VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  correction_for_date DATE NOT NULL,
  days_diff INTEGER NOT NULL DEFAULT 0,
  time_blocks TEXT NOT NULL,
  request_content TEXT NOT NULL,
  discrepancy_type TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Resolved', 'Rejected', 'Returned')),
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
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warn', 'error')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Config table (key-value store)
CREATE TABLE IF NOT EXISTS config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL
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
  username VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'QCA')),
  email VARCHAR(200) NOT NULL,
  mobile VARCHAR(20),
  password_hash VARCHAR(200) NOT NULL,
  energy_category VARCHAR(20) NOT NULL CHECK (energy_category IN ('ISGS', 'RE', 'States')),
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
      CHECK (energy_category IN ('ISGS', 'RE', 'States'));
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

-- Default config values (upsert)
INSERT INTO config (key, value) VALUES
  ('maxDays', '5'),
  ('lockoutAttempts', '3'),
  ('allowExtended', 'true'),
  ('extendedMaxDays', '15'),
  ('reraiseWindow', '45'),
  ('reraiseLimit', '2'),
  ('outage_ISGS', 'true'),
  ('outage_RE', 'true'),
  ('outage_States', 'false'),
  -- Master two-factor switch. When 'false', OTP is skipped for everyone and
  -- login completes on the password alone. Intended as an operational escape
  -- hatch when mail delivery is broken; see also each user's bypass_2fa flag.
  ('require2FA', 'true'),
  -- Cycle Data upload/download. Switch off to hide the feature entirely
  -- without deleting anything already uploaded.
  ('feature_cycle_data', 'true'),
  -- How long a browser stays trusted after its user verifies an OTP. This is
  -- the single biggest control on mail usage: at 7 days, 200 users cost about
  -- 29 codes a day instead of one per login. Set to '0' to demand a code every
  -- time (and budget the mail for it).
  ('otpTrustDays', '7'),
  -- How long an emailed password-reset code stays valid. No second code is
  -- sent while one is still live, so a user hammering "forgot password"
  -- cannot drain the day's allowance.
  ('resetOtpMinutes', '20'),
  -- Messages the portal will send in a day before it stops. Deliberately below
  -- the provider's real limit, so the portal refuses on its own terms with a
  -- log entry rather than having the provider reject mail silently.
  ('mailDailyCap', '280')
ON CONFLICT (key) DO NOTHING;
