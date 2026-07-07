-- KF Payroll Calendar — schema
--
-- Two tables:
--   app_state  — singleton row holding the structural data (types, events, password).
--                This changes rarely (adding/renaming a payroll type, editing the
--                recurring schedule) so it's stored as jsonb blobs.
--   amounts    — one row per dollar figure the user has entered. This is the data
--                that changes constantly as amounts get typed in, so it gets its
--                own table keyed the same way the frontend already keys it in memory.
--
-- Key convention (matches the frontend's `ak(date, name)` helper, `date + '||' + name`):
--   "2026-01-07||Medical Payroll"                       -> flat amount for a type on a date
--   "2026-01-07||Blue Cross__Insurance Payments"        -> AR payor sub-amount (payorName__typeName)
--   "2026-01-07||General Market__Medical Payroll"       -> AP market sub-amount (marketName__typeName)
-- The flat "date||typeName" key is the total: when a market breakdown exists
-- for a date+type, the frontend keeps it in sync as the sum of that date's
-- market sub-amounts, the same additive-detail pattern AR payors already use.
--
-- The list of market names (e.g. "General Market") is company-wide, not
-- per-type, so it lives in app_state.markets rather than in the amounts table.

CREATE TABLE IF NOT EXISTS app_state (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ap_types    jsonb NOT NULL,
  ap_events   jsonb NOT NULL,
  ar_types    jsonb NOT NULL,
  ar_events   jsonb NOT NULL,
  pw          text,
  markets     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Additive migration for databases created before the `markets` column existed.
ALTER TABLE app_state ADD COLUMN IF NOT EXISTS markets jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS amounts (
  category    text NOT NULL CHECK (category IN ('ap', 'ar')),
  key         text NOT NULL,
  amount      numeric NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, key)
);
