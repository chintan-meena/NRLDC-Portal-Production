const pool = require('./db');
const { withTransaction } = require('./db');

async function seedPerformance() {
  console.log('--- NRLDC Schedule Discrepancy Performance Seeding ---');
  console.time('Performance Seeding');
  
  try {
    // Select users whose wbes_acronym corresponds to a valid entity in wbes_entities
    const usersRes = await pool.query(
      `SELECT username, wbes_acronym, energy_category 
       FROM users 
       WHERE role = 'USER' AND wbes_acronym IN (SELECT wbes_acronym FROM wbes_entities)`
    );
    if (usersRes.rows.length === 0) {
      console.log('No user records with valid wbes_acronym mappings found in wbes_entities. Run node seed.js first.');
      process.exit(0);
    }
    const users = usersRes.rows;

    const availableReasons = [
      "Violation due to SCED",
      "Violation due to SCUC",
      "Violation due to Shortfall",
      "Violation due to Emergency",
      "Bilateral Schedule Discrepancy under GNA",
      "Real-Time Instructions Received from NLDC",
      "Schedule Loss Discrepancy",
      "WBES Outage"
    ];

    const statuses = ['Pending', 'Resolved', 'Returned', 'Rejected'];

    // One connection for the whole insert: BEGIN through the pool does not
    // start a transaction the following statements are part of.
    await withTransaction(async (client) => {

      console.log('Inserting 5,000 mock discrepancy records...');

      for (let i = 1; i <= 5000; i++) {
        // Pick a random user
        const user = users[Math.floor(Math.random() * users.length)];
      
        // Pick random date (last 45 days)
        const daysAgo = Math.floor(Math.random() * 45);
        const correctionDate = new Date();
        correctionDate.setDate(correctionDate.getDate() - daysAgo);

        // Random status
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        // Random discrepancy type tags (1-3 tags)
        const numTags = 1 + Math.floor(Math.random() * 3);
        const chosenTags = [];
        for (let t = 0; t < numTags; t++) {
          const tag = availableReasons[Math.floor(Math.random() * availableReasons.length)];
          if (!chosenTags.includes(tag)) {
            chosenTags.push(tag);
          }
        }
        const discrepancyType = chosenTags.map(tag => `<${tag}>`).join(' ');

        // Random time block: e.g. 15-20,30,45-50
        const blocks = [];
        const numBlocks = 1 + Math.floor(Math.random() * 3);
        for (let b = 0; b < numBlocks; b++) {
          const start = 1 + Math.floor(Math.random() * 80);
          const end = start + Math.floor(Math.random() * 10);
          blocks.push(start === end ? `${start}` : `${start}-${end}`);
        }
        const timeBlocks = blocks.join(',');

        // Insert discrepancy
        await client.query(
          `INSERT INTO discrepancies (
            request_by, request_date, correction_for_date, days_diff, time_blocks, 
            request_content, discrepancy_type, status, energy_category, files, 
            admin_comment, admin_files, rejection_reason, wbes_acronym
          ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9, '[]'::jsonb, $10, $11)`,
          [
            user.username,
            correctionDate.toISOString().split('T')[0],
            daysAgo,
            timeBlocks,
            `Performance test discrepancy mock remarks #${i}. Schedule mismatch reported.`,
            discrepancyType,
            status,
            user.energy_category || 'conventional',
            status === 'Resolved' ? 'Approved corrective action and schedule revision completed.' : '',
            status === 'Rejected' ? 'Mismatched values mismatch details invalid.' : '',
            user.wbes_acronym
          ]
        );
      }

    });

    console.log('Successfully inserted 5,000 discrepancies!');
    console.timeEnd('Performance Seeding');
  } catch (err) {
    console.error('Error during performance seeding:', err);
  } finally {
    await pool.end();
  }
}

seedPerformance();
