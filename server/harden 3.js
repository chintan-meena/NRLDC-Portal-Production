#!/usr/bin/env node
/**
 * harden.js — Check, and optionally fix, the settings that matter on a live server.
 *
 * Both seeders create accounts with OTP switched off and the same default
 * password, which is right for testing and wrong the moment real users exist.
 * Nothing in the portal shows you that at a glance, so this does: it reports
 * every account still on the default password, every account exempt from OTP,
 * and the handful of environment settings that decide whether the deployment is
 * safe.
 *
 *   node harden.js           report only, change nothing
 *   node harden.js --fix     turn OTP on for every account, and unlock any
 *                            account left locked by testing
 *
 * --fix deliberately does NOT change passwords. Setting them all to another
 * shared value would solve nothing, and setting them to random values would
 * lock everyone out with no way to tell them. Accounts still on the default are
 * listed so they can be dealt with deliberately.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { DEFAULT_PASSWORD } = require('./utils/password');
const { getSetting } = require('./utils/settings');
const { REGIONS } = require('./middleware/region');

const FIX = process.argv.includes('--fix');

const BOLD = '\x1b[1m', DIM = '\x1b[2m', OFF = '\x1b[0m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m';

let problems = 0, warnings = 0;

const ok    = (m) => console.log(`  ${GREEN}✓${OFF} ${m}`);
const bad   = (m) => { problems++; console.log(`  ${RED}✗${OFF} ${m}`); };
const warn  = (m) => { warnings++; console.log(`  ${YELLOW}!${OFF} ${m}`); };
const note  = (m) => console.log(`    ${DIM}${m}${OFF}`);
const head  = (m) => console.log(`\n${BOLD}${m}${OFF}`);

async function config(key, region = null) {
  return getSetting(key, region, null);
}

(async () => {
  console.log(`\n${BOLD}Production readiness${OFF}${DIM}${FIX ? '  (applying fixes)' : '  (report only)'}${OFF}`);

  // ── Environment ──────────────────────────────────────────────────────────
  head('Environment');

  if (process.env.NODE_ENV === 'production') {
    ok('NODE_ENV is "production" — CSP and HSTS are on');
  } else {
    bad(`NODE_ENV is ${process.env.NODE_ENV ? `"${process.env.NODE_ENV}"` : 'unset'}, not "production"`);
    note('Without it the Content-Security-Policy and HSTS are off, and a missing');
    note('SESSION_SECRET is only a warning instead of a refusal to start.');
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim() === '' || secret === 'nrldc_secret_key_2026') {
    bad('SESSION_SECRET is unset or still the shipped default');
    note('Generate one with: openssl rand -hex 32');
    note('Behind a load balancer every process must share the same value.');
  } else if (secret.length < 32) {
    warn(`SESSION_SECRET is only ${secret.length} characters — use at least 32`);
  } else {
    ok(`SESSION_SECRET is set (${secret.length} characters)`);
  }

  // ── Accounts ─────────────────────────────────────────────────────────────
  head('Accounts');

  const users = await pool.query(
    'SELECT username, role, region, password_hash, bypass_2fa, locked FROM users ORDER BY role, username'
  );
  const total = users.rows.length;

  // Which regions are actually in use. A region with no accounts needs no
  // checking, and reporting on all five would be noise.
  const activeRegions = [...new Set(users.rows.map(u => u.region))].sort();
  ok(`${total} account(s) across ${activeRegions.length} region(s): ${activeRegions.join(', ')}`);

  const admins = users.rows.filter(u => u.role === 'ADMIN');
  const superAdmins = users.rows.filter(u => u.role === 'SUPERADMIN');
  // Every admin is confined to one region, so a region without one is a region
  // nobody can manage — the national administrator cannot reach into it either.
  const administered = new Set([...admins, ...superAdmins].map(a => a.region));
  const orphanRegions = activeRegions.filter(r => !administered.has(r));
  if (orphanRegions.length > 0) {
    bad(`No administrator for: ${orphanRegions.join(', ')}`);
    note('Those accounts cannot be managed by anyone — admins see only their own');
    note('region, the national administrator included. Give each region an admin.');
  } else {
    ok('Every region in use has an administrator');
  }
  if (superAdmins.length === 0) {
    warn('No national administrator — no new region can be opened');
    note('Run: ./nrldc.sh promote <username>');
  } else {
    ok(`National administrator: ${superAdmins.map(u => `${u.username} (${u.region})`).join(', ')}`);
  }

  const onDefault = [];
  for (const u of users.rows) {
    if (await bcrypt.compare(DEFAULT_PASSWORD, u.password_hash)) onDefault.push(u);
  }
  if (onDefault.length === 0) {
    ok(`No account is using the default password (checked all ${total})`);
  } else {
    const privileged = onDefault.filter(u => ['ADMIN', 'SUPERADMIN'].includes(u.role));
    bad(`${onDefault.length} of ${total} accounts still use the default password "${DEFAULT_PASSWORD}"`);
    if (privileged.length > 0) {
      note(`including ${privileged.length} administrator account(s): `
        + privileged.map(a => `${a.username} (${a.role === 'SUPERADMIN' ? 'national' : a.region})`).join(', '));
    }
    const sample = onDefault.slice(0, 8).map(u => u.username).join(', ');
    note(`${sample}${onDefault.length > 8 ? `, and ${onDefault.length - 8} more` : ''}`);
    note('Change the admin passwords first, then have users change theirs on first sign-in.');
  }

  const bypassed = users.rows.filter(u => u.bypass_2fa);
  if (bypassed.length === 0) {
    ok(`Every account requires an OTP at login`);
  } else if (FIX) {
    await pool.query('UPDATE users SET bypass_2fa = FALSE');
    ok(`Turned OTP on for ${bypassed.length} account(s) that had it bypassed`);
    note('Confirm mail actually delivers before anyone tries to sign in.');
  } else {
    bad(`${bypassed.length} of ${total} accounts are exempt from OTP`);
    note('Both seeders create accounts this way. Re-run with --fix to turn OTP on for all.');
  }

  const locked = users.rows.filter(u => u.locked);
  if (locked.length === 0) {
    ok('No account is locked out');
  } else if (FIX) {
    await pool.query('UPDATE users SET locked = FALSE, failed_attempts = 0');
    ok(`Unlocked ${locked.length} account(s)`);
  } else {
    warn(`${locked.length} account(s) are locked: ${locked.map(u => u.username).join(', ')}`);
  }

  // ── Portal settings ──────────────────────────────────────────────────────
  head('Portal settings');

  // require2FA is a regional setting, so every region in use needs checking.
  const otpOff = [];
  for (const r of activeRegions) {
    const v = await config('require2FA', r);
    if (String(v).toLowerCase() === 'false') otpOff.push(r);
  }
  if (otpOff.length > 0) {
    bad(`require2FA is OFF for: ${otpOff.join(', ')} — those users sign in on their password alone`);
    note('Turn it on in System Parameters once mail delivery is proven.');
  } else {
    ok(`require2FA is on in every region in use`);
  }

  const from = await config('smtpFrom');
  const host = await config('smtpHost');
  if (!from || /example|your[-_]/i.test(from)) {
    bad(`smtpFrom is not set to a real address (${from || 'unset'})`);
  } else {
    const domain = (from.match(/@([^>\s]+)/) || [])[1];
    ok(`Mail relays through ${host || 'unset'} as ${from}`);
    warn(`Confirm ${domain} publishes the SPF and DKIM records for your mail provider`);
    note('Without them the provider accepts the message and the recipient quarantines it.');
    note(`Check with:  dig +short TXT ${domain} | grep spf`);
  }

  // The mail allowance is one shared pot, so the estimate is national — every
  // region's users draw on the same 300 a day.
  const cap = parseInt(await config('mailDailyCap') || '0', 10);
  const trust = parseInt(await config('otpTrustDays') ?? '7', 10);
  const perDay = trust > 0 ? Math.ceil(total / trust) : total * 2;
  if (cap > 0 && perDay > cap) {
    bad(`Expected ~${perDay} codes a day across all regions at otpTrustDays=${trust}, over the ${cap} cap`);
    note('The allowance is shared between regions. Raise otpTrustDays, or the cap if the plan allows.');
  } else {
    ok(`~${perDay} codes a day expected across all regions at otpTrustDays=${trust} (shared cap ${cap})`);
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  console.log('');
  if (problems === 0 && warnings === 0) {
    console.log(`${GREEN}${BOLD}Ready.${OFF} Nothing blocking found.`);
  } else if (problems === 0) {
    console.log(`${YELLOW}${BOLD}Ready, with ${warnings} thing(s) to confirm by hand.${OFF}`);
  } else {
    console.log(`${RED}${BOLD}Not ready: ${problems} problem(s)${OFF}${warnings ? `, plus ${warnings} to confirm` : ''}.`);
    if (!FIX) console.log(`${DIM}Some can be fixed with:  ./nrldc.sh harden --fix${OFF}`);
  }
  console.log('');

  await pool.end();
  process.exit(problems > 0 ? 1 : 0);
})().catch(err => {
  console.error('\n[HARDEN] Could not complete the check:', err.message);
  process.exit(2);
});
