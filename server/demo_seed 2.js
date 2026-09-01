#!/usr/bin/env node
/**
 * demo_seed.js — Fill the database with a realistic body of demo data.
 *
 *   ./nrldc.sh demo              from the project root (easiest)
 *   node server/demo_seed.js     from the project root
 *   ./demo_seed.js               from this directory
 *
 * Add --yes to any of these to skip the confirmation prompt.
 *
 * Produces:
 *   150 plant users   — 124 RE, 17 ISGS, 9 States
 *     8 QCA accounts  — between them coordinating 115 of the RE plants,
 *                       leaving 9 RE plants independent
 *  1000 discrepancies — spread over the last few months, in every status,
 *                       with attachments that really exist on disk
 *
 * Every account signs in with the standard default password and has OTP
 * bypassed, so the portal is usable without a working mail server.
 *
 * This REPLACES existing non-admin users and all discrepancies. Admin
 * accounts are left alone.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const pool = require('./db');
const { withTransaction } = require('./db');
const { DEFAULT_PASSWORD } = require('./utils/password');
const { condense } = require('./utils/timeBlocks');
const { DISCREPANCY_TYPES } = require('./utils/discrepancyTypes');

// Free-text reasons, filed under the Miscellaneous option.
const MISC_REASONS = [
  'Transformer differential relay operated during the block',
  'Communication link to RTU was down for the period',
  'Station auxiliary supply changeover affected the injection',
  'Metering CT circuit under maintenance for these blocks',
];

const UPLOAD_DIR = path.join(__dirname, 'upload');

// ─── Deterministic randomness, so re-running gives the same shape ───────────
let seed = 20260830;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const chance = (p) => rnd() < p;

// ─── Plants ─────────────────────────────────────────────────────────────────

// The 17 central generating stations in the Northern Region.
const ISGS_PLANTS = [
  ['SINGRAULI', 'Singrauli Super Thermal Power Station'],
  ['RIHAND1', 'Rihand Super Thermal Power Station Stage-I'],
  ['RIHAND2', 'Rihand Super Thermal Power Station Stage-II'],
  ['DADRI_TH', 'Dadri Thermal Power Station'],
  ['DADRI_GAS', 'Dadri Gas Power Station'],
  ['UNCHAHAR', 'Unchahar Thermal Power Station'],
  ['TANDA', 'Tanda Thermal Power Station'],
  ['ANTA', 'Anta Gas Power Station'],
  ['AURAIYA', 'Auraiya Gas Power Station'],
  ['JHAJJAR', 'Jhajjar Power Station'],
  ['KOLDAM', 'Koldam Hydro Electric Plant'],
  ['SALAL', 'Salal Hydro Electric Project'],
  ['URI1', 'Uri Hydro Electric Project Stage-I'],
  ['DULHASTI', 'Dulhasti Hydro Electric Project'],
  ['CHAMERA1', 'Chamera Hydro Electric Project Stage-I'],
  ['TEHRI', 'Tehri Hydro Power Complex'],
  ['NATHPA', 'Nathpa Jhakri Hydro Electric Station'],
];

// The 9 Northern Region state utilities.
const STATE_PLANTS = [
  ['DELHI', 'Delhi State Load Despatch Centre'],
  ['HARYANA', 'Haryana State Load Despatch Centre'],
  ['PUNJAB', 'Punjab State Load Despatch Centre'],
  ['RAJASTHAN', 'Rajasthan State Load Despatch Centre'],
  ['UP', 'Uttar Pradesh State Load Despatch Centre'],
  ['UTTARAKHAND', 'Uttarakhand State Load Despatch Centre'],
  ['HP', 'Himachal Pradesh State Load Despatch Centre'],
  ['JK', 'Jammu & Kashmir State Load Despatch Centre'],
  ['CHANDIGARH', 'Chandigarh Electricity Department'],
];

// 124 renewable parks, built from real Northern Region solar/wind locations.
const RE_SITES = [
  ['BHADLA', 'Bhadla Solar Park', 'Solar'],
  ['PAVAGADA', 'Pavagada Solar Park', 'Solar'],
  ['JAISALMER', 'Jaisalmer Wind Park', 'Wind'],
  ['FATEHGARH', 'Fatehgarh Solar', 'Solar'],
  ['NOKH', 'Nokh Solar Park', 'Solar'],
  ['POKHRAN', 'Pokhran Wind Farm', 'Wind'],
  ['BAP', 'Bap Solar Project', 'Solar'],
  ['PHALODI', 'Phalodi Solar', 'Solar'],
  ['RAMGARH', 'Ramgarh Solar', 'Solar'],
  ['DEVIKOT', 'Devikot Wind', 'Wind'],
  ['BIKANER', 'Bikaner Solar Park', 'Solar'],
  ['JODHPUR', 'Jodhpur Solar', 'Solar'],
  ['BARMER', 'Barmer Solar Project', 'Solar'],
  ['CHURU', 'Churu Solar', 'Solar'],
  ['NAGAUR', 'Nagaur Wind Farm', 'Wind'],
  ['HISAR', 'Hisar Solar', 'Solar'],
  ['BHIWANI', 'Bhiwani Solar Project', 'Solar'],
  ['SIRSA', 'Sirsa Solar', 'Solar'],
  ['BATHINDA', 'Bathinda Solar Park', 'Solar'],
  ['MOGA', 'Moga Solar', 'Solar'],
  ['FEROZEPUR', 'Ferozepur Solar Project', 'Solar'],
  ['MUZAFFARNAGAR', 'Muzaffarnagar Solar', 'Solar'],
  ['JHANSI', 'Jhansi Solar Park', 'Solar'],
  ['ALLAHABAD', 'Prayagraj Solar', 'Solar'],
  ['MIRZAPUR', 'Mirzapur Solar Project', 'Solar'],
  ['KANPUR', 'Kanpur Solar', 'Solar'],
  ['SITAPUR', 'Sitapur Solar Park', 'Solar'],
  ['HARDOI', 'Hardoi Solar', 'Solar'],
  ['SOLAN', 'Solan Small Hydro', 'Hydro'],
  ['KANGRA', 'Kangra Small Hydro', 'Hydro'],
  ['KULLU', 'Kullu Small Hydro Project', 'Hydro'],
];

function buildRePlants(count) {
  const plants = [];
  let i = 0;
  while (plants.length < count) {
    const [base, name, kind] = RE_SITES[i % RE_SITES.length];
    const unit = Math.floor(i / RE_SITES.length) + 1;
    const acronym = unit === 1 ? `${base}_RE` : `${base}_RE${unit}`;
    const label = unit === 1 ? name : `${name} Unit-${unit}`;
    plants.push([acronym, `${label} (${kind})`]);
    i++;
  }
  return plants;
}

// ─── QCA coordinating agencies ──────────────────────────────────────────────
const QCAS = [
  ['qca.tharsolar',    'Thar Solar Coordination Services',   'Thar Solar QCA',        25],
  ['qca.marudhara',    'Marudhara Renewable Aggregators',    'Marudhara QCA',         20],
  ['qca.aravalli',     'Aravalli Green Coordination',        'Aravalli Green QCA',    18],
  ['qca.northgrid',    'North Grid RE Services',             'North Grid QCA',        15],
  ['qca.satluj',       'Satluj Renewable Coordination',      'Satluj RE QCA',         12],
  ['qca.doab',         'Doab Clean Energy Aggregators',      'Doab Clean QCA',        10],
  ['qca.shivalik',     'Shivalik Power Coordination',        'Shivalik QCA',           8],
  ['qca.yamuna',       'Yamuna Renewable Services',          'Yamuna RE QCA',          7],
];   // 25+20+18+15+12+10+8+7 = 115 managed plants


const REMARKS = [
  'Schedule uploaded in WBES does not match the revision issued by RLDC for the affected blocks.',
  'Declared capacity was revised but the schedule continued against the earlier DC.',
  'Revision number in WBES is behind the one acknowledged in the despatch instruction.',
  'Real-time instruction issued over telephone was not reflected in the implemented schedule.',
  'Transmission constraint was lifted but the curtailment continued for the blocks listed.',
  'Unit tripped and the outage was intimated, but the schedule was not revised accordingly.',
  'Entitlement shown against our share does not tally with the allocation for these blocks.',
  'Scheduled generation differs from the requisition placed by the beneficiary.',
  'Reactive support instruction not accounted for in the final implemented schedule.',
  'Post-facto revision was approved but has not appeared against the affected time blocks.',
];

const ADMIN_COMMENTS = [
  'Verified against the WBES revision history. Schedule corrected for the affected blocks.',
  'Discrepancy confirmed. Correction implemented in the revised schedule issued today.',
  'Checked with the despatch log. Correction applied and beneficiaries informed.',
  'Accepted. The revision has been regenerated for the blocks in question.',
  'Corrected. Please verify at your end and confirm closure.',
];

const REJECTION_REASONS = [
  'Schedule in WBES matches the revision issued. No discrepancy established.',
  'Filed beyond the permissible correction window under IEGC 2023, 49(11)(b).',
  'Supporting Net Schedule Summary was not attached; unable to verify the claim.',
  'The blocks cited fall outside the outage period intimated to RLDC.',
  'Duplicate of an earlier request already resolved for the same date and blocks.',
];

const RETURN_COMMENTS = [
  'Please attach the Net Schedule Summary from WBES for the affected blocks and re-submit.',
  'Time blocks cited do not match the narrative. Kindly clarify and re-raise.',
  'Provide the revision number you are contesting so this can be checked against the log.',
];

// ─── Attachment files ───────────────────────────────────────────────────────

/** A small, valid PDF, padded with a comment so it lands around 1 KB. */
function buildPdfBuffer(title) {
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 90>>stream
BT /F1 12 Tf 60 760 Td (${title}) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF
`;
  const padding = `% demo attachment — not a real schedule document\n`.repeat(12);
  return Buffer.from(body + padding, 'latin1');
}

/** A small but genuinely valid .xlsx that Excel will open. */
async function buildXlsxBuffer(title) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Net Schedule Summary');
  ws.columns = [
    { header: 'Block', key: 'b', width: 8 },
    { header: 'From', key: 'f', width: 10 },
    { header: 'To', key: 't', width: 10 },
    { header: 'Remarks', key: 'r', width: 46 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ b: '', f: '', t: '', r: title });
  ws.addRow({ b: '', f: '', t: '', r: 'Demo attachment — contains no real schedule data.' });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A plausible set of affected blocks, as an operator would write them. */
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

/**
 * Refuse to run against a production server.
 *
 * Both seeders drop real data and recreate accounts with a shared default
 * password and OTP switched off — right for a test machine, ruinous on a live
 * one. --yes exists to skip the prompt in scripts, so the prompt alone is not a
 * safeguard; this check is not skippable.
 */
function refuseInProduction(what) {
  if (process.env.NODE_ENV !== 'production') return;
  const line = '\u2500'.repeat(66);
  console.error('');
  console.error(line);
  console.error(`  REFUSING TO RUN: NODE_ENV is "production".`);
  console.error(line);
  console.error('');
  console.error(`  ${what}`);
  console.error('');
  console.error('  If this really is a throwaway database, run it with NODE_ENV unset:');
  console.error('');
  console.error('      NODE_ENV= node ' + require('path').basename(process.argv[1]));
  console.error('');
  console.error(line);
  console.error('');
  process.exit(1);
}

async function confirm() {
  if (process.argv.includes('--yes')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      '\nThis DELETES every non-admin user and every discrepancy, then loads demo data.\nType yes to continue: ',
      resolve
    );
  });
  rl.close();
  return answer.trim() === 'yes';
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  refuseInProduction('This deletes every non-admin user and every discrepancy, then loads\n  150 demo accounts that all share the password "Password@123" with OTP off.');
  if (!(await confirm())) {
    console.log('Aborted. Nothing was changed.');
    return;
  }

  console.time('demo data');
  const rePlants = buildRePlants(124);
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // ── Attachment files on disk ──────────────────────────────────────────────
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('[DEMO] Generating attachment files...');
  const pdfPool = [];
  const xlsxPool = [];
  for (let i = 1; i <= 30; i++) {
    const stamp = 1780000000000 + i * 9973;
    const pdfName = `${stamp}-${100000000 + i}-NetSchdReportSummary_${i}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, pdfName), buildPdfBuffer(`Net Schedule Summary — demo document ${i}`));
    pdfPool.push(pdfName);

    const xlsxName = `${stamp + 5}-${200000000 + i}-NetSchdReportSummary_${i}.xlsx`;
    fs.writeFileSync(path.join(UPLOAD_DIR, xlsxName), await buildXlsxBuffer(`Net Schedule Summary — demo workbook ${i}`));
    xlsxPool.push(xlsxName);
  }
  console.log(`[DEMO] ${pdfPool.length} PDFs and ${xlsxPool.length} workbooks written to server/upload/`);

  await withTransaction(async (client) => {
    // ── Clear previous data, keeping admins ────────────────────────────────
    console.log('[DEMO] Clearing existing discrepancies, assignments and non-admin users...');
    await client.query('DELETE FROM discrepancies');
    await client.query('DELETE FROM transfer_requests');
    await client.query('DELETE FROM user_plant_assignments');
    await client.query('DELETE FROM outages');
    await client.query('DELETE FROM cycle_data_uploads');
    await client.query("DELETE FROM users WHERE role <> 'ADMIN'");

    // ── Plants ─────────────────────────────────────────────────────────────
    const allPlants = [
      ...rePlants.map(([a, n]) => [a, n, 'RE']),
      ...ISGS_PLANTS.map(([a, n]) => [a, n, 'ISGS']),
      ...STATE_PLANTS.map(([a, n]) => [a, n, 'States']),
    ];
    for (const [acronym, name, category] of allPlants) {
      await client.query(
        `INSERT INTO wbes_entities (wbes_acronym, name, energy_category) VALUES ($1, $2, $3)
         ON CONFLICT (wbes_acronym) DO UPDATE SET name = $2, energy_category = $3`,
        [acronym, name, category]
      );
    }
    console.log(`[DEMO] ${allPlants.length} plants registered (${rePlants.length} RE, ${ISGS_PLANTS.length} ISGS, ${STATE_PLANTS.length} States).`);

    // ── Plant users, one per plant ─────────────────────────────────────────
    const plantUsers = [];
    for (const [acronym, name, category] of allPlants) {
      const username = `${acronym.toLowerCase().replace(/_/g, '.')}@nrldc`;
      await client.query(
        `INSERT INTO users (username, name, role, email, mobile, password_hash, energy_category,
                            bypass_2fa, can_upload_cycle_data, wbes_acronym)
         VALUES ($1, $2, 'USER', $3, $4, $5, $6, TRUE, $7, $8)`,
        [
          username, name, `${username.split('@')[0]}@example.in`,
          `9${int(100000000, 999999999)}`, passwordHash, category,
          category === 'ISGS' && chance(0.4), acronym,
        ]
      );
      plantUsers.push({ username, acronym, category, name });
    }
    console.log(`[DEMO] ${plantUsers.length} plant users created.`);

    // ── QCA accounts, and the plants they coordinate ───────────────────────
    const reAcronyms = rePlants.map(([a]) => a);
    let cursor = 0;
    const qcaUsers = [];
    for (const [handle, orgName, qcaName, manages] of QCAS) {
      const username = `${handle}@nrldc`;
      // A QCA's own acronym is its identifier, not a generating plant.
      const ownAcronym = handle.replace('qca.', 'QCA_').toUpperCase();
      await client.query(
        `INSERT INTO wbes_entities (wbes_acronym, name, energy_category) VALUES ($1, $2, 'RE')
         ON CONFLICT (wbes_acronym) DO NOTHING`,
        [ownAcronym, `${orgName} (coordinating agency)`]
      );
      await client.query(
        `INSERT INTO users (username, name, role, email, mobile, password_hash, energy_category,
                            bypass_2fa, can_upload_cycle_data, wbes_acronym, qca_name)
         VALUES ($1, $2, 'QCA', $3, $4, $5, 'RE', TRUE, FALSE, $6, $7)`,
        [username, orgName, `${handle}@example.in`, `9${int(100000000, 999999999)}`,
         passwordHash, ownAcronym, qcaName]
      );

      const managed = reAcronyms.slice(cursor, cursor + manages);
      cursor += manages;
      for (const acronym of managed) {
        await client.query(
          `INSERT INTO user_plant_assignments (username, wbes_acronym, from_date, to_date)
           VALUES ($1, $2, $3, NULL)`,
          [username, acronym, dateNDaysAgo(int(200, 700))]
        );
      }
      qcaUsers.push({ username, qcaName, managed });
    }
    const independentRe = reAcronyms.slice(cursor);
    console.log(`[DEMO] ${qcaUsers.length} QCAs coordinating ${cursor} RE plants; ${independentRe.length} RE plants independent.`);

    // ── A few transfer requests awaiting the admin ─────────────────────────
    for (let i = 0; i < 4; i++) {
      const target = qcaUsers[int(0, qcaUsers.length - 1)];
      const plant = pick(independentRe);
      await client.query(
        `INSERT INTO transfer_requests (wbes_acronym, from_username, to_username, effective_date, status, requested_by)
         VALUES ($1, NULL, $2, $3, 'Pending', $4)`,
        [plant, target.username, dateNDaysAgo(-int(3, 20)),
         plantUsers.find(u => u.acronym === plant).username]
      );
    }

    // ── 1000 discrepancies ─────────────────────────────────────────────────
    console.log('[DEMO] Creating 1000 discrepancies...');
    const byAcronym = new Map(plantUsers.map(u => [u.acronym, u]));
    const qcaByPlant = new Map();
    for (const q of qcaUsers) for (const a of q.managed) qcaByPlant.set(a, q.username);

    const filingTargets = [];
    for (const u of plantUsers) {
      // ISGS and State desks file more often than a single solar park does.
      const weight = u.category === 'ISGS' ? 6 : u.category === 'States' ? 5 : 1;
      for (let i = 0; i < weight; i++) filingTargets.push(u.acronym);
    }

    for (let n = 0; n < 1000; n++) {
      const acronym = pick(filingTargets);
      const plantUser = byAcronym.get(acronym);
      // A QCA files on behalf of the plants it coordinates.
      const requestBy = qcaByPlant.get(acronym) || plantUser.username;

      const ageDays = chance(0.55) ? int(0, 20) : int(21, 130);
      const correctionFor = dateNDaysAgo(ageDays);
      const filedAfter = int(0, Math.min(4, ageDays));
      const requestDate = dateNDaysAgo(Math.max(0, ageDays - filedAfter));

      const roll = rnd();
      const status = roll < 0.18 ? 'Pending'
                   : roll < 0.80 ? 'Resolved'
                   : roll < 0.92 ? 'Rejected'
                   : 'Returned';

      // Most requests use the standard tags; a few use the free-text
      // Miscellaneous option, as they would in practice.
      let discrepancyType;
      if (chance(0.06)) {
        discrepancyType = `<Misc: ${pick(MISC_REASONS)}>`;
      } else {
        const typeCount = chance(0.25) ? 2 : 1;
        const types = new Set();
        for (let t = 0; t < typeCount; t++) types.add(pick(DISCREPANCY_TYPES));
        discrepancyType = [...types].map(t => `<${t}>`).join(' ');
      }

      const files = [];
      if (chance(0.45)) {
        files.push(pick(xlsxPool));
        if (chance(0.35)) files.push(pick(pdfPool));
      }

      const adminFiles = [];
      let adminComment = '';
      let rejectionReason = '';
      let resolvedTime = null;
      if (status === 'Resolved') {
        adminComment = pick(ADMIN_COMMENTS);
        if (chance(0.3)) adminFiles.push(pick(pdfPool));
        resolvedTime = `${dateNDaysAgo(Math.max(0, ageDays - filedAfter - int(0, 2)))} ${String(int(9, 19)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00`;
      } else if (status === 'Rejected') {
        rejectionReason = pick(REJECTION_REASONS);
        resolvedTime = `${dateNDaysAgo(Math.max(0, ageDays - filedAfter - int(0, 2)))} ${String(int(9, 19)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00`;
      } else if (status === 'Returned') {
        adminComment = pick(RETURN_COMMENTS);
      }

      await client.query(
        `INSERT INTO discrepancies
           (request_by, request_date, correction_for_date, days_diff, time_blocks, request_content,
            discrepancy_type, status, energy_category, files, admin_comment, admin_files,
            rejection_reason, resolved_time, reraise_count, wbes_acronym)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16)`,
        [
          requestBy, requestDate, correctionFor, ageDays, randomBlocks(),
          pick(REMARKS), discrepancyType, status, plantUser.category,
          JSON.stringify(files), adminComment, JSON.stringify(adminFiles),
          rejectionReason, resolvedTime,
          status === 'Pending' && chance(0.12) ? int(1, 2) : 0,
          acronym,
        ]
      );
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = await pool.query(`
    SELECT
      (SELECT count(*) FROM users WHERE role = 'USER')                        AS plant_users,
      (SELECT count(*) FROM users WHERE role = 'QCA')                         AS qcas,
      (SELECT count(*) FROM users WHERE role = 'USER' AND energy_category='RE')     AS re_users,
      (SELECT count(*) FROM users WHERE role = 'USER' AND energy_category='ISGS')   AS isgs_users,
      (SELECT count(*) FROM users WHERE role = 'USER' AND energy_category='States') AS state_users,
      (SELECT count(DISTINCT wbes_acronym) FROM user_plant_assignments WHERE to_date IS NULL) AS managed_plants,
      (SELECT count(*) FROM discrepancies)                                    AS discrepancies
  `);
  const s = summary.rows[0];
  const statuses = await pool.query(
    'SELECT status, count(*)::int AS n FROM discrepancies GROUP BY status ORDER BY n DESC'
  );
  // Admins are preserved, so their credentials are not the ones printed below.
  const admins = await pool.query(
    "SELECT username, bypass_2fa FROM users WHERE role = 'ADMIN' ORDER BY username"
  );

  console.log('');
  console.log('  Demo data loaded');
  console.log(`    plant users     : ${s.plant_users}  (RE ${s.re_users}, ISGS ${s.isgs_users}, States ${s.state_users})`);
  console.log(`    QCA accounts    : ${s.qcas}, coordinating ${s.managed_plants} RE plants`);
  console.log(`    independent RE  : ${s.re_users - s.managed_plants}`);
  console.log(`    discrepancies   : ${s.discrepancies}  (${statuses.rows.map(r => `${r.status} ${r.n}`).join(', ')})`);
  console.log('');
  console.log(`    The ${Number(s.plant_users) + Number(s.qcas)} accounts created above sign in with:  ${DEFAULT_PASSWORD}`);
  console.log('');
  console.log('    Admin accounts were NOT touched — they keep whatever password');
  console.log('    they already had. Existing admins:');
  for (const a of admins.rows) {
    console.log(`      ${a.username}${a.bypass_2fa ? '' : '   (OTP required at login)'}`);
  }
  console.log('');
  console.timeEnd('demo data');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[DEMO] Failed:', err.message);
    pool.end();
    process.exit(1);
  });
