# KF Payroll Calendar — Backend API

Express + PostgreSQL API that gives the calendar a real database instead of
just browser localStorage. `index.html` talks to this API to load and save
data; if the API is unreachable it falls back to localStorage automatically,
so the calendar always keeps working.

## Endpoints

All endpoints except `/health` require an `x-api-key` header matching the
`API_KEY` environment variable.

- `GET /health` — health check, no auth required.
- `GET /data` — returns the full state: `{ ap: { types, events, amounts }, ar: { types, events, amounts }, pw }`.
- `POST /data` — replaces the full state with the given body (same shape as `GET /data`).
- `POST /amounts` — upserts (or deletes) a single amount: `{ "category": "ap"|"ar", "key": "2026-01-07||Medical Payroll", "amount": 12345.67 }`. Send `"amount": null` to delete that entry.

## Deploying on Railway

1. **Create the project.** In the Railway dashboard, click New Project →
   Deploy from GitHub repo, and pick this repository. Set the service's
   root directory to `server/` (Settings → root directory), since the repo
   root also contains the static `index.html`.

2. **Add PostgreSQL.** In the same Railway project, click New → Database →
   Add PostgreSQL. Railway automatically creates a `DATABASE_URL` variable
   — reference it in the API service's variables as
   `DATABASE_URL=${{Postgres.DATABASE_URL}}` (Railway's variable-reference
   syntax), or copy the value directly.

3. **Set environment variables on the API service:**
   - `DATABASE_URL` — from the Postgres add-on (step 2).
   - `API_KEY` — make up a long random string. This is the shared secret
     the calendar frontend sends on every request; treat it like a
     password. Do **not** reuse the app's own unlock password for this.
   - `PORT` — Railway sets this automatically; you don't need to set it.

4. **Run the one-time migration + seed.** After the first deploy, open a
   shell for the service in the Railway dashboard (or `railway run`
   locally with the project linked) and run:
   ```
   npm run migrate
   ```
   This creates the tables and loads the starting dataset from
   `seed/data_backup.json` (the 86 AP amounts already entered for Jan–Jun
   2026). It's safe to re-run — it upserts rather than duplicating rows.

5. **Grab the public URL.** Railway gives the service a public domain
   under Settings → Networking → Generate Domain (something like
   `https://kf-calendar-server-production.up.railway.app`).

6. **Point the frontend at it.** In `index.html`, find:
   ```js
   const API_URL='';
   const API_KEY='';
   ```
   near the top of the main `<script>` block (right after the baked data),
   and fill in the Railway URL and the same `API_KEY` value from step 3.
   Commit and push — GitHub Pages will serve the updated file, and the
   calendar will now read/write through Railway instead of only using
   localStorage.

## Local development

```
cd server
npm install
cp .env.example .env   # fill in a local DATABASE_URL and API_KEY
npm run migrate
npm start
```

## Notes on the data model

- `app_state` holds the structural data (types, recurring-day schedule,
  event dates, the app's unlock password hash) as a single row of JSON
  columns — this changes rarely.
- `amounts` holds one row per dollar figure, keyed exactly the way the
  frontend already keys them in memory (`"2026-01-07||Medical Payroll"`).
  See the comment at the top of `schema.sql` for how the **planned
  per-market breakdown** feature slots into this same key convention
  without needing a schema change (it reuses the same `name__type`
  pattern already used for AR insurance payors).
- `API_KEY` is a single shared secret embedded in the public `index.html`
  — anyone who can view the page source can read it. That's an accepted
  tradeoff for a small internal tool with no separate user accounts; it
  stops casual/automated writes to the database, not a determined reader
  of the page source. The app's own unlock password (`pw`) is a separate,
  unrelated mechanism that only gates the UI, not the API.
