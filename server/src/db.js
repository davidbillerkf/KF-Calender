const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const DEFAULT_AP_TYPES = [
  { id: 'md', name: 'Medical Payroll', c: { bg: '#FAECE7', tx: '#712B13' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'mg', name: 'Management Payroll', c: { bg: '#E6F1FB', tx: '#0C447C' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'of', name: 'Offshore Payroll', c: { bg: '#EAF3DE', tx: '#27500A' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'rg', name: 'RBT GA Payroll', c: { bg: '#E1F5EE', tx: '#085041' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'rm', name: 'RBT Monsey Payroll', c: { bg: '#EEEDFE', tx: '#3C3489' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'ag', name: 'ABA GA Payroll', c: { bg: '#FAEEDA', tx: '#633806' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'am', name: 'ABA Monsey Payroll', c: { bg: '#FBEAF0', tx: '#72243E' }, on: true, rd: null, grp: 'Payroll' },
  { id: 'dv', name: 'Divvy', c: { bg: '#F1EFE8', tx: '#5F5E5A' }, on: true, rd: 11, grp: 'Credit Cards' },
  { id: 'ik', name: 'Ink Staffing', c: { bg: '#FAEEDA', tx: '#633806' }, on: true, rd: 1, grp: 'Credit Cards' },
  { id: 'ch', name: 'Chase CC', c: { bg: '#E6F1FB', tx: '#0C447C' }, on: true, rd: 10, grp: 'Credit Cards' },
];

const DEFAULT_AR_TYPES = [
  { id: 'ac', name: 'Client Invoices', c: { bg: '#EAF3DE', tx: '#27500A' }, on: true, rd: null, grp: 'Clients' },
  { id: 'ai', name: 'Insurance Payments', c: { bg: '#E1F5EE', tx: '#085041' }, on: true, rd: null, grp: 'Insurance', payors: [] },
  { id: 'agr', name: 'Grants', c: { bg: '#EEEDFE', tx: '#3C3489' }, on: true, rd: null, grp: 'Grants' },
];

const DEFAULT_MARKETS = ['General Market', 'Local Market', 'Care First'];

async function ensureAppStateRow() {
  const { rows } = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (rows.length === 0) {
    await pool.query(
      `INSERT INTO app_state (id, ap_types, ap_events, ar_types, ar_events, pw, markets)
       VALUES (1, $1, $2, $3, $4, NULL, $5)`,
      [
        JSON.stringify(DEFAULT_AP_TYPES),
        JSON.stringify([]),
        JSON.stringify(DEFAULT_AR_TYPES),
        JSON.stringify([]),
        JSON.stringify(DEFAULT_MARKETS),
      ]
    );
  }
}

// Backfills the markets default onto a pre-existing app_state row (from before
// the markets column existed) without touching any other data. Safe to call
// on every request — a no-op once markets is non-empty.
async function ensureMarketsSeeded() {
  await pool.query(
    `UPDATE app_state SET markets = $1 WHERE id = 1 AND markets = '[]'::jsonb`,
    [JSON.stringify(DEFAULT_MARKETS)]
  );
}

async function getFullState() {
  await ensureAppStateRow();
  await ensureMarketsSeeded();
  const stateRes = await pool.query(
    'SELECT ap_types, ap_events, ar_types, ar_events, pw, markets FROM app_state WHERE id = 1'
  );
  const state = stateRes.rows[0];

  const amountsRes = await pool.query('SELECT category, key, amount FROM amounts');
  const apAmounts = {};
  const arAmounts = {};
  for (const row of amountsRes.rows) {
    const target = row.category === 'ap' ? apAmounts : arAmounts;
    target[row.key] = Number(row.amount);
  }

  return {
    ap: { types: state.ap_types, events: state.ap_events, amounts: apAmounts },
    ar: { types: state.ar_types, events: state.ar_events, amounts: arAmounts },
    pw: state.pw,
    markets: state.markets,
  };
}

async function saveFullState(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app_state (id, ap_types, ap_events, ar_types, ar_events, pw, markets, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         ap_types = EXCLUDED.ap_types,
         ap_events = EXCLUDED.ap_events,
         ar_types = EXCLUDED.ar_types,
         ar_events = EXCLUDED.ar_events,
         pw = EXCLUDED.pw,
         markets = EXCLUDED.markets,
         updated_at = now()`,
      [
        JSON.stringify(data.ap.types || []),
        JSON.stringify(data.ap.events || []),
        JSON.stringify(data.ar.types || []),
        JSON.stringify(data.ar.events || []),
        data.pw || null,
        JSON.stringify(data.markets && data.markets.length ? data.markets : DEFAULT_MARKETS),
      ]
    );

    await client.query('DELETE FROM amounts');

    const rows = [];
    for (const [key, amount] of Object.entries(data.ap.amounts || {})) {
      rows.push(['ap', key, amount]);
    }
    for (const [key, amount] of Object.entries(data.ar.amounts || {})) {
      rows.push(['ar', key, amount]);
    }

    if (rows.length > 0) {
      const values = [];
      const placeholders = rows.map((row, i) => {
        const base = i * 3;
        values.push(row[0], row[1], row[2]);
        return `($${base + 1}, $${base + 2}, $${base + 3})`;
      });
      await client.query(
        `INSERT INTO amounts (category, key, amount) VALUES ${placeholders.join(', ')}`,
        values
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function upsertAmount(category, key, amount) {
  if (amount === null || amount === undefined) {
    await pool.query('DELETE FROM amounts WHERE category = $1 AND key = $2', [category, key]);
    return;
  }
  await pool.query(
    `INSERT INTO amounts (category, key, amount, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (category, key) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`,
    [category, key, amount]
  );
}

async function hasExistingData() {
  const { rows } = await pool.query('SELECT 1 FROM app_state WHERE id = 1 LIMIT 1');
  return rows.length > 0;
}

module.exports = {
  pool,
  getFullState,
  saveFullState,
  upsertAmount,
  ensureMarketsSeeded,
  hasExistingData,
  DEFAULT_AP_TYPES,
  DEFAULT_AR_TYPES,
  DEFAULT_MARKETS,
};
