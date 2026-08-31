# NRLDC Schedule Discrepancy Monitoring Portal

This document outlines the complete setup and startup guide for the **NRLDC Schedule Discrepancy Monitoring Portal**. Follow these instructions to run the application on any local computer.

---

## 📋 Table of Contents
1. [Prerequisites](#-prerequisites)
2. [Step-by-Step Installation & Configuration](#%EF%B8%8F-step-by-step-installation--configuration)
   * [Step 1: Install Node.js](#step-1-install-nodejs)
   * [Step 2: Install and Start PostgreSQL](#step-2-install-and-start-postgresql)
   * [Step 3: Create the Database](#step-3-create-the-database)
   * [Step 4: Configure Environment Variables (.env)](#step-4-configure-environment-variables-env)
   * [Step 5: Run Database Seeding (Crucial)](#step-5-run-database-seeding-crucial)
3. [Running the Application](#-running-the-application)
   * [Method A: Using start.bat (Windows Only - Recommended)](#method-a-using-startbat-windows-only---recommended)
   * [Method B: Using nrldc.sh (macOS / Linux - Recommended)](#method-b-using-nrldcsh-macos--linux--recommended)
   * [Method C: Using start.sh (foreground dev session)](#method-c-using-startsh-foreground-dev-session)
   * [Method D: Manual Terminal Execution (macOS / Linux / Windows)](#method-d-manual-terminal-execution-macos--linux--windows)
4. [Testing & Default Credentials](#-testing--default-credentials)
5. [Demo Data](#-demo-data)
6. [Security Model](#-security-model)
7. [QCA (Qualified Coordinating Agency) Rules](#-qca-qualified-coordinating-agency-rules)
8. [File Uploads](#-file-uploads) — *how to allow a new file type*
9. [Time Blocks](#-time-blocks)
10. [If Users Cannot Receive Their OTP](#-if-users-cannot-receive-their-otp)
11. [Regions](#%EF%B8%8F-regions)
12. [Email Budget](#-email-budget)
13. [Deploying to Production](DEPLOYMENT.md) — *the go-live runbook*
14. [Deploying](#-deploying)
15. [Self-Service Registration](#-self-service-registration)
16. [Password Resets](#-password-resets)
17. [Turning Features On and Off](#%EF%B8%8F-turning-features-on-and-off)
18. [Troubleshooting Common Issues](#%EF%B8%8F-troubleshooting-common-issues)

---

## 🛠️ Prerequisites

Before starting, verify you have the following installed:
* **Node.js** (v18.x or v20.x recommended) & **npm** (comes bundled with Node.js)
* **PostgreSQL** (v14 or higher)

---

## ⚙️ Step-by-Step Installation & Configuration

### Step 1: Install Node.js
If not already installed:
1. Download Node.js from the official website: [https://nodejs.org/](https://nodejs.org/)
2. Install the LTS version.
3. Verify installation in your command prompt / terminal:
   ```bash
   node -v
   npm -v
   ```

### Step 2: Install and Start PostgreSQL
1. Download PostgreSQL: [https://www.postgresql.org/download/](https://www.postgresql.org/download/)
2. During the installation, set a password for the default `postgres` user (e.g., `nrldc123` or your own password). Note down this password.
3. Make sure the PostgreSQL service is running on your machine (it typically runs automatically as a background service after installation on port `5432`).

### Step 3: Create the Database
1. Open **pgAdmin** (the graphical tool installed with PostgreSQL) or the **psql** command-line interface.
2. Log in using your PostgreSQL root user (`postgres`) and password.
3. Create a new database named **`nrldc_db`**.
   * *In pgAdmin:* Right-click "Databases" -> Create -> Database... -> Enter Name: `nrldc_db`.
   * *In SQL query tool / psql:* Run:
     ```sql
     CREATE DATABASE nrldc_db;
     ```

### Step 4: Configure Environment Variables (.env)
1. Navigate to the project subdirectory: `server/`
2. Copy the template to create your own configuration file:
   ```bash
   cp server/.env.example server/.env
   ```
   `server/.env` is **git-ignored** — it holds real credentials and must never be committed.
3. Open `server/.env` and fill in the values for your machine:
   ```env
   PGHOST=localhost
   PGPORT=5432
   PGDATABASE=nrldc_db
   PGUSER=postgres
   PGPASSWORD=your_postgres_password_here
   PORT=3001
   SESSION_SECRET=<paste a long random string here>
   ```
   *(Ensure `PGPASSWORD` matches the password you configured in Step 2)*

4. **Generate a real `SESSION_SECRET`.** It signs the session tokens issued at
   login — anyone who knows it can mint a token for any account, including an
   administrator. Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   If this is left empty or set to the old shipped default, the server prints a
   warning at startup and generates a throwaway secret, which logs every user
   out whenever the server restarts.

### Step 5: Run Database Seeding (Crucial)
Before running the portal for the first time, you must create the tables and seed default users.
1. Open a command prompt / terminal.
2. Navigate to the `server/` folder:
   ```bash
   cd server
   ```
3. Run the following command to initialize schemas and default accounts
   (all seeded with the password `Password@123`):
   ```bash
   node seed.js
   ```
   If successful, you will see:
   ```text
   [SEED] Connecting to PostgreSQL...
   [SEED] Dropping existing database tables to apply new schema...
   [SEED] All existing tables dropped.
   [SEED] Schema created/verified.
   [SEED] 2 seed accounts created.
   [SEED] Initial system log entry added.
   [SEED] ✅ Database seeding complete!
   ```

---

## 🏃 Running the Application

### Method A: Using start.bat (Windows Only - Recommended)
1. Go to the project root folder.
2. Double-click the file **`start.bat`**.
3. The script will automatically:
   * Install/verify backend dependencies (`npm install` inside `server/`).
   * Install/verify frontend dependencies (`npm install` in the root directory).
   * Launch both the frontend development server and backend server simultaneously.
4. Keep the command prompt window open.

---

### Method B: Using nrldc.sh (macOS / Linux — Recommended)
One-time:
```bash
chmod +x nrldc.sh
./nrldc.sh setup
```
Then:
```bash
./nrldc.sh start        # build the app and serve it on http://localhost:3001
./nrldc.sh restart      # stop what is running, rebuild, start again
./nrldc.sh stop
./nrldc.sh status
```

| Command | What it does |
| --- | --- |
| `./nrldc.sh setup` | First run: checks Node and PostgreSQL, creates the database, installs packages, applies the schema |
| `./nrldc.sh start` | Builds the frontend and serves the app **and** API from one port (3001) |
| `./nrldc.sh start --dev` | Runs the Vite dev server on 5173 with the API on 3001, for development |
| `./nrldc.sh restart` | Stop, rebuild, start — safe when nothing is running. **Use this after pulling changes** |
| `./nrldc.sh stop` | Stops the server and frees both ports |
| `./nrldc.sh status` | Shows the pid, which ports are in use, and whether the API is healthy |
| `./nrldc.sh logs` | Follows the server log |
| `./nrldc.sh migrate` | Applies schema updates, **keeping all data** |
| `./nrldc.sh seed` | Drops every table and reseeds (asks for confirmation) |

The server runs in the background, so you get your terminal back. Its log is at
`.run/server.log` and its pid at `.run/server.pid`.

**In production mode there is only one port.** The Express server serves the
built frontend as well as the API, so there is no Vite, no CORS and nothing
else to deploy. Put nginx (or similar) in front of it to terminate HTTPS.

---

### Method C: Using start.sh (foreground dev session)
From the project root, once:
```bash
chmod +x start.sh
```
Then to run the portal:
```bash
./start.sh
```
The script checks Node, `server/.env`, PostgreSQL and the ports before starting
anything, installs missing dependencies, creates the database if it does not
exist, launches both servers and opens the browser at
<http://localhost:5173>. Press **Ctrl+C** to stop both.

| Command | What it does |
| --- | --- |
| `./start.sh` | Preflight, install if needed, run backend + frontend |
| `./start.sh --check` | Run the preflight checks only and stop |
| `./start.sh --migrate` | Apply schema updates to an existing database, **keeping all data**, then start |
| `./start.sh --seed` | **DROP every table**, recreate and seed test accounts (asks for confirmation), then start |
| `./start.sh --help` | Show the options |

**After pulling updates that change the schema, run `./start.sh --migrate` once.**
It applies new columns and constraints without touching your data. Use `--seed`
only on a throwaway or first-time database — it deletes everything.

---

### Method D: Manual Terminal Execution (macOS / Linux / Windows)
If you cannot run batch files:
1. **Open a terminal in the root folder of the project** and run:
   ```bash
   npm install
   ```
2. **Navigate to the server directory** and install backend packages:
   ```bash
   cd server
   npm install
   cd ..
   ```
3. **Start both servers concurrently:**
   ```bash
   npm run dev:all
   ```

To update an existing database's schema without losing data, run
`npm run migrate` inside `server/` instead of `npm run seed`.

---

## 🔑 Testing & Default Credentials

Once the servers are running:
1. Open your web browser and navigate to: **[http://localhost:5173](http://localhost:5173)**
2. You can log in using one of the seeded user accounts:

All seeded accounts share the same default password: **`Password@123`**

| Portal | Username | Password |
| --- | --- | --- |
| Admin | `admin@nrldc` | `Password@123` |
| Plant User | `user@nrldc` | `Password@123` |
| QCA | `qca1@nrldc` / `qca2@nrldc` | `Password@123` |

`Password@123` is also the password given to every user created through the
Admin portal, imported from CSV, or reset with **Reset Password**. It is defined
once in [server/utils/password.js](server/utils/password.js) and mirrored for the
UI in [src/utils/password.js](src/utils/password.js) — change it in both places
if you want a different default.

*(Note: Both default users have 2FA bypassed for quick testing access, configurable in database users table `bypass_2fa=true`)*

> **Change these passwords before any real deployment.** The default is
> published in this file and in the source.

### Password requirements
Any password set through the portal must have **at least 8 characters, one
uppercase letter, one number and one special character**. The profile form shows
the rules ticking off as you type, and the server enforces the same policy
independently on every path that sets a password — account creation, admin
edits, self-service changes and the temporary password sent by password
recovery. `Password@123` satisfies the policy, so the default remains usable for
testing.

### Forgotten passwords
"Forgot Password" emails a freshly generated random password to the address
registered on the account, and replies with the same message whether or not the
account exists. It does not reveal the password on screen or in the system log,
and if the email cannot be delivered the existing password is left unchanged.
Working SMTP settings are therefore required for password recovery — configure
them in `server/.env` or under **System Parameters** in the Admin portal.

---

## 🎭 Demo Data

To fill the database with a realistic body of data — useful for demonstrating
the portal or feeling out the interface with something other than five rows:

```bash
./nrldc.sh demo                  # from the project root — easiest
```

or, equivalently:

```bash
node server/demo_seed.js         # from the project root
cd server && ./demo_seed.js      # from the server directory
```

Add `--yes` to any of these to skip the confirmation prompt.

It loads:

* **150 plant users** — 124 RE, 17 ISGS, 9 States, each on its own WBES plant
* **8 QCA accounts** coordinating **115** of the RE plants between them, leaving
  **9 RE plants independent**
* **1000 discrepancies** spread over the last few months across every status,
  filed by QCAs for the plants they coordinate and by plants for themselves
* **60 attachment files** (valid PDFs and Excel workbooks, ~1–7 KB each) in
  `server/upload/`, referenced by roughly half the requests so downloads work

The 158 accounts it creates sign in with **`Password@123`** and have OTP
bypassed, so no mail server is needed.

**Admin accounts are not touched**, so `admin@nrldc` keeps whatever password it
already had — `Password@123` on a database seeded since that became the default,
or the older `password123` on one seeded before. If you are unsure, run
`./nrldc.sh seed` to reset everything to the current default, or set a new admin
password from User Management.

> **It replaces data.** All discrepancies and every non-admin user are deleted
> first. Admin accounts are left alone. Use it on a demo or test database.

Some accounts worth trying:

| Account | What you see |
| --- | --- |
| `admin@nrldc` | The full queue of 1000, all filters, user management |
| `qca.tharsolar@nrldc` | A QCA with 25 plants — "My Plants" and filing for any of them |
| `bhadla.re@nrldc` | An RE plant managed by a QCA — filing is restricted |
| `jhansi.re4@nrldc` | An independent RE plant — can file, and can request a QCA |
| `singrauli@nrldc` | An ISGS station — no QCA controls anywhere |
| `delhi@nrldc` | A State utility |

## 🔐 Security Model

* **Every `/api` route except login, password recovery and `/api/health`
  requires authentication.** A successful login returns an HMAC-signed session
  token (8-hour lifetime) that the frontend stores and sends as
  `Authorization: Bearer <token>` on every request.
* **Identity comes from the token, never from the request.** Endpoints that
  used to accept a `username` field now derive the caller from their token, so
  one user cannot read or file anything as another. Administrator-only actions
  (user management, resolving discrepancies, system parameters, server logs,
  bulk import) are rejected for non-admin tokens.
* **Uploaded attachments require a valid session** and are served only by
  basename from `server/upload`, so a crafted filename cannot escape that
  directory.
* **SMTP credentials are returned only to administrators**, and only the known
  configuration keys can be written.
* Tokens are invalidated on logout, on expiry, and whenever the account is
  locked or deleted.
* **Changing your own password requires your current password.** A session left
  open on an unattended machine therefore cannot be used to lock the real owner
  out of their account. An administrator setting a password for someone else
  does not need it — that is a separate, deliberate action.

## ⚡ QCA (Qualified Coordinating Agency) Rules

A QCA coordinates **Renewable Energy (RE) plants only**. ISGS and States plants
are managed by their own users and have no QCA involvement anywhere in the
portal. This is enforced at every layer:

* A QCA account can only exist in the RE category — enforced by a database
  check constraint (`qca_is_renewable_only`) as well as by the API, so an
  existing account cannot be moved out of RE while it holds the QCA role.
* `wbes_entities.energy_category` records each plant's category. A QCA can only
  be assigned RE plants, can only file discrepancies for RE plants it is
  actually the assigned coordinator for on that date, and only ever sees RE
  plants in the plant picker.
* QCA transfer requests apply to RE plants only, and the target must be a
  registered QCA account.
* ISGS and States users never see the "My Plants" tab, the QCA transfer window,
  or any other QCA control.

When upgrading an existing database, re-running `node seed.js` applies the new
column and constraints. The migration backfills each plant's category from its
registered user and moves any pre-existing QCA account into RE.

## 📎 File Uploads

Attachments are limited to **PDF, Excel (.xlsx, .xls, .xlsm) and CSV**, up to
**25 MB per file**. Anything else is refused by the server, and a refused upload
leaves nothing behind on disk.

### Adding a new allowed file type

Edit **[server/config/uploads.js](server/config/uploads.js)** and add one line to
the `ALLOWED_UPLOAD_TYPES` list. For example, to also allow Word documents:

```js
{
  ext: '.docx',
  label: 'Word document',
  mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
},
```

* `ext` — the extension, lower-case, with the dot. **This is what decides
  whether a file is accepted**, because the extension determines how the file
  will open for whoever downloads it.
* `mime` — the MIME type(s) browsers report. Used only as a fallback for files
  uploaded with no extension. To find a file's MIME type on a Mac:
  `file --mime-type -b yourfile.docx`
* `label` — the name shown in error messages.

To change the size cap, edit `MAX_UPLOAD_MB` in the same file.

Then mirror the extension in **[src/utils/uploads.js](src/utils/uploads.js)** so
the browser's file picker offers it, and restart the backend (Ctrl+C, then
`./start.sh`). No database change is needed.

## 🔢 Time Blocks

The scheduling day has 96 blocks of 15 minutes (block 1 = 00:00–00:15,
block 96 = 23:45–24:00). The field accepts **only digits, commas and hyphens**:

| Entry | Meaning |
| --- | --- |
| `4,5,84` | blocks 4, 5 and 84 |
| `1-4` | blocks 1 to 4 |
| `85-87,95,96` | a range plus two single blocks |

Anything else is rejected with a specific reason — letters, a block outside
1–96, or a backwards range like `10-2`. Entries are stored in a normalised
form (sorted, de-duplicated, adjacent blocks collapsed), so `85-87,95,96`
is saved as `85-87, 95-96`. That keeps the column consistent and makes the
records easier to compare.

## 🔐 If Users Cannot Receive Their OTP

Two-factor codes are emailed. When mail delivery breaks, an administrator can
let people in without waiting on anyone else — there are two switches, both in
the portal:

**One person can't get their code** → *User Management* → the **OTP** column →
click the badge for that user. That account then signs in with its password
alone. Click again to require the code once more.

**Nobody can get their codes** → *System Parameters* → untick
**"Require OTP (two-factor) at login"** → Save. Everyone signs in with their
password alone until you tick it again. The panel turns amber while this is off,
as a reminder.

**You are the admin and *you* are locked out** → there is no way out from inside
the portal, so use the terminal on the server:

```bash
./nrldc.sh unlock admin@nrldc
```

That clears the lockout, resets the failed-attempt count, and switches OTP off
for that one account, which can then sign in on its password alone. Turn OTP
back on from *User Registry* once mail is working again.

> This is the failure worth knowing about before it happens: if the last admin
> account turns its own OTP on and the code does not arrive, nobody left in the
> portal can switch it off. The command above is the way back.

Both actions are written to the system log with the admin's username.

OTPs themselves are stored in the database rather than in server memory, so a
restart no longer strands anyone mid-login, and a code survives until it expires
(5 minutes) or is used. Five wrong attempts burns the code and the user must log
in again.

### A code is asked for once a week, not once a login

Verifying a code registers *that browser* as trusted for `otpTrustDays` (7 by
default), and sign-ins from it skip the code entirely. This is what makes the
mail plan work — see [Email Budget](#-email-budget).

The trust belongs to the browser, not the account: it holds a random secret,
only the hash of which is stored, so knowing the password is still not enough to
sign in from anywhere else. Trust ends when it expires, when the password
changes, or when it is revoked.

A user can see and revoke their own trusted browsers, and an admin can revoke
anyone's — useful for a lost or shared machine, and it does not require changing
the password.

## 🗺️ Regions

One deployment serves several load despatch centres. Each has its own
administrator, and they cannot see or touch each other's data.

| Role | Sees | Can create |
| --- | --- | --- |
| `USER` / `QCA` | Their own filings, within their region | — |
| `ADMIN` | Everything in **one** region | Users and QCAs in that region |
| `SUPERADMIN` | **Every** region | Administrators, in any region |

So `admin@nrldc` administers NRLDC's plants, states, discrepancies, outages,
registrations and settings; `admin@erldc` administers ERLDC's. Neither appears
in the other's user registry, log, or plant list.

### What is per region, and what is not

Almost everything is regional: accounts, plants, discrepancies, outages, cycle
data, registrations, password resets, the system log, and the filing rules
(filing window, re-raise limits, lockout threshold, outage categories, Cycle
Data on/off, whether OTP is required).

Three things cannot be, because there is only one of the underlying thing —
**one mail account and one daily allowance**:

* `otpTrustDays` · `resetOtpMinutes` · `mailDailyCap`
* the SMTP server settings

Those live under a reserved `GLOBAL` region and only a `SUPERADMIN` can change
them. A regional admin sees them greyed out, with a note saying why.

> The mail allowance is **shared**. Every region's login codes come out of the
> same 300 a day, so adding a region does not add headroom — see
> [Email Budget](#-email-budget).

### Adding a region

```bash
./nrldc.sh regions           # accounts, plants and admins per region
./nrldc.sh promote <user>    # make an account the national administrator
```

`promote` is the bootstrap: only a national administrator can create
administrators, which leaves the first one with nowhere to come from. Promote
one account, sign in as it, then create each region's admin from *User Registry*
with the **Region** selector.

Everything that existed before regions is NRLDC. Adding a region needs no
migration — the settings for all five are seeded already, and a region with no
accounts simply has nothing in it.

### The registration form asks which centre

Self-registration has a **Load despatch centre** field, and it decides which
admin reviews the request. A registration for ERLDC never appears in the NRLDC
queue, and an NRLDC admin who somehow reaches it is refused.

## 📧 Email Budget

The portal sends mail through **Brevo**, whose free plan allows **300 messages a
day**. That is the tightest resource the portal has, and running out of it is
invisible from the outside — codes simply stop arriving. So sending is metered.

*System Parameters → Email Budget* shows today's usage and three controls:

| Setting | Default | What it does |
| --- | --- | --- |
| Ask for an OTP once every … days | `7` | How long a browser stays trusted after verifying a code. **The main control on usage.** `0` demands a code at every login. |
| Password reset code valid for … minutes | `20` | How long a reset code lasts. No second code is emailed while one is live. |
| Daily message limit | `280` | The portal stops sending at this number and logs why. Kept below Brevo's 300 so nothing is rejected upstream. |

### Why 7 days is enough

With 200 users, one code per user per week is about **29 messages a day**. Asking
at every login instead — twice a day each — would need **400**, more than the
plan allows. The same 200 users would need a second Brevo account only if the
trust window dropped to about a day.

Even the worst case fits: if every user's trust expired on the same day, that is
200 messages against a 280 cap.

**A second Brevo account is not needed, and would cost more than it saves** —
two sets of credentials, two senders to keep verified, two dashboards to watch,
and a reputation split across both. Raise `otpTrustDays` before adding an
account.

### If mail is accepted but never arrives

The portal logs a message as *dispatched* once Brevo accepts it. Brevo accepting
it is not the same as the recipient receiving it, and the usual reason for the
gap is the **From** address.

`smtpFrom` must be an address Brevo is authorised to send as. A `@gmail.com`
From is the trap: `gmail.com` publishes an SPF record that lists only Google's
own servers, so a message sent through Brevo claiming to be from a Gmail address
fails SPF and is unaligned for DKIM. Corporate mail servers quarantine that as
spoofing — which is exactly what it looks like.

To fix it properly, send from a domain you control:

1. In Brevo, add your domain (for example `grid-india.in`) as a sender.
2. Add the SPF and DKIM records Brevo gives you to that domain's DNS.
3. Set **From** in *System Parameters → SMTP Server Settings* to an address on
   that domain, such as `noreply@grid-india.in`.

Until that is done, check the recipient's spam or quarantine folder, and check
**Brevo → Transactional → Logs**, which shows per-message whether each was
delivered, soft-bounced, hard-bounced or blocked. That log is the authority; the
portal only knows whether Brevo took the message.

### When the cap is reached

Sending stops and the log says so by name. A user trying to sign in is told the
limit was reached and to contact the administrator, rather than being left
waiting for a code. A user asking for a password reset is pointed at the
*ask an administrator* route, which needs no email at all. Nothing is silently
dropped, and the counter resets at midnight.

## 🚀 Deploying

The backend serves the built frontend, so a deployment is one Node process and
one PostgreSQL database.

```bash
npm run build     # produces dist/
npm start         # NODE_ENV=production, serves dist/ and /api on PORT
```

Set these in `server/.env` for a real deployment:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | **Required.** Signs session tokens — a long random string |
| `PORT` | Port to listen on (default 3001) |
| `NODE_ENV=production` | Enables CSP, HSTS and production error handling |
| `CORS_ORIGINS` | Only needed if the frontend is served from another origin |
| `TRUST_PROXY_HOPS` | Number of proxies in front (1 for a single nginx, 0 for none) |
| `RATE_LIMIT_READ` / `RATE_LIMIT_WRITE` / `RATE_LIMIT_AUTH` | Override the per-user request limits |
| `PGPOOL_MAX` | Maximum database connections (default 10) |

Still required outside the application:

* **Terminate HTTPS in front of it.** Session tokens travel in an
  `Authorization` header; over plain HTTP they can be read off the wire.
* **Keep it running.** Use `launchd`, `systemd` or `pm2` so it restarts on
  boot and on crash. The server handles `SIGTERM` cleanly, finishing in-flight
  requests before closing the database pool.
* **Back up the database**, and rotate `.run/server.log`.

## 📝 Self-Service Registration

Stations and coordinating agencies can request access themselves from the
**Register for access** link on the sign-in page. Submitting does **not** create
an account — it queues a request that an NRLDC administrator must approve.

* Both **plant users** and **QCAs** can register. A QCA is Renewable Energy by
  definition, so its category is fixed to RE and it must give an agency name.
* The applicant chooses their own password, subject to the usual rules. It is
  hashed immediately and carried across on approval, so there is no temporary
  password to communicate and nobody — including the administrator — ever sees
  it.
* **The username is built from the WBES acronym** — `DADRI` becomes
  `dadri@nrldc`, `BIKANER_RE3` becomes `bikaner.re3@nrldc` — matching every
  account already in the registry. It fills in as the acronym is typed, and the
  applicant can still type their own. The admin's *Add User* form follows the
  same convention.
* A registration is refused if the username, acronym or email already belongs
  to an account, or to another request still awaiting a decision.

### Approving, correcting or rejecting

Only an administrator can decide. Open **User Registry** — pending requests
appear at the top, with a count.

Click **Review** to open the application. Every field is editable, so a station
that filed itself under RE when it is really ISGS, or mistyped its acronym, can
be corrected on the spot rather than rejected and asked to start again. Changed
fields are marked with what they said before. Correcting the acronym updates the
username with it, unless you have typed a username yourself.

What corrections cannot do:

* **Grant admin rights.** The role can only be set to plant user or QCA;
  anything else is refused outright.
* **Break the QCA rule.** A QCA account must be RE and must name its agency.
* **Take a name already in use.** Usernames, acronyms and emails are re-checked
  against live accounts at the moment of approval, not just at submission.
* **Change the password.** The applicant signs in with what they chose.

The account is created from what you see on the review panel. The request row
keeps the application *as submitted*, and the corrections are recorded against
it — so months later it is still clear what was asked for and what was changed.

Rejecting requires a reason, which is emailed to the applicant. A rejected
applicant can register again with corrected details.

New accounts are created with OTP required. If mail delivery is not working,
use the OTP column in the same page to let them in — see
[If Users Cannot Receive Their OTP](#-if-users-cannot-receive-their-otp).

## 🔑 Password Resets

There are two routes from **Forgot Password** on the sign-in screen:

| Route | What happens | When to use it |
| --- | --- | --- |
| Email me a reset code | A 6-digit code, valid 20 minutes. The user enters it and chooses their own password. | Normal case — mail is working. |
| Ask an administrator to reset it | Queues a request. Nothing changes until an admin approves. | Mail is **not** reaching the user, which is when they most need it. |

The emailed route never sends a password. A code on its own changes nothing, so
an email that goes astray does not hand over the account, and no working
password is left sitting in an inbox forever.

**Pressing the button repeatedly costs nothing.** While a code is still valid no
second one is emailed — the reply is the same either way. That is deliberate: it
stops a frustrated user draining the day's mail allowance in a minute.

Completing a reset also signs out every browser that was trusted to skip the OTP
for that account. A reset exists to cut off whoever should no longer have
access, and a still-trusted browser would quietly survive it.

Requests appear as **Password Reset Requests** at the top of *User Registry*,
showing who is asking, the plant, any message they left, and whether the account
is locked out. Approving sets the password back to `Password@123` **and clears
the lockout** — a user who has been asking for a reset has usually locked
themselves out trying. Declining requires a reason.

> **Confirm who is asking before you approve.** The reset password is a known
> fixed value, so an approval is the one step that decides whether the right
> person gets back in. Tell the user to change it from *Profile Settings* as
> soon as they are signed in.

Either route replies identically whether or not the account exists, so neither
can be used to find out which usernames are real.

## ⚙️ Turning Features On and Off

**System Parameters** groups settings by what they govern:

| Section | Controls |
| --- | --- |
| Discrepancy Filing Rules | Filing window, extended window, re-raise window and count |
| Security & Access | Whether OTP is required at login, and the account lockout threshold |
| Feature Availability | Cycle Data on/off, and which categories may file unit outages |
| SMTP Server Settings | Mail server used for OTP and password recovery |
| Your Preferences | The default category *your* account opens on |

### Switching off Cycle Data

Untick **Cycle Data upload and download** under *Feature Availability* and save.
The Cycle Data tabs disappear for admins and stations, and the endpoints refuse
requests — the feature is genuinely off, not just hidden. Nothing already
uploaded is deleted, and it all reappears if the feature is switched back on.

## ⚠️ Troubleshooting Common Issues

* **Error: `npm` or `node` is not recognized as an internal or external command:**
  * *Fix:* Node.js is not installed or not added to your system's Environment Variables (PATH). Re-run the Node.js installer and select "Add to PATH" option.
* **Error: `Connection refused` or `failed to connect to PostgreSQL`:**
  * *Fix:* Double check that the PostgreSQL service is active. Ensure database name (`nrldc_db`), port (`5432`), and password match [server/.env](file:///c:/Users/anshu/OneDrive/Desktop/NRLDC%20Schedule%20Disparency/server/.env) settings.
* **Error: `relation "users" does not exist` when trying to log in:**
  * *Fix:* You forgot to run database seeding. Make sure you run `node seed.js` inside the `server/` directory before running the portal.
* **"Authentication check failed." on every page after logging in:**
  * *Cause:* The database schema is older than the code — the auth layer looks
    for a table (`revoked_tokens`) that your database does not have yet.
  * *Fix:* `./nrldc.sh migrate`, then restart. Your data is preserved.
  * Since this check was added the server refuses to start against an
    out-of-date schema and tells you exactly which tables are missing, rather
    than starting and failing every request.
* **"The server database needs updating":**
  * *Fix:* Same thing — `./nrldc.sh migrate`.
* **Your old password still works after the password rules were added:**
  * That is expected. The rules (8 characters, uppercase, number, special)
    apply to passwords **set from now on**. Existing passwords keep working
    until they are changed, so nobody is locked out by the change.
* **Every API call returns 401 / you are bounced back to the login screen:**
  * *Fix:* The session token is missing or expired — log in again. Tokens last
    8 hours. If it happens after every server restart, `SESSION_SECRET` is not
    set in `server/.env` (see Step 4).
* **An action returns "Administrator privileges are required":**
  * *Fix:* That endpoint is admin-only. Log in with an ADMIN account.
* **Port Conflict (`Port 3001` or `Port 5173` already in use):**
  * *Fix:* Close other running applications or change the port settings. You can adjust the backend port in `.env` (`PORT=xxxx`) and frontend proxy settings in [vite.config.js](file:///c:/Users/anshu/OneDrive/Desktop/NRLDC%20Schedule%20Disparency/vite.config.js).
