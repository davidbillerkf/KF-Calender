// One-time setup: creates/updates the schema (idempotent — safe to re-run,
// e.g. after a schema change) and, only on a brand-new empty database, loads
// the starting dataset from seed/data_backup.json. If the database already
// has data, it is left untouched — this will never overwrite amounts you've
// entered since going live. Run with: npm run migrate

const fs = require('fs');
const path = require('path');
const { pool, saveFullState, ensureMarketsSeeded, hasExistingData, DEFAULT_MARKETS } = require('./src/db');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Schema applied.');

  if (await hasExistingData()) {
    console.log('Existing data found — skipping seed, only backfilling defaults.');
    await ensureMarketsSeeded();
    console.log('Done.');
  } else {
    const seedPath = path.join(__dirname, 'seed', 'data_backup.json');
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    if (!seed.markets) seed.markets = DEFAULT_MARKETS;
    await saveFullState(seed);

    const apCount = Object.keys(seed.ap.amounts || {}).length;
    const arCount = Object.keys(seed.ar.amounts || {}).length;
    console.log(`Seeded ${apCount} AP amounts and ${arCount} AR amounts.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
