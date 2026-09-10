# Deploying to production on Windows Server

This is the runbook for putting the portal in front of real users on **Windows
Server**, against a **central PostgreSQL** run by IT, reached over **HTTPS from the
public internet**.

The repo's main [DEPLOYMENT.md](DEPLOYMENT.md) targets Linux + systemd + the
`nrldc.sh` control script. **None of that bash tooling runs on Windows**, so this
document is the Windows-native equivalent. The *reasoning* in DEPLOYMENT.md still
applies — read it once for the "why"; this file is the "how" for Windows.

Work through it in order. Ordering matters in three places (mail before OTP; build
before start; harden last), all flagged below.

> **Read first — internet exposure of a load-despatch portal.** This is
> operational software for grid scheduling. Putting it directly on the public
> internet materially raises the stakes. Before go-live, get your IT security team
> to sign off on §11, and strongly prefer restricting access (corporate VPN, the
> NLDC/Grid-India WAN, or an IP allow-list at the edge) over open public access if
> the user base allows it.

---

## 0. What to get from IT before you start

| Need | Detail to obtain |
| --- | --- |
| **App server** | A Windows Server (2019/2022) VM you can RDP into, with local admin. |
| **Node.js** | Permission to install Node.js **20 LTS or newer** (the app needs ≥18). |
| **PostgreSQL** | Host, port, an **empty database `nrldc_db` owned by the app login**, that login's username/password, and **whether the server enforces TLS/SSL** (see §3 — SSL needs a one-line code change). |
| **Network path** | The app server must reach the DB host:port through any internal firewall. |
| **Public name + cert** | The DNS name users will type (e.g. `portal.nrldc.in`) and a **TLS certificate** for it (PFX), issued by a CA your users' browsers trust. |
| **Mail** | An SMTP relay/account **and** the ability to publish SPF + DKIM DNS records for the From-address domain (see §7). |

You will run the deployment as `Administrator` on the app server, but the portal
itself should run under a **dedicated low-privilege service account** (§5).

---

## 1. Prepare the server

Install the runtime and get the code (adjust the path to your standard; this
runbook uses `C:\apps\nrldc-portal`):

```powershell
# Node.js 20 LTS — install via the MSI from nodejs.org, or winget:
winget install OpenJS.NodeJS.LTS
node -v            # expect v20.x or newer

# Git (if not present):  winget install Git.Git

# Get the code
mkdir C:\apps; cd C:\apps
git clone <your-production-repo-url> nrldc-portal
cd C:\apps\nrldc-portal

# Install dependencies (frontend + backend)
npm install
cd server; npm install; cd ..
```

---

## 2. Configure `server\.env`

Copy the template and edit it. This file is git-ignored — never commit real
credentials.

```powershell
Copy-Item server\.env.example server\.env
notepad server\.env
```

Set these for a real, internet-facing, TLS-fronted deployment:

```dotenv
# ── PostgreSQL: the central DB from IT ──
PGHOST=<db-host-from-IT>
PGPORT=5432
PGDATABASE=nrldc_db
PGUSER=<app-db-login>
PGPASSWORD=<app-db-password>
PGPOOL_MAX=10

PORT=8102

# NOT cosmetic: turns on CSP + HSTS, makes a missing SESSION_SECRET fatal,
# and makes the destructive seeders refuse to run.
NODE_ENV=production

# TLS is terminated by IIS in front (§6). This turns HSTS on. Only set true
# once HTTPS actually works end-to-end.
BEHIND_TLS=true

# Number of reverse proxies in front of Node. One IIS/ARR hop = 1. If a
# corporate load balancer or WAF also sits in front of IIS, make it 2, etc.
# Verify with /api/health after §6 (clientIp must equal the real client).
TRUST_PROXY_HOPS=1

# Single-origin in production (IIS serves the same origin), so leave CORS empty.
# CORS_ORIGINS=

# Signs session tokens. Generate a fresh one:
SESSION_SECRET=<paste output of the command below>
```

Generate the secret (do **not** reuse the example value):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Fill in the SMTP block too (see §7). If you ever run more than one Node instance
behind a balancer, **every instance must carry the identical `SESSION_SECRET`**, or
they reject each other's tokens and sign users out at random.

---

## 3. Create the schema and the first admin

**Ask IT to create `nrldc_db` owned by your app login.** Ownership matters: the clean
bootstrap below recreates the `public` schema, which requires the app user to own it.

Confirm the app can reach the DB, then bootstrap. `init_fresh.js` builds the schema,
the five RLDC regions plus the national **NLDC** region, default settings, and
**one** national-admin account — the clean production starting point (no test data).
It refuses to run when `NODE_ENV=production`, so override it just for this one-off:

```powershell
# PowerShell: set NODE_ENV for this command only
$env:NODE_ENV='development'; node server\init_fresh.js --yes; Remove-Item Env:\NODE_ENV
```

That prints the login: **`admin@nldc` / `Password@123`**, OTP bypassed. You will
change that password in §10 before anyone else can reach the portal.

**If IT will not grant schema ownership** (so `init_fresh` can't drop/recreate
`public`): use the additive migration instead — it only creates what's missing and
never drops:

```powershell
node server\migrate.js
```

…then create the national admin from SQL (see the `national` recipe in §13), since
there's no account yet.

**`pg_trgm`:** the schema runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` for fast
search. On a managed DB the app login may lack rights to create extensions — the
schema treats this as **non-fatal** (search still works, just without the trigram
index acceleration). If IT can pre-create the extension once, do so.

**SSL to the database (confirm with IT):** the pool in
[server/db.js](server/db.js#L18-L27) connects **without** SSL. If IT's PostgreSQL
*requires* TLS, the connection will fail until `db.js` passes an `ssl` option. That
is a small, deliberate code change — flag it to whoever maintains the code; don't
disable the DB's TLS requirement to work around it.

---

## 4. Build the frontend

The Node server serves the built React app from `dist\`. **It does not build for
you** — if you skip this, or forget it after an upgrade, users get a stale page or
missing UI (this is exactly the "icons didn't appear after hosting" symptom).

```powershell
npm run build          # regenerates dist\ from current source
```

Re-run this after **every** `git pull` (see §14).

---

## 5. Run the Node server as a Windows Service

The server exits cleanly on an uncaught exception on purpose — that's only safe if
something restarts it. On Linux that's systemd; on Windows, register it as a
**service** so a crash, OOM, or reboot brings it straight back.

Two good options — pick one:

### Option A — NSSM (recommended, simplest)

Download NSSM (a single `nssm.exe`, no installer) from nssm.cc, then:

```powershell
nssm install NRLDCPortal "C:\Program Files\nodejs\node.exe" "server\index.js"
nssm set NRLDCPortal AppDirectory "C:\apps\nrldc-portal"
nssm set NRLDCPortal AppEnvironmentExtra NODE_ENV=production
nssm set NRLDCPortal AppStdout "C:\apps\nrldc-portal\logs\out.log"
nssm set NRLDCPortal AppStderr "C:\apps\nrldc-portal\logs\err.log"
nssm set NRLDCPortal AppRotateFiles 1
nssm set NRLDCPortal Start SERVICE_AUTO_START
# Run under a dedicated low-privilege account (recommended):
nssm set NRLDCPortal ObjectName ".\svc-nrldc" "<account-password>"

mkdir C:\apps\nrldc-portal\logs
nssm start NRLDCPortal
```

`NODE_ENV=production` is set here (not only in `.env`) so the mode is correct even
before dotenv loads. NSSM restarts the process on any non-zero exit by default, with
throttling — the equivalent of the systemd `Restart=always` + start-limit pair.

### Option B — WinSW (a single self-contained exe, no third-party install)

The repo ships a ready template at
[deploy/winsw-nrldc-portal.xml](deploy/winsw-nrldc-portal.xml). Rename `WinSW.exe`
to `nrldc-portal-svc.exe`, put the edited XML beside it as
`nrldc-portal-svc.xml`, then:

```powershell
.\nrldc-portal-svc.exe install
.\nrldc-portal-svc.exe start
```

### Verify either way

```powershell
Get-Service NRLDCPortal
curl.exe -s http://localhost:8102/api/health
```

`/api/health` should return `"status":"ok"`, `"db":"connected"`, and
`"production":true`.

---

## 6. Put IIS in front as the HTTPS reverse proxy

The Node server speaks **plain HTTP on 8102** and must never be exposed directly.
IIS terminates TLS on 443 and reverse-proxies to `127.0.0.1:8102`.

1. **Install the IIS pieces** (Server Manager → Add Roles, or the panels):
   - IIS (Web Server role)
   - **URL Rewrite** module (from Microsoft)
   - **Application Request Routing (ARR)** (from Microsoft)
2. **Enable the proxy:** IIS Manager → server node → *Application Request Routing
   Cache* → *Server Proxy Settings* → tick **Enable proxy** → Apply.
3. **Create the site:** point it at an empty folder (IIS only proxies; it serves no
   files). Add an **https binding on 443** with your PFX certificate and the public
   hostname; add an **http binding on 80** (used only to redirect to https).
4. **Add the reverse-proxy + redirect rules:** drop the ready
   [deploy/iis-web.config](deploy/iis-web.config) into the site's root folder as
   `web.config` (it contains the rewrite to `http://127.0.0.1:8102/` and the
   80→443 redirect). ARR automatically adds the `X-Forwarded-For` header the rate
   limiter relies on.
5. **Match upload size limits:** the app accepts file attachments; IIS caps request
   bodies at ~30 MB by default. If large WBES uploads return **413**, raise
   `maxAllowedContentLength` in `web.config` to match the app's own limit in
   [server/config/uploads.js](server/config/uploads.js).

**Then verify the proxy is honest** — open
`https://portal.nrldc.in/api/health` from a browser and confirm `clientIp` equals
*your* address, not `127.0.0.1`. If it shows the proxy's address, `TRUST_PROXY_HOPS`
in `.env` is wrong; fix it and restart the service.

> Optional hardening: restrict `/api/health` to internal monitors at the IIS layer —
> it's intentionally public and unthrottled, and it discloses hostname/PID/uptime.

---

## 7. Make mail actually deliver

This is the step most often skipped and the hardest failure to see: the portal
reports a message as *sent* the moment the provider accepts it — which is not the
same as it arriving.

Fill the SMTP block in `server\.env` (these are fallbacks; once running, the live
values in **System Parameters** win). The **From** address must be on a domain whose
DNS authorises your provider — that means both:

1. the provider's **SPF** entry in the domain's `TXT` record, and
2. the provider's **DKIM** public key published as a `TXT` record.

Without both, receiving servers quarantine the mail as spoofing. Check what a domain
publishes (PowerShell has no `dig`; use `Resolve-DnsName`):

```powershell
Resolve-DnsName -Type TXT your-domain.example | Select-Object Strings
Resolve-DnsName -Type TXT _dmarc.your-domain.example | Select-Object Strings
```

If `_dmarc` says `p=quarantine`/`p=reject` and your provider isn't authorised, mail
is actively quarantined. **Fix DNS before go-live**, then prove it end-to-end: send
yourself a real OTP and confirm it lands in an inbox, not spam.

---

## 8. Set up regions (skip if single-centre)

Everything defaults to NRLDC; a single despatch centre needs no region setup. For
multiple centres, sign in as the national admin and, for each centre, add a user
with role **ADMIN** and that centre's region — they become its first administrator
and run it from there. Every admin (national included) sees only its own region;
the national role's extra powers are creating admins elsewhere and owning the
shared settings (SMTP, mail cap, OTP trust window). The mail allowance is **shared
across all regions** — adding a region adds users drawing on the same daily total.

Give **every** region an administrator; a region without one is a region nobody can
manage (the `regions` recipe in §13 reports this).

---

## 9–10. Harden, change passwords, then open the doors

**Do §7 (mail) and §8 (regions) first.** Turning OTP on while mail is broken locks
out everyone, including you.

Run the readiness check (it's a Node script — works on Windows as-is):

```powershell
node server\harden.js            # report only
node server\harden.js --fix      # turn OTP on for all accounts, clear stale lockouts
```

`--fix` deliberately does **not** touch passwords. **Change every admin password
first** — sign in as `admin@nldc`, change its password in Profile Settings, and
change any other admin accounts. `harden` lists any account still on the default
password `Password@123`.

**If you lock yourself out** (OTP on, code never arrives), the way back in is on the
server, against the DB — the Windows equivalent of `nrldc.sh unlock` (§13).

Go-live gate — all of these before you point public DNS / open the firewall:

- [ ] `/api/health` returns `production:true`, `db:connected`, correct `clientIp`
- [ ] `node server\harden.js` reports **Ready** (no ✗)
- [ ] every admin password changed off the default
- [ ] a real OTP email received in an inbox
- [ ] HTTPS valid in a browser; http→https redirect works; 8102 not reachable from outside

---

## 11. Internet-facing security review (do not skip)

This portal running on the open internet warrants a deliberate security pass with
your IT security team:

- **Prefer restricted access.** If the user base is internal (RLDC/utility staff,
  QCAs), put it behind the corporate VPN / Grid-India WAN or an **edge IP
  allow-list** rather than fully public. Open public access only if genuinely
  required.
- **Put a WAF in front** (edge appliance or cloud WAF) if it must be public.
- **Windows Firewall:** allow inbound **443** (and **80** for redirect) only. **Do
  not** create an inbound rule for **8102** — IIS reaches Node over loopback, which
  needs no rule; without a rule, 8102 is unreachable from outside. Restrict the DB
  path to the app server only.
- **Run the codebase security review** before go-live — this repo has a
  `security-review` workflow; run it and triage anything it finds. (I can run it for
  you on request.)
- **Patch cadence & monitoring:** keep Node/IIS/OS patched; alert on the service
  entering *failed* state and on `/api/health` returning non-200.
- **Rate limits:** tune `RATE_LIMIT_*` in `.env` for the real user count (defaults
  suit ~200 users).
- Review the `npm audit` advisory note in [DEPLOYMENT.md](DEPLOYMENT.md#known-advisories)
  (5 moderate, assessed not-reachable, left as-is).

---

## 12. Backups

Nothing here backs you up automatically. Have IT schedule, on the DB and the app
server respectively:

- **Database:** a regular `pg_dump nrldc_db` (IT's Postgres backup process, or a
  scheduled task running `pg_dump`).
- **Attachments:** `C:\apps\nrldc-portal\server\upload\` holds uploaded files and is
  **not** in the database — back it up alongside the dump, or a restore leaves every
  attachment link broken.

**Test a restore before you need one.**

---

## 13. Day-to-day operations — `nrldc.sh` → Windows

`nrldc.sh` is bash and won't run here. The equivalents:

| Task (`nrldc.sh …`) | On Windows |
| --- | --- |
| `start` / `stop` / `restart` | `nssm start\|stop\|restart NRLDCPortal` (or `Start/Stop-Service NRLDCPortal`) |
| `status` | `Get-Service NRLDCPortal` + `curl.exe http://localhost:8102/api/health` |
| `logs` | `Get-Content C:\apps\nrldc-portal\logs\out.log -Wait` |
| `migrate` | `node server\migrate.js` |
| `harden` / `harden --fix` | `node server\harden.js` / `node server\harden.js --fix` |
| `seed` | `$env:NODE_ENV='development'; node server\seed.js` — **DROPS data**, test only |

The remaining commands are raw SQL in `nrldc.sh`; run the same SQL against the DB
with `psql` or pgAdmin. (No psql on the box? Copy `psql.exe` from PostgreSQL's
portable binaries — it's just a client.) Escape any apostrophe in a username by
doubling it.

**Unlock an account** (clears lockout, switches its OTP off):

```sql
UPDATE users SET locked = FALSE, failed_attempts = 0, bypass_2fa = TRUE
 WHERE LOWER(username) = LOWER('admin@nrldc')
 RETURNING username, email;
```

**Promote an account to national administrator:**

```sql
UPDATE users SET role = 'SUPERADMIN', region = NULL
 WHERE LOWER(username) = LOWER('admin@nrldc')
 RETURNING username;
```

**Create a national admin from scratch** (when migrate-only left no account). Hash
the password with the app's bcrypt first, then insert. An administrator is not a
plant, so its `energy_category` is **NULL** (the portal never treats an admin as an
ISGS/RE/States filer):

```powershell
$hash = node -e "console.log(require('bcryptjs').hashSync('ChooseAStrongPassw0rd!',10))"
```
```sql
INSERT INTO users (username, name, role, region, email, password_hash,
                   energy_category, locked, failed_attempts, bypass_2fa, wbes_acronym)
VALUES ('national@grid','National Administrator','SUPERADMIN',NULL,
        'national@grid','<paste $hash>',NULL,FALSE,0,TRUE,'')
RETURNING username;
```

**Today's mail usage / regions overview:** the `mail` and `regions` queries in
[nrldc.sh](nrldc.sh) run unchanged in psql/pgAdmin.

---

## 14. Upgrading

```powershell
git pull
npm install; cd server; npm install; cd ..
npm run build                 # REQUIRED — rebuild dist\ or users see the old UI
node server\migrate.js        # additive; never drops data
nssm restart NRLDCPortal
node server\harden.js         # confirm nothing regressed
```

The server refuses to start against a schema older than the code and tells you to
run `migrate`. `migrate` is additive and never drops data.
