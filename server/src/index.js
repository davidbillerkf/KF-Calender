const express = require('express');
const cors = require('cors');
const { getFullState, saveFullState, upsertAmount } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is required');
}

function requireApiKey(req, res, next) {
  const key = req.get('x-api-key');
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/data', requireApiKey, async (req, res) => {
  try {
    const data = await getFullState();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load data' });
  }
});

app.post('/data', requireApiKey, async (req, res) => {
  const { ap, ar, pw } = req.body || {};
  if (!ap || !ar || !Array.isArray(ap.types) || !Array.isArray(ap.events)) {
    return res.status(400).json({ error: 'Malformed payload: expected { ap, ar, pw }' });
  }
  try {
    await saveFullState({ ap, ar, pw });
    res.json({ status: 'saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

app.post('/amounts', requireApiKey, async (req, res) => {
  const { category, key, amount } = req.body || {};
  if (category !== 'ap' && category !== 'ar') {
    return res.status(400).json({ error: "category must be 'ap' or 'ar'" });
  }
  if (typeof key !== 'string' || key.length === 0) {
    return res.status(400).json({ error: 'key is required' });
  }
  if (amount !== null && amount !== undefined && typeof amount !== 'number') {
    return res.status(400).json({ error: 'amount must be a number or null' });
  }
  try {
    await upsertAmount(category, key, amount);
    res.json({ status: 'saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save amount' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KF Calendar API listening on port ${PORT}`);
});
