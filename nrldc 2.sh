#!/usr/bin/env bash
#
# nrldc.sh — NRLDC Schedule Discrepancy Portal control script (macOS / Linux)
#
#   ./nrldc.sh setup           first-time setup: deps, database, schema
#   ./nrldc.sh start           start in the background (production build)
#   ./nrldc.sh start --dev     start in the background (Vite dev server)
#   ./nrldc.sh stop            stop whatever is running
#   ./nrldc.sh restart         stop then start again — safe if nothing is running
#   ./nrldc.sh status          what is running, on which ports, and is it healthy
#   ./nrldc.sh logs            follow the server log (Ctrl+C to stop watching)
#   ./nrldc.sh migrate         apply schema updates, keeping all data
#   ./nrldc.sh seed            DROP everything and reseed (asks first)
#   ./nrldc.sh demo            load realistic demo data: 150 users, 8 QCAs,
#                              1000 discrepancies with attachments
#   ./nrldc.sh unlock <user>   get an account back in: clears the lockout and
#                              switches OFF its OTP requirement
#   ./nrldc.sh mail            today's email usage against the daily cap
#   ./nrldc.sh harden          check the settings that matter on a live server
#   ./nrldc.sh harden --fix    ...and turn OTP on for every account
#
# restart is the one to use after pulling changes: it stops the running
# instance, rebuilds, and starts again.

set -uo pipefail

cd "$(dirname "$0")"
ROOT="$PWD"
RUN_DIR="$ROOT/.run"
PID_FILE="$RUN_DIR/server.pid"
MODE_FILE="$RUN_DIR/mode"
LOG_FILE="$RUN_DIR/server.log"

mkdir -p "$RUN_DIR"

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
info() { printf '  %s·%s %s\n' "$DIM" "$OFF" "$*"; }
err()  { printf '  %s✗%s %s\n' "$RED" "$OFF" "$*" >&2; }
die()  { err "$*"; exit 1; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$OFF"; }

# ─── Configuration, read without executing server/.env ──────────────────────
# The file legitimately contains characters like < and > (in SMTP_FROM) that
# the shell would treat as redirection, so it is parsed rather than sourced.
env_get() {
  [ -f server/.env ] || return 0
  grep -E "^[[:space:]]*$1=" server/.env 2>/dev/null | tail -1 \
    | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
                         -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

PORT="$(env_get PORT)";           PORT="${PORT:-3001}"
PGHOST="$(env_get PGHOST)";       PGHOST="${PGHOST:-localhost}"
PGPORT="$(env_get PGPORT)";       PGPORT="${PGPORT:-5432}"
PGDATABASE="$(env_get PGDATABASE)"; PGDATABASE="${PGDATABASE:-nrldc_db}"
PGUSER="$(env_get PGUSER)";       PGUSER="${PGUSER:-postgres}"
VITE_PORT=5173

# ─── Process helpers ────────────────────────────────────────────────────────

running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid; pid="$(cat "$PID_FILE" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

port_pids() { lsof -ti:"$1" 2>/dev/null; }

# Launch a command fully detached from this terminal.
#
# stdin has to come from /dev/null and stdout/stderr from the log file, or the
# child keeps the terminal's pipe open and `./nrldc.sh start` appears to hang
# even though the server is up. setsid, where available, also puts the child in
# its own process group so the whole tree can be signalled at once.
spawn_detached() {
  if command -v setsid >/dev/null 2>&1; then
    setsid env "$@" >"$LOG_FILE" 2>&1 </dev/null &
  else
    env "$@" >"$LOG_FILE" 2>&1 </dev/null &
  fi
  echo $! > "$PID_FILE"
  disown 2>/dev/null || true
}

# Stop a process group politely, then firmly.
stop_pid() {
  local pid="$1" name="$2"
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || return 1
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || { ok "$name stopped"; return 0; }
    sleep 0.25
  done
  warn "$name did not stop in time — forcing"
  kill -9 "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
  return 0
}

# ─── Commands ───────────────────────────────────────────────────────────────

cmd_stop() {
  step "Stopping"
  local stopped=0
  local pid
  if pid="$(running_pid)"; then
    stop_pid "$pid" "server (pid $pid)"; stopped=1
  fi
  rm -f "$PID_FILE" "$MODE_FILE"

  # Anything still holding the ports (a stray run, or one started by hand).
  for p in "$PORT" "$VITE_PORT"; do
    local leftovers; leftovers="$(port_pids "$p")"
    if [ -n "$leftovers" ]; then
      # shellcheck disable=SC2086
      kill -9 $leftovers 2>/dev/null
      ok "freed port $p"
      stopped=1
    fi
  done

  [ "$stopped" -eq 1 ] || info "nothing was running"
}

cmd_status() {
  step "Status"
  local pid
  if pid="$(running_pid)"; then
    ok "running (pid $pid, mode $(cat "$MODE_FILE" 2>/dev/null || echo unknown))"
  else
    info "no server started by this script"
  fi

  for p in "$PORT" "$VITE_PORT"; do
    local pids; pids="$(port_pids "$p" | tr '\n' ' ')"
    if [ -n "$pids" ]; then ok "port $p in use by: $pids"; else info "port $p free"; fi
  done

  local health
  health="$(curl -sf --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)"
  if [ -n "$health" ]; then ok "health: $health"; else info "health endpoint not answering"; fi
  say ""
  info "log file: $LOG_FILE"
}

cmd_setup() {
  step "[1/4] Prerequisites"
  command -v node >/dev/null 2>&1 || die "Node.js is not installed. Try: brew install node"
  local major; major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  [ "$major" -ge 18 ] || die "Node.js 18 or newer is required (found $(node -v))."
  ok "Node.js $(node -v), npm $(npm -v)"

  step "[2/4] Configuration"
  if [ ! -f server/.env ]; then
    [ -f server/.env.example ] || die "server/.env.example is missing."
    cp server/.env.example server/.env
    warn "Created server/.env from the template."
    say  "    Set PGPASSWORD and SESSION_SECRET in it, then run setup again."
    say  "    ${DIM}node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"${OFF}"
    exit 1
  fi
  ok "server/.env present"
  local secret; secret="$(env_get SESSION_SECRET)"
  if [ -z "$secret" ] || [ "$secret" = "replace_with_a_long_random_string" ] || [ "$secret" = "nrldc_secret_key_2026" ]; then
    warn "SESSION_SECRET is unset or still the default — everyone is logged out on each restart."
  else
    ok "SESSION_SECRET set"
  fi

  step "[3/4] Database"
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h "$PGHOST" -p "$PGPORT" -q \
      || die "PostgreSQL is not accepting connections on $PGHOST:$PGPORT. Try: brew services start postgresql@16"
    ok "PostgreSQL reachable at $PGHOST:$PGPORT"
  fi
  if command -v psql >/dev/null 2>&1; then
    if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$PGDATABASE"; then
      ok "database '$PGDATABASE' exists"
    else
      createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE" 2>/dev/null \
        && ok "created database '$PGDATABASE'" \
        || die "Could not create '$PGDATABASE'. Create it manually: createdb $PGDATABASE"
    fi
  fi

  step "[4/4] Dependencies and schema"
  [ -d node_modules ] || { say "  installing frontend packages..."; npm install --silent; }
  [ -d server/node_modules ] || { say "  installing backend packages..."; (cd server && npm install --silent); }
  ok "dependencies installed"
  (cd server && node migrate.js) || die "Schema migration failed."

  step "Setup complete"
  say "  Start the portal with:  ${BOLD}./nrldc.sh start${OFF}"
  say "  If this is a brand new database, seed test accounts:  ${BOLD}./nrldc.sh seed${OFF}"
}

cmd_migrate() { step "Applying schema updates (data preserved)"; (cd server && node migrate.js); }

cmd_seed() {
  step "Reseeding"
  warn "This DROPS every table in '$PGDATABASE' and recreates it."
  printf '  Type %syes%s to continue: ' "$BOLD" "$OFF"
  read -r reply
  [ "$reply" = "yes" ] || die "Aborted. Use ./nrldc.sh migrate to update the schema without losing data."
  (cd server && node seed.js) && ok "seeded — every account uses the password Password@123"
}

cmd_demo() {
  step "Loading demo data"
  say "  150 plant users (124 RE, 17 ISGS, 9 States), 8 QCAs coordinating 115"
  say "  RE plants, and 1000 discrepancies with real attachments."
  say ""
  warn "This replaces all discrepancies and every non-admin user."
  say "  ${DIM}Admin accounts are left alone.${OFF}"
  (cd server && node demo_seed.js "$@")
}

cmd_start() {
  local mode="prod"
  [ "${1:-}" = "--dev" ] && mode="dev"

  if running_pid >/dev/null; then
    warn "already running (pid $(running_pid)). Use ./nrldc.sh restart"
    exit 1
  fi
  for p in "$PORT" "$VITE_PORT"; do
    if [ -n "$(port_pids "$p")" ]; then
      die "port $p is already in use. Run ./nrldc.sh stop first."
    fi
  done

  [ -f server/.env ] || die "server/.env is missing. Run ./nrldc.sh setup first."
  [ -d node_modules ] && [ -d server/node_modules ] || die "Dependencies are missing. Run ./nrldc.sh setup first."

  if [ "$mode" = "prod" ]; then
    step "Building the frontend"
    npm run build >"$RUN_DIR/build.log" 2>&1 || { tail -20 "$RUN_DIR/build.log"; die "Build failed — see $RUN_DIR/build.log"; }
    ok "built into dist/"

    step "Starting (production)"
    spawn_detached NODE_ENV=production node server/index.js
    echo "production" > "$MODE_FILE"
  else
    step "Starting (development, with Vite)"
    spawn_detached npm run dev:all
    echo "development" > "$MODE_FILE"
  fi

  # Wait for the health endpoint rather than guessing.
  local url="http://localhost:$PORT/api/health"
  for _ in $(seq 1 60); do
    if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then
      ok "server is up (pid $(cat "$PID_FILE"))"
      say ""
      if [ "$mode" = "prod" ]; then
        say "  ${BOLD}Portal:${OFF} ${BLUE}http://localhost:$PORT${OFF}   ${DIM}(app and API on one port)${OFF}"
      else
        say "  ${BOLD}Portal:${OFF} ${BLUE}http://localhost:$VITE_PORT${OFF}   ${DIM}(Vite dev server)${OFF}"
        say "  ${BOLD}API:${OFF}    http://localhost:$PORT/api/health"
      fi
      say "  ${BOLD}Login:${OFF}  admin@nrldc / Password@123"
      say ""
      say "  ${DIM}./nrldc.sh logs    follow the log${OFF}"
      say "  ${DIM}./nrldc.sh stop    stop the server${OFF}"
      say ""
      return 0
    fi
    if ! running_pid >/dev/null; then
      err "the server exited during start-up. Last lines:"
      tail -20 "$LOG_FILE" | sed 's/^/    /'
      rm -f "$PID_FILE" "$MODE_FILE"
      exit 1
    fi
    sleep 0.5
  done

  err "server did not become healthy in 30s. Last lines:"
  tail -20 "$LOG_FILE" | sed 's/^/    /'
  exit 1
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start "$@"
}

# Get an account back in without needing another account to do it with.
#
# This exists for the one failure that has no way out from inside the portal:
# the last admin turns their own OTP on, the code does not arrive, and there is
# nobody left who can switch it off for them. It clears the lockout, resets the
# failed-attempt count, and switches OTP off for that account only.
cmd_unlock() {
  local user="${1:-}"
  [ -n "$user" ] || die "Which account? e.g. ./nrldc.sh unlock admin@nrldc"

  step "Restoring access for $user"
  local out
  out=$(psql -d "${PGDATABASE:-nrldc_db}" -tAqc "
    UPDATE users
       SET locked = FALSE, failed_attempts = 0, bypass_2fa = TRUE
     WHERE LOWER(username) = LOWER('${user//\'/\'\'}')
    RETURNING username || ' | ' || email;
  " 2>&1) || die "Could not reach the database: $out"

  if [ -z "$out" ]; then
    die "No account called \"$user\". List them with:
    psql -d ${PGDATABASE:-nrldc_db} -c 'SELECT username, role FROM users ORDER BY username'"
  fi

  say "  ${GREEN}OK${OFF} $out"
  say "  ${DIM}signs in with its password alone — no OTP${OFF}"
  say ""
  say "  ${DIM}Turn OTP back on from User Registry once email is working again.${OFF}"
}

# What the day's mail has been spent on. The plan is small enough that this is
# worth being able to check without signing in.
cmd_mail() {
  step "Email usage today"
  psql -d "${PGDATABASE:-nrldc_db}" -c "
    SELECT day,
           sent,
           (SELECT value FROM config WHERE key = 'mailDailyCap') AS cap,
           suppressed AS held_back,
           updated_at
      FROM mail_quota
     WHERE day = CURRENT_DATE;" 2>&1 || die "Could not reach the database."
  say "  ${DIM}Held-back messages mean the cap was hit; the counter resets at midnight.${OFF}"
}

# Report — and optionally fix — the settings that are wrong on a live server
# but right on a test one. Run this before opening the portal to real users.
cmd_harden() { (cd server && node harden.js "$@"); }

cmd_logs() {
  [ -f "$LOG_FILE" ] || die "No log file yet at $LOG_FILE"
  say "${DIM}following $LOG_FILE — Ctrl+C to stop${OFF}"
  tail -f "$LOG_FILE"
}

# ─── Dispatch ───────────────────────────────────────────────────────────────

case "${1:-}" in
  setup)   cmd_setup ;;
  start)   shift; cmd_start "${1:-}" ;;
  stop)    cmd_stop ;;
  restart) shift; cmd_restart "${1:-}" ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  migrate) cmd_migrate ;;
  seed)    cmd_seed ;;
  demo)    shift; cmd_demo "$@" ;;
  unlock)  shift; cmd_unlock "${1:-}" ;;
  mail)    cmd_mail ;;
  harden)  shift; cmd_harden "$@" ;;
  ""|-h|--help|help)
    sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) die "Unknown command: $1 (try ./nrldc.sh help)" ;;
esac
