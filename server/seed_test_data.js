#!/usr/bin/env node
/**
 * seed_test_data.js — Additive, re-runnable test data for NRLDC / ERLDC / WRLDC.
 *
 *   node server/seed_test_data.js            (from the project root)
 *
 * Unlike seed.js / demo_seed.js this NEVER drops the WBES register, the admins,
 * or any pre-existing real accounts/discrepancies. Everything it creates is
 * tagged so it can be removed and re-created cleanly:
 *   - accounts      → email ends in "@seed.local"
 *   - plants / QCAs → wbes_acronym starts with "SEED"
 * On each run it first deletes its own previous output (cascading through
 * discrepancies, assignments and transfers), then re-inserts.
 *
 * Produces, as if the portal had been running for a year:
 *   NRLDC — full spread of categories + 5 QCAs coordinating solar/wind/BESS
 *   ERLDC — full spread of categories, NO QCA (RE plants are independent)
 *   WRLDC — full spread of categories + 2 QCAs
 *   a handful of past (Approved) transfers, plus live Pending / Rejected ones
 *   ~5–10 discrepancies per day across the year, in every status
 *
 * Every seeded account signs in with the standard default password and has OTP
 * bypassed, so the portal is usable without a mail server.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { withTransaction } = require('./db');
const { DEFAULT_PASSWORD } = require('./utils/password');
const { usernameFromAcronym } = require('./utils/usernames');
const { condense } = require('./utils/timeBlocks');
const { DISCREPANCY_TYPES } = require('./utils/discrepancyTypes');
const { resolveRouting } = require('./utils/trade');

const SEED_EMAIL = 'seed.local';   // marker on every account this script creates

// ─── Deterministic randomness, so re-running gives the same shape ────────────
let seed = 20260905;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;

const pad = (x) => String(x).padStart(2, '0');
function ymd(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function ymdhms(daysAgo, h, m) {
  return `${ymd(daysAgo)} ${pad(h)}:${pad(m)}:00`;
}

// ─── What each region contains ───────────────────────────────────────────────
// Conventional plants: one plant user each (ISGS / States / Traders).
// RE plants: solar / wind / BESS — some coordinated by a QCA, some independent.
const REGIONS = {
  NRLDC: {
    weight: 0.45,
    conventional: [
      ['SEEDNR_SINGRAULI_TH', 'Singrauli Super Thermal (NR)', 'ISGS', 'THERMAL'],
      ['SEEDNR_TEHRI_HY',     'Tehri Hydro Complex (NR)',     'ISGS', 'HYDRO'],
      ['SEEDNR_UP_STATE',     'Uttar Pradesh State Utility',  'States', null],
      ['SEEDNR_RAJ_STATE',    'Rajasthan State Utility',      'States', null],
      ['SEEDNR_NR_TRADER',    'Northern Power Trader',        'Traders', null],
    ],
    re: [
      ['SEEDNR_BHADLA_S1',   'Bhadla Solar Park',      'Solar'],
      ['SEEDNR_NOKH_S1',     'Nokh Solar Park',        'Solar'],
      ['SEEDNR_FGARH_S1',    'Fatehgarh Solar',        'Solar'],
      ['SEEDNR_BIKANER_S1',  'Bikaner Solar',          'Solar'],
      ['SEEDNR_JSLMR_W1',    'Jaisalmer Wind Farm',    'Wind'],
      ['SEEDNR_DEVIKOT_W1',  'Devikot Wind Farm',      'Wind'],
      ['SEEDNR_NEEM_B1',     'Neemrana BESS',          'BESS'],
      ['SEEDNR_POKHRAN_W1',  'Pokhran Wind Farm',      'Wind'],   // independent
      ['SEEDNR_FGARH_B1',    'Fatehgarh BESS',         'BESS'],   // independent
      ['SEEDNR_CHURU_S1',    'Churu Solar',            'Solar'],  // independent
    ],
    independentCount: 3,   // the last N RE plants get their own USER, no QCA
    qcas: [
      ['SEEDQCA_THAR_NR',   'Thar Solar Coordination Services', 'Thar Solar QCA'],
      ['SEEDQCA_MARU_NR',   'Marudhara Renewable Aggregators',  'Marudhara QCA'],
      ['SEEDQCA_ARAV_NR',   'Aravalli Green Coordination',      'Aravalli Green QCA'],
      ['SEEDQCA_NGRID_NR',  'North Grid RE Services',           'North Grid QCA'],
      ['SEEDQCA_SATLUJ_NR', 'Satluj Renewable Coordination',    'Satluj RE QCA'],
    ],
  },
  ERLDC: {
    weight: 0.20,
    conventional: [
      ['SEEDER_FARAKKA_TH', 'Farakka Super Thermal (ER)',  'ISGS', 'THERMAL'],
      ['SEEDER_TEESTA_HY',  'Teesta Hydro (ER)',           'ISGS', 'HYDRO'],
      ['SEEDER_WB_STATE',   'West Bengal State Utility',    'States', null],
      ['SEEDER_ODI_STATE',  'Odisha State Utility',         'States', null],
      ['SEEDER_ER_TRADER',  'Eastern Power Trader',         'Traders', null],
    ],
    re: [
      ['SEEDER_RGNTH_S1',   'Raghunathpur Solar', 'Solar'],
      ['SEEDER_DALKHOLA_S1','Dalkhola Solar',     'Solar'],
      ['SEEDER_FARAKKA_B1', 'Farakka BESS',       'BESS'],
    ],
    independentCount: 3,   // NO QCA in ERLDC — every RE plant is independent
    qcas: [],
  },
  WRLDC: {
    weight: 0.35,
    conventional: [
      ['SEEDWR_MUNDRA_TH', 'Mundra Thermal (WR)',        'ISGS', 'THERMAL'],
      ['SEEDWR_SSP_HY',    'Sardar Sarovar Hydro (WR)',  'ISGS', 'HYDRO'],
      ['SEEDWR_GUJ_STATE', 'Gujarat State Utility',      'States', null],
      ['SEEDWR_MAH_STATE', 'Maharashtra State Utility',  'States', null],
      ['SEEDWR_WR_TRADER', 'Western Power Trader',       'Traders', null],
    ],
    re: [
      ['SEEDWR_KHAVDA_S1',  'Khavda Solar Park',  'Solar'],
      ['SEEDWR_CHRNK_S1',   'Charanka Solar',     'Solar'],
      ['SEEDWR_DHOLERA_S1', 'Dholera Solar',      'Solar'],
      ['SEEDWR_KUTCH_W1',   'Kutch Wind Farm',    'Wind'],
      ['SEEDWR_KHAVDA_B1',  'Khavda BESS',        'BESS'],
      ['SEEDWR_SATARA_W1',  'Satara Wind Farm',   'Wind'],   // independent
      ['SEEDWR_PIPAVAV_B1', 'Pipavav BESS',       'BESS'],   // independent
    ],
    independentCount: 2,
    qcas: [
      ['SEEDQCA_SARDAR_WR',  'Sardar Renewable Coordination', 'Sardar RE QCA'],
      ['SEEDQCA_NARMADA_WR', 'Narmada Green Aggregators',     'Narmada QCA'],
    ],
  },
};

// Which QCA (by index) coordinates each managed RE plant, per region.
const QCA_PLAN = {
  NRLDC: [0, 0, 1, 1, 2, 3, 4],   // 7 managed plants → THAR,THAR,MARU,MARU,ARAV,NGRID,SATLUJ
  WRLDC: [0, 0, 0, 1, 1],         // 5 managed plants → SARDAR,SARDAR,SARDAR,NARMADA,NARMADA
};

// Past / live transfers. [region, plantAcronym, fromQcaIdx, toQcaIdx, effectiveDaysAgo, status]
// A negative daysAgo means the effective date is in the future (a live Pending).
const TRANSFERS = [
  ['NRLDC', 'SEEDNR_NOKH_S1',    0, 1, 130, 'Approved'],   // THAR → MARU
  ['NRLDC', 'SEEDNR_BIKANER_S1', 1, 2,  90, 'Approved'],   // MARU → ARAV
  ['NRLDC', 'SEEDNR_JSLMR_W1',   2, 3,  60, 'Approved'],   // ARAV → NGRID
  ['WRLDC', 'SEEDWR_CHRNK_S1',   0, 1, 100, 'Approved'],   // SARDAR → NARMADA
  ['NRLDC', 'SEEDNR_DEVIKOT_W1', 3, 0,  45, 'Rejected'],   // NGRID → THAR (declined)
  ['NRLDC', 'SEEDNR_BHADLA_S1',  0, 4, -10, 'Pending'],    // THAR → SATLUJ (awaiting admin)
  ['WRLDC', 'SEEDWR_KHAVDA_S1',  0, 1, -14, 'Pending'],    // SARDAR → NARMADA (awaiting admin)
];

const REMARKS = [
  'Schedule uploaded in WBES does not match the revision issued by RLDC for the affected blocks.',
  'Declared capacity was revised but the schedule continued against the earlier DC.',
  'Revision number in WBES is behind the one acknowledged in the despatch instruction.',
  'Real-time instruction issued over telephone was not reflected in the implemented schedule.',
  'Transmission constraint was lifted but the curtailment continued for the blocks listed.',
  'Unit tripped and the outage was intimated, but the schedule was not revised accordingly.',
  'Entitlement shown against our share does not tally with the allocation for these blocks.',
  'Reactive support instruction not accounted for in the final implemented schedule.',
];
const ADMIN_COMMENTS = [
  'Verified against the WBES revision history. Schedule corrected for the affected blocks.',
  'Discrepancy confirmed. Correction implemented in the revised schedule issued today.',
  'Checked with the despatch log. Correction applied and beneficiaries informed.',
  'Accepted. The revision has been regenerated for the blocks in question.',
];
const REJECTIONS = [
  'Schedule in WBES matches the revision issued. No discrepancy established.',
  'Filed beyond the permissible correction window under IEGC 2023, 49(11)(b).',
  'Supporting Net Schedule Summary was not attached; unable to verify the claim.',
  'Duplicate of an earlier request already resolved for the same date and blocks.',
];
const RETURNS = [
  'Please attach the Net Schedule Summary from WBES for the affected blocks and re-submit.',
  'Time blocks cited do not match the narrative. Kindly clarify and re-raise.',
];

function randomBlocks() {
  const blocks = new Set();
  const runs = int(1, 3);
  for (let r = 0; r < runs; r++) {
    const start = int(1, 92);
    const len = chance(0.6) ? int(1, 5) : 1;
    for (let i = start; i < Math.min(start + len, 97); i++) blocks.add(i);
  }
  return condense([...blocks].sort((a, b) => a - b));
}

function discrepancyType() {
  if (chance(0.05)) return `<Misc: ${pick(REMARKS).slice(0, 40)}...>`;
  const n = chance(0.22) ? 2 : 1;
  const set = new Set();
  for (let i = 0; i < n; i++) set.add(pick(DISCREPANCY_TYPES));
  return [...set].map((t) => `<${t}>`).join(' ');
}

async function main() {
  console.time('seed');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  await withTransaction(async (client) => {
    // ── 1. Fresh start: keep only the RLDC/NLDC admins and the WBES register ──
    // Wipe every non-admin account and ALL discrepancy / transfer / assignment
    // data, then remove any seeded plants. The 4190-row WBES register and the
    // admin accounts (region + national) are left untouched.
    await client.query('DELETE FROM discrepancies');
    await client.query('DELETE FROM transfer_requests');
    await client.query('DELETE FROM user_plant_assignments');
    const del = await client.query(
      "DELETE FROM users WHERE role NOT IN ('ADMIN','SUPERADMIN') RETURNING username"
    );
    await client.query(`DELETE FROM wbes_entities WHERE wbes_acronym LIKE 'SEED%'`);
    console.log(`[SEED] Fresh start: removed ${del.rowCount} non-admin account(s) and all discrepancies/transfers.`);

    // Guard: after clearing, no SEED acronym should survive — if one does it is a
    // real register entry we must not touch. (None exist today; this is a latch.)
    const survivor = await client.query(`SELECT count(*)::int n FROM wbes_entities WHERE wbes_acronym LIKE 'SEED%'`);
    if (survivor.rows[0].n > 0) throw new Error('A real acronym starts with SEED — aborting to avoid touching real data.');

    const plantOwner = new Map();   // acronym → current QCA username (managed RE only)
    const filingTargets = [];       // { username, acronym, category, region } weighted by pushes
    const allAccounts = [];

    for (const [region, cfg] of Object.entries(REGIONS)) {
      // ── Entities: conventional + RE + QCA identities ──────────────────────
      for (const [acr, name, cat, gen] of cfg.conventional) {
        await client.query(
          `INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category, generator_type)
           VALUES ($1,$2,$3,$4,$5)`, [acr, region, name, cat, gen]
        );
      }
      cfg.re.forEach(([acr, name, tech]) =>
        cfg._reNames = (cfg._reNames || []).concat([[acr, `${name} (${tech})`]]));
      for (const [acr, label] of cfg._reNames) {
        await client.query(
          `INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category, generator_type)
           VALUES ($1,$2,$3,'RE','RENEWABLE')`, [acr, region, label]
        );
      }
      for (const [acr, org] of cfg.qcas) {
        await client.query(
          `INSERT INTO wbes_entities (wbes_acronym, region, name, energy_category, generator_type)
           VALUES ($1,$2,$3,'RE','RENEWABLE')`, [acr, region, `${org} (coordinating agency)`]
        );
      }

      // ── Conventional plant users ──────────────────────────────────────────
      for (const [acr, name, cat] of cfg.conventional) {
        const username = usernameFromAcronym(acr, region);
        await client.query(
          `INSERT INTO users (username, name, role, region, email, mobile, password_hash,
                              energy_category, bypass_2fa, can_upload_cycle_data, wbes_acronym)
           VALUES ($1,$2,'USER',$3,$4,$5,$6,$7,TRUE,$8,$9)`,
          [username, name, region, `${username.split('@')[0]}@${SEED_EMAIL}`, `9${int(100000000, 999999999)}`,
           passwordHash, cat, cat === 'ISGS' && chance(0.5), acr]
        );
        allAccounts.push(username);
        const weight = cat === 'ISGS' ? 5 : cat === 'States' ? 4 : 2;
        for (let i = 0; i < weight; i++) filingTargets.push({ username, acronym: acr, category: cat, region });
      }

      // ── QCA accounts ──────────────────────────────────────────────────────
      const qcaUsernames = [];
      for (const [acr, org, qcaName] of cfg.qcas) {
        const username = usernameFromAcronym(acr, region);
        await client.query(
          `INSERT INTO users (username, name, role, region, email, mobile, password_hash,
                              energy_category, bypass_2fa, wbes_acronym, qca_name)
           VALUES ($1,$2,'QCA',$3,$4,$5,$6,'RE',TRUE,$7,$8)`,
          [username, org, region, `${username.split('@')[0]}@${SEED_EMAIL}`, `9${int(100000000, 999999999)}`,
           passwordHash, acr, qcaName]
        );
        allAccounts.push(username);
        qcaUsernames.push(username);
      }

      // ── RE plants: managed ones get a QCA assignment; the last N are independent ─
      const managedCount = cfg.re.length - cfg.independentCount;
      cfg.re.forEach(([acr], idx) => {
        if (idx < managedCount) {
          const qcaIdx = (QCA_PLAN[region] || [])[idx] ?? 0;
          const qca = qcaUsernames[qcaIdx];
          plantOwner.set(acr, qca);
        }
      });

      // Independent RE plants get their own USER account.
      for (let idx = managedCount; idx < cfg.re.length; idx++) {
        const [acr, name, tech] = cfg.re[idx];
        const username = usernameFromAcronym(acr, region);
        await client.query(
          `INSERT INTO users (username, name, role, region, email, mobile, password_hash,
                              energy_category, bypass_2fa, wbes_acronym)
           VALUES ($1,$2,'USER',$3,$4,$5,$6,'RE',TRUE,$7)`,
          [username, `${name} (${tech})`, region, `${username.split('@')[0]}@${SEED_EMAIL}`,
           `9${int(100000000, 999999999)}`, passwordHash, acr]
        );
        allAccounts.push(username);
        filingTargets.push({ username, acronym: acr, category: 'RE', region });
        filingTargets.push({ username, acronym: acr, category: 'RE', region });
      }
    }

    // ── 2. Assignments: base active assignment for each managed RE plant ──────
    for (const [acr, qca] of plantOwner) {
      await client.query(
        `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
         VALUES ($1,$2,$3,NULL)`, [qca, acr, ymd(int(300, 650))]
      );
    }

    // ── 3. Transfers: rewrite ownership history for the plants that moved ─────
    for (const [region, acr, fromIdx, toIdx, daysAgo, status] of TRANSFERS) {
      const qcas = REGIONS[region].qcas.map(([a]) => usernameFromAcronym(a, region));
      const fromQca = qcas[fromIdx];
      const toQca = qcas[toIdx];
      const effective = daysAgo >= 0 ? ymd(daysAgo) : ymd(daysAgo); // ymd handles negatives → future

      if (status === 'Approved') {
        // Close the outgoing QCA's active assignment at the transfer date and open
        // the incoming QCA's, so history reads correctly and current owner flips.
        await client.query(
          `UPDATE user_plant_assignments SET to_date = $3
             WHERE wbes_acronym = $1 AND username = $2 AND to_date IS NULL`,
          [acr, fromQca, effective]
        );
        await client.query(
          `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
           VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING`, [toQca, acr, effective]
        );
        plantOwner.set(acr, toQca);   // current owner is now the incoming QCA
      }

      await client.query(
        `INSERT INTO transfer_requests (wbes_acronym, from_username, to_username, effective_date, status, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [acr, fromQca, toQca, effective, status, status === 'Pending' ? toQca : fromQca]
      );
    }

    // Managed RE plants become filing targets under their CURRENT owner.
    for (const [acr, qca] of plantOwner) {
      const region = acr.startsWith('SEEDNR') ? 'NRLDC' : acr.startsWith('SEEDWR') ? 'WRLDC' : 'ERLDC';
      filingTargets.push({ username: qca, acronym: acr, category: 'RE', region });
      filingTargets.push({ username: qca, acronym: acr, category: 'RE', region });
    }

    // ── 4. A year of discrepancies, 5–10 per day ──────────────────────────────
    const byRegion = { NRLDC: [], ERLDC: [], WRLDC: [] };
    for (const t of filingTargets) byRegion[t.region].push(t);
    const regionRoll = () => { const r = rnd(); return r < 0.45 ? 'NRLDC' : r < 0.80 ? 'WRLDC' : 'ERLDC'; };

    let total = 0;
    for (let day = 365; day >= 0; day--) {
      const count = int(5, 10);
      for (let k = 0; k < count; k++) {
        const region = regionRoll();
        const pool2 = byRegion[region];
        if (!pool2.length) continue;
        const t = pick(pool2);

        const gap = int(0, 7);                       // schedule date sits a few days before filing
        const requestDate = ymd(day);
        const correctionDate = ymd(day + gap);
        const filedAt = ymdhms(day, int(9, 19), int(0, 59));

        // Recent filings are more likely still open; old ones are mostly closed.
        let status;
        if (day < 7) { const r = rnd(); status = r < 0.45 ? 'Pending' : r < 0.85 ? 'Resolved' : r < 0.93 ? 'Returned' : 'Rejected'; }
        else { const r = rnd(); status = r < 0.75 ? 'Resolved' : r < 0.87 ? 'Rejected' : r < 0.93 ? 'Returned' : 'Pending'; }

        const filerRole = t.username.startsWith('seedqca') ? 'QCA' : 'USER';
        const filerRemark = pick(REMARKS);
        const adminUser = `admin@${region.toLowerCase()}`;
        let adminComment = '', rejection = '', resolvedTime = null, flagged = false, flagNote = '', reraise = 0;
        const history = [{ by: t.username, role: filerRole, kind: 'filed', text: filerRemark, at: filedAt }];
        if (status === 'Resolved') {
          adminComment = pick(ADMIN_COMMENTS);
          resolvedTime = ymdhms(Math.max(0, day - int(1, 4)), int(9, 19), int(0, 59));
          history.push({ by: adminUser, role: 'ADMIN', kind: 'resolved', text: adminComment, at: resolvedTime });
        } else if (status === 'Rejected') {
          rejection = pick(REJECTIONS);
          resolvedTime = ymdhms(Math.max(0, day - int(1, 4)), int(9, 19), int(0, 59));
          if (chance(0.25)) { flagged = true; flagNote = 'Repeated filing for the same blocks.'; reraise = int(1, 2); }
          history.push({ by: adminUser, role: 'ADMIN', kind: 'rejected', text: rejection, at: resolvedTime });
        } else if (status === 'Returned') {
          adminComment = pick(RETURNS);
          history.push({ by: adminUser, role: 'ADMIN', kind: 'returned', text: adminComment, at: filedAt });
        }

        await client.query(
          `INSERT INTO discrepancies
             (region, request_by, request_date, correction_for_date, days_diff, time_blocks,
              request_content, discrepancy_type, status, energy_category, admin_comment,
              rejection_reason, resolved_time, reraise_count, flagged, flag_note, wbes_acronym, created_at, remark_history)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
          [region, t.username, requestDate, correctionDate, gap, randomBlocks(), filerRemark,
           discrepancyType(), status, t.category, adminComment, rejection, resolvedTime,
           reraise, flagged, flagNote, t.acronym, filedAt, JSON.stringify(history)]
        );
        total++;
      }
    }
    // ── 5. Inter-regional trade discrepancies (Trader- and State-filed) ───────
    // Exercise both routes and every consent state. Routing is computed the same
    // way the app does, from the seller plant's category.
    const nrTrader = usernameFromAcronym('SEEDNR_NR_TRADER', 'NRLDC');
    const wrTrader = usernameFromAcronym('SEEDWR_WR_TRADER', 'WRLDC');
    const nrState = usernameFromAcronym('SEEDNR_UP_STATE', 'NRLDC');
    const erState = usernameFromAcronym('SEEDER_WB_STATE', 'ERLDC');

    // [filer, filerRegion, sellerAcr, sellerRegion, sellerIsRE, buyerAcr, buyerRegion, consent]
    const TRADES = [
      // RE seller → seller region corrects, buyer consents
      [nrTrader, 'NRLDC', 'SEEDNR_BHADLA_S1', 'NRLDC', true,  'SEEDER_RGNTH_S1', 'ERLDC', 'Awaiting'],
      [nrTrader, 'NRLDC', 'SEEDNR_JSLMR_W1',  'NRLDC', true,  'SEEDWR_KHAVDA_S1','WRLDC', 'Consented'],
      [wrTrader, 'WRLDC', 'SEEDWR_KHAVDA_B1', 'WRLDC', true,  'SEEDNR_UP_STATE', 'NRLDC', 'Resolved'],
      [nrTrader, 'NRLDC', 'SEEDNR_NEEM_B1',   'NRLDC', true,  'SEEDER_ODI_STATE','ERLDC', 'Refused'],
      // Non-RE seller → buyer region corrects, seller consents
      [erState,  'ERLDC', 'SEEDER_FARAKKA_TH','ERLDC', false, 'SEEDNR_RAJ_STATE','NRLDC', 'Awaiting'],
      [nrState,  'NRLDC', 'SEEDNR_SINGRAULI_TH','NRLDC', false,'SEEDWR_GUJ_STATE','WRLDC', 'Consented'],
      [wrTrader, 'WRLDC', 'SEEDWR_MUNDRA_TH', 'WRLDC', false, 'SEEDER_WB_STATE', 'ERLDC', 'Resolved'],
      [nrTrader, 'NRLDC', 'SEEDNR_TEHRI_HY',  'NRLDC', false, 'SEEDWR_MAH_STATE','WRLDC', 'Awaiting'],
    ];

    let trades = 0;
    for (const [filer, filerRegion, sellerAcr, sellerRegion, sellerIsRE, buyerAcr, buyerRegion, consent] of TRADES) {
      const routing = resolveRouting({ sellerIsRE, buyerRegion, sellerRegion });
      const dayAgo = int(2, 40);
      const filedAt = ymdhms(dayAgo, int(9, 18), int(0, 59));
      const filerRole = 'USER';   // Traders and States are USER-role accounts
      const gnaType = chance(0.5) ? 'GNA' : 'T-GNA';
      const gnaNumber = `${gnaType}/2026/${int(10000, 99999)}`;
      const filerRemark = pick(REMARKS);
      const history = [{ by: filer, role: filerRole, kind: 'filed', text: filerRemark, at: filedAt }];

      let status = 'Awaiting Consent', consentState = 'Awaiting', consentMode = null,
          consentBy = null, consentAt = null, consentRemark = '', resolvedTime = null, adminComment = '';
      const consenterAdmin = `admin@${routing.consentingRegion.toLowerCase()}`;
      const correctorAdmin = `admin@${routing.correctingRegion.toLowerCase()}`;
      if (consent === 'Consented' || consent === 'Resolved') {
        consentState = 'Consented'; consentMode = 'portal'; consentBy = consenterAdmin;
        consentAt = ymdhms(Math.max(0, dayAgo - 1), int(9, 18), 0); consentRemark = 'Confirmed, this trade is ours.';
        status = 'Pending';
        history.push({ by: consenterAdmin, role: 'ADMIN', kind: 'consented', text: 'Consented for correction.', at: consentAt });
      }
      if (consent === 'Resolved') {
        status = 'Resolved'; resolvedTime = ymdhms(Math.max(0, dayAgo - 2), int(9, 18), 0);
        adminComment = 'Correction applied in the revised schedule.';
        history.push({ by: correctorAdmin, role: 'ADMIN', kind: 'resolved', text: adminComment, at: resolvedTime });
      }
      if (consent === 'Refused') {
        consentState = 'Refused'; consentMode = 'portal'; consentBy = consenterAdmin;
        consentAt = ymdhms(Math.max(0, dayAgo - 1), int(9, 18), 0);
        consentRemark = 'This trade was not scheduled at our end.'; status = 'Rejected';
        resolvedTime = consentAt;
        history.push({ by: consenterAdmin, role: 'ADMIN', kind: 'denied', text: consentRemark, at: consentAt });
      }

      await client.query(
        `INSERT INTO discrepancies
           (region, request_by, request_date, correction_for_date, days_diff, time_blocks,
            request_content, discrepancy_type, status, energy_category, admin_comment,
            rejection_reason, resolved_time, wbes_acronym, created_at,
            buyer_region, seller_region, buyer_wbes_acronym, seller_wbes_acronym,
            consent_state, consent_mode, consent_by, consent_at, consent_remark,
            gna_tgna_type, gna_tgna_number, correcting_region, consenting_region, remark_history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb)`,
        [filerRegion, filer, ymd(dayAgo), ymd(dayAgo + int(0, 4)), int(0, 4), randomBlocks(),
         filerRemark, discrepancyType(), status,
         filer.includes('trader') ? 'Traders' : 'States', adminComment,
         consent === 'Refused' ? consentRemark : '', resolvedTime, sellerAcr, filedAt,
         buyerRegion, sellerRegion, buyerAcr, sellerAcr,
         consentState, consentMode, consentBy, consentAt, consentRemark,
         gnaType, gnaNumber, routing.correctingRegion, routing.consentingRegion,
         JSON.stringify(history)]
      );
      trades++;
    }

    console.log(`[SEED] ${allAccounts.length} accounts, ${total} discrepancies, ${trades} trade discrepancies inserted.`);
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const s = await pool.query(`
    SELECT
      (SELECT count(*) FROM users WHERE email LIKE '%@${SEED_EMAIL}' AND role='USER')  AS plant_users,
      (SELECT count(*) FROM users WHERE email LIKE '%@${SEED_EMAIL}' AND role='QCA')   AS qcas,
      (SELECT count(*) FROM discrepancies d JOIN users u ON u.username=d.request_by WHERE u.email LIKE '%@${SEED_EMAIL}') AS discs
  `);
  const perRegion = await pool.query(`
    SELECT d.region, count(*)::int n
      FROM discrepancies d JOIN users u ON u.username=d.request_by
     WHERE u.email LIKE '%@${SEED_EMAIL}' GROUP BY d.region ORDER BY n DESC`);
  const perStatus = await pool.query(`
    SELECT d.status, count(*)::int n
      FROM discrepancies d JOIN users u ON u.username=d.request_by
     WHERE u.email LIKE '%@${SEED_EMAIL}' GROUP BY d.status ORDER BY n DESC`);
  const transfers = await pool.query(`SELECT status, count(*)::int n FROM transfer_requests WHERE wbes_acronym LIKE 'SEED%' GROUP BY status`);

  const r = s.rows[0];
  console.log('');
  console.log('  Seed complete (existing real data untouched)');
  console.log(`    seeded plant users : ${r.plant_users}`);
  console.log(`    seeded QCAs        : ${r.qcas}`);
  console.log(`    discrepancies      : ${r.discs}  [${perRegion.rows.map((x) => `${x.region} ${x.n}`).join(', ')}]`);
  console.log(`    by status          : ${perStatus.rows.map((x) => `${x.status} ${x.n}`).join(', ')}`);
  console.log(`    transfers          : ${transfers.rows.map((x) => `${x.status} ${x.n}`).join(', ')}`);
  console.log('');
  console.log(`    Every seeded account signs in with:  ${DEFAULT_PASSWORD}   (OTP bypassed)`);
  console.log(`    e.g.  seednr_bhadla_s1@nrldc  ·  seedqca_thar_nr@nrldc  ·  seeder_wb_state@erldc`);
  console.log('');
  console.timeEnd('seed');
}

main().then(() => pool.end()).catch((err) => {
  console.error('[SEED] Failed:', err.message);
  pool.end();
  process.exit(1);
});
