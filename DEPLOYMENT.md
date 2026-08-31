# Deploying to production

This is the short runbook for putting the portal in front of real users. The
full feature documentation is in [README.md](README.md); this file only covers
what is different about a live server.

Work through it in order. The ordering matters in three places, all noted below.

---

## 1. Prepare the machine

```bash
git clone <your-production-repo> nrldc-portal
cd nrldc-portal
npm install && (cd server && npm install)
```

PostgreSQL 14+ must be running and reachable. Create an empty database:

```bash
createdb nrldc_db
```

---

## 2. Configure `server/.env`

Copy `server/.env.example` to `server/.env` and fill it in. Three entries decide
whether the deployment is safe:

```bash
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
TRUST_PROXY_HOPS=1
```

**`NODE_ENV=production` is not cosmetic.** It turns on the Content-Security-Policy
and HSTS, makes a missing `SESSION_SECRET` a refusal to start rather than a
warning, and makes the destructive seeders refuse to run at all.

**`SESSION_SECRET` must be identical on every process.** Behind a load balancer
each process otherwise invents its own and rejects tokens issued by its
siblings, signing users out at random with nothing in the log to explain it.

---

## 3. Create the schema and the first accounts

```bash
NODE_ENV= node server/seed.js     # first time only — this DROPS everything
./nrldc.sh migrate                # every time after that; keeps all data
```

`seed.js` and `demo_seed.js` refuse to run when `NODE_ENV=production`, because
both drop real data and recreate accounts sharing one default password with OTP
switched off. The `NODE_ENV=` prefix above is the deliberate override, and it is
correct only on an empty database.

Never run `./nrldc.sh demo` on the production machine. It exists to make the
portal feel populated while you are evaluating it.

---

## 4. Put HTTPS in front

The server listens on plain HTTP. Passwords, OTP codes and eight-hour session
tokens all cross the network, so terminate TLS at a reverse proxy or the load
balancer and stop exposing port 3001 directly.

The application already expects this: HSTS is enabled under `NODE_ENV=production`,
and `TRUST_PROXY_HOPS` tells the rate limiter how many proxies sit in front so it
throttles the real client rather than the proxy.

---

## 5. Make mail actually deliver

This is the step most likely to be skipped, and the one whose failure is
hardest to see: the portal reports a message as *sent* once the provider accepts
it, which is not the same as the recipient receiving it.

The **From** address must be on a domain whose DNS authorises your mail
provider. That means two records on that domain:

1. The provider's SPF entry added to the domain's `TXT` record.
2. The provider's DKIM public key published as a `TXT` record.

Without both, the message fails SPF and is unaligned for DKIM, and receiving
servers quarantine it as spoofing — correctly, because that is what it looks
like. A `@gmail.com` From relayed through another provider fails for exactly
this reason.

Check what a domain currently publishes:

```bash
dig +short TXT your-domain.example | grep spf
dig +short TXT _dmarc.your-domain.example
```

If the domain publishes `p=quarantine` or `p=reject` and does not list your
provider, mail will be actively quarantined. Fix the DNS before go-live rather
than after the first person cannot log in.

Prove it end to end before continuing: send yourself a real OTP and confirm it
arrives in an inbox, not a spam folder.

---

## 6. Set up the regions

Skip this if only one despatch centre uses the portal — everything defaults to
NRLDC and needs no setup.

Otherwise, promote one account to national administrator first. Only that role
can create administrators, so without it there is no way to make the first one:

```bash
./nrldc.sh promote admin@nrldc
./nrldc.sh regions              # accounts, plants and admins per region
```

Then sign in as that account and create each region's admin from *User
Registry*, choosing the **Region** for each. Regional admins see and manage only
their own region; the national administrator sees all of them and owns the
settings that cannot be regional — SMTP, the mail allowance, the OTP trust
window.

Note the mail allowance is **shared across regions**: adding a region adds users
drawing on the same daily total, without adding headroom.

## 7. Harden, then open the doors

```bash
./nrldc.sh harden          # report what is still wrong
./nrldc.sh harden --fix    # turn OTP on for every account, clear stale lockouts
```

`--fix` deliberately does not touch passwords. Setting them all to another
shared value solves nothing, and randomising them locks everyone out with no way
to tell them. Accounts still on the default are listed so you can deal with them
deliberately — **change every admin password first.**

**Do steps 5 and 6 before this step.** Turning OTP on while mail is broken locks out the
entire user base at once, including you.

If you do lock yourself out, the way back is on the server:

```bash
./nrldc.sh unlock admin@nrldc
```

That clears the lockout and switches OTP off for that one account. It exists
because both switches that disable OTP otherwise live behind a login — so if the
last admin turns their own OTP on and the code never arrives, nobody left in the
portal can undo it.

---

## 8. Start it

```bash
./nrldc.sh start
./nrldc.sh status
```

Under a process manager, run `node server/index.js` with `NODE_ENV=production`
and the same `SESSION_SECRET` for every instance.

---

## Day-to-day

| Command | What it tells you |
| --- | --- |
| `./nrldc.sh status` | What is running, on which port, and whether it is healthy |
| `./nrldc.sh mail` | Today's email usage against the daily cap |
| `./nrldc.sh harden` | Whether the live settings are still correct |
| `./nrldc.sh regions` | Accounts, plants and admins in each region |
| `./nrldc.sh logs` | The server log, followed |

The mail allowance is the tightest resource the portal has. `./nrldc.sh mail`
shows usage against the cap; held-back messages mean the cap was reached, and
the counter resets at midnight. See
[Email Budget](README.md#-email-budget) for the arithmetic behind the defaults.

---

## Upgrading

```bash
git pull
npm install && (cd server && npm install)
./nrldc.sh migrate      # applies schema changes, keeps all data
./nrldc.sh restart      # rebuilds the frontend and restarts
./nrldc.sh harden       # confirm nothing regressed
```

`migrate` is additive and never drops data. The server refuses to start against
a schema older than the code, and says which command to run.

---

## Backups

Nothing here backs the database up for you.

```bash
pg_dump nrldc_db > nrldc_$(date +%F).sql
```

Uploaded attachments live in `server/upload/` and are **not** in the database —
back that directory up alongside the dump, or restoring will leave every
attachment link broken.

Test a restore before you need one.
