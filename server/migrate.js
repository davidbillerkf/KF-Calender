// One-time setup: creates the schema (if missing) and loads the starting
// dataset from seed/data_backup.json. Safe to re-run — it upserts, it
// won't duplicate rows. Run with: npm run migrate

const fs = require('fs');
const path = require('path');
const { pool, saveFullState } = require('./src/db');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Schema applied.');

  const seedPath = path.join(__dirname, 'seed', 'data_backup.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  await saveFullState(seed);

  const apCount = Object.keys(seed.ap.amounts || {}).length;
  const arCount = Object.keys(seed.ar.amounts || {}).length;
  console.log(`Seeded ${apCount} AP amounts and ${arCount} AR amounts.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
