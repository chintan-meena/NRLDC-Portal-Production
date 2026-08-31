#!/usr/bin/env bash
#
# start.sh — NRLDC Schedule Discrepancy Portal launcher (macOS / Linux)
#
#   NOTE: ./nrldc.sh is the fuller control script — it can start, stop, restart
#   and report status, and it runs the server in the background. Use this one
#   when you just want a foreground dev session.
#
#   ./start.sh             install deps if needed, then run backend + frontend
#   ./start.sh --migrate   apply schema changes to an existing database first
#                          (keeps all data — use this after pulling updates)
#   ./start.sh --seed      DROP all tables, recreate them and seed test accounts
#   ./start.sh --check     run preflight checks only, start nothing
#
# The macOS counterpart of start.bat. Unlike that script this one checks its
# prerequisites first and tells you exactly what is wrong, rather than failing
# somewhere inside npm.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$PWD"

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '  %s✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$OFF"; }

SEED=0; CHECK_ONLY=0; MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --seed)    SEED=1 ;;
    --migrate) MIGRATE=1 ;;
    --check)   CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

printf '%s\n' "${BLUE}=============================================================="
printf '%s\n' "   NRLDC SCHEDULE DISCREPANCY MONITORING PORTAL"
printf '%s\n' "==============================================================${OFF}"

# ─── 1. Prerequisites ────────────────────────────────────────────────────────
step "[1/5] Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install it with: brew install node"
NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18 or newer is required (found $(node -v))."
ok "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm is not installed (it ships with Node.js)."
ok "npm $(npm -v)"

# ─── 2. Configuration ────────────────────────────────────────────────────────
step "[2/5] Checking configuration"

if [ ! -f server/.env ]; then
  if [ -f server/.env.example ]; then
    cp server/.env.example server/.env
    warn "Created server/.env from the template."
    say  "    ${DIM}Edit it now and set PGPASSWORD and SESSION_SECRET, then re-run.${OFF}"
    say  "    ${DIM}Generate a secret with:${OFF}"
    say  "    ${DIM}  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"${OFF}"
    exit 1
  fi
  die "server/.env is missing and there is no server/.env.example to copy."
fi
ok "server/.env present"

# Read values out of server/.env WITHOUT sourcing it — the file legitimately
# contains characters like < and > (in SMTP_FROM) that the shell would try to
# interpret as redirection.
env_get() {
  grep -E "^[[:space:]]*$1=" server/.env 2>/dev/null | tail -1 \
    | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

PGHOST="$(env_get PGHOST)";       PGHOST="${PGHOST:-localhost}"
PGPORT="$(env_get PGPORT)";       PGPORT="${PGPORT:-5432}"
PGDATABASE="$(env_get PGDATABASE)"; PGDATABASE="${PGDATABASE:-nrldc_db}"
PGUSER="$(env_get PGUSER)";       PGUSER="${PGUSER:-postgres}"
PORT="$(env_get PORT)";           PORT="${PORT:-3001}"
SESSION_SECRET="$(env_get SESSION_SECRET)"

if [ -z "${SESSION_SECRET:-}" ] || [ "${SESSION_SECRET}" = "replace_with_a_long_random_string" ] || [ "${SESSION_SECRET}" = "nrldc_secret_key_2026" ]; then
  warn "SESSION_SECRET is not set — everyone will be logged out on each restart."
  say  "    ${DIM}node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"${OFF}"
else
  ok "SESSION_SECRET set"
fi

# ─── 3. PostgreSQL ───────────────────────────────────────────────────────────
step "[3/5] Checking PostgreSQL"

if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h "$PGHOST" -p "$PGPORT" -q \
    || die "PostgreSQL is not accepting connections on $PGHOST:$PGPORT. Start it with: brew services start postgresql@16"
  ok "PostgreSQL reachable at $PGHOST:$PGPORT"
else
  warn "pg_isready not found — skipping the connection check."
fi

if command -v psql >/dev/null 2>&1; then
  if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$PGDATABASE"; then
    ok "Database '$PGDATABASE' exists"
  else
    warn "Database '$PGDATABASE' not found. Creating it..."
    createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE" \
      && ok "Created database '$PGDATABASE'" \
      || die "Could not create '$PGDATABASE'. Create it manually: createdb $PGDATABASE"
    SEED=1
  fi
fi

# ─── 4. Dependencies and seeding ─────────────────────────────────────────────
step "[4/5] Installing dependencies"

if [ ! -d node_modules ]; then
  say "  Installing frontend packages (first run, this takes a minute)..."
  npm install --silent
else
  ok "Frontend packages present"
fi

if [ ! -d server/node_modules ]; then
  say "  Installing backend packages..."
  (cd server && npm install --silent)
else
  ok "Backend packages present"
fi

if [ "$SEED" -eq 1 ]; then
  say ""
  warn "Seeding DROPS every existing table in '$PGDATABASE'."
  printf '  Type %syes%s to continue: ' "$BOLD" "$OFF"
  read -r reply
  [ "$reply" = "yes" ] || die "Aborted. Use --migrate to update the schema without losing data."
  (cd server && node seed.js)
  ok "Database seeded — all accounts use the password Password@123"
elif [ "$MIGRATE" -eq 1 ]; then
  say ""
  say "  Applying schema updates (data is preserved)..."
  (cd server && node migrate.js)
fi

# ─── 5. Launch ───────────────────────────────────────────────────────────────
if [ "$CHECK_ONLY" -eq 1 ]; then
  step "Preflight checks passed. Run ./start.sh to launch."
  exit 0
fi

step "[5/5] Starting servers"

for p in "$PORT" 5173; do
  if lsof -ti:"$p" >/dev/null 2>&1; then
    die "Port $p is already in use. Free it with: kill \$(lsof -ti:$p)"
  fi
done
ok "Ports $PORT and 5173 are free"

say ""
say "  ${BOLD}Portal:${OFF}  ${BLUE}http://localhost:5173${OFF}"
say "  ${BOLD}API:${OFF}     http://localhost:$PORT/api/health"
say "  ${BOLD}Login:${OFF}   admin@nrldc  /  Password@123   ${DIM}(admin)${OFF}"
say "           user@nrldc   /  Password@123   ${DIM}(plant user)${OFF}"
say ""
say "  ${DIM}Press Ctrl+C to stop both servers.${OFF}"
say ""

# Open the browser once Vite is actually serving.
if command -v open >/dev/null 2>&1; then
  (
    for _ in $(seq 1 40); do
      if curl -sf http://localhost:5173 >/dev/null 2>&1; then open http://localhost:5173; break; fi
      sleep 0.5
    done
  ) &
fi

# npm run dev:all runs the backend and Vite together; Ctrl+C stops both.
exec npm run dev:all
