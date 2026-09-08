# Local dev database setup

These files bootstrap a **separate, disposable Supabase project** so you can run
the portal locally without pointing it at production data.

| File | What it does |
|---|---|
| `01_schema.sql` | Creates every table, index, RLS policy and storage bucket the portal queries |
| `02_seed.sql` | Inserts three fictional stockholders, transactions, dividends, announcements and survey questions |

> **These are a reconstruction, not a production dump.** The real base schema was
> never committed to this repo — see [`../migrations/README.md`](../migrations/README.md).
> The tables and columns here were derived from what the application code
> actually selects and inserts, so the portal runs against them, but production
> may have extra columns, constraints and triggers that are not reproduced.

## Steps

### 1. Create a new Supabase project

At [supabase.com](https://supabase.com) → New project. Any region, free tier.
Note the project's **URL** and **anon/publishable key** (Project Settings → API).

### 2. Apply the schema and seed

In the project's **SQL Editor**, run `01_schema.sql`, then `02_seed.sql`.

### 3. Point the app at the new project

Edit [`../../.env`](../../.env):

```env
VITE_SUPABASE_URL=https://<your-new-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-new-anon-key>
```

### 4. Deploy the two auth edge functions

```bash
npx supabase login
npx supabase link --project-ref <your-new-project-ref>
npx supabase functions deploy auth-send-otp auth-login --no-verify-jwt
```

`--no-verify-jwt` matters: the portal calls these functions with only an `apikey`
header and no `Authorization` bearer token (see `loginWithNationalId` in
`src/services/stockholderService.ts`), so gateway JWT verification must be off.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
platform — you do not set those yourself.

### 5. Set the function secrets

Project Settings → Edge Functions → Secrets:

| Secret | Value | Why |
|---|---|---|
| `TWILIO_ENV` | `test` | **Required.** Mock OTP — no Twilio account needed, and rate limits are skipped |
| `TEST_OTP_CODE` | `123456` | Optional; this is the default if unset |
| `ALLOWED_ORIGINS` | *leave unset* | **Do not set this.** When unset, the functions fall back to `defaultAllowedOrigins`, which already includes `http://localhost:3000` (`auth-send-otp/index.ts:30-38`). Setting it to a production domain is exactly what blocks localhost on the live project |

So on a fresh project `TWILIO_ENV=test` is the only secret you must add.

### 6. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, enter National ID **`1000000001`**, tick the
privacy checkbox, then enter **`123456`**.

## Seeded logins

| National ID | Name | Expected |
|---|---|---|
| `1000000001` | Ahmed Al-Otaibi | 650 shares, 3 transactions, 3 dividend years, 1 certificate |
| `1000000002` | Sara Al-Harbi | 275 shares, 2 transactions, 2 dividend years |
| `1000000003` | Khalid Al-Zahrani | **Inactive — login is refused** (tests the `is_active` path) |

## Known gaps in the reconstruction

- **Admin-panel objects are not included.** `audit_log`,
  `stockholder_transaction_approvals`, `v_stockholder_transactions_search`,
  `is_portal_admin()` and the portal-admin session helpers are omitted. The
  sibling admin panel will not run against this database as-is.
- **The 11 committed migrations in `../migrations/` are not applied.** They patch
  admin-side objects that do not exist here; applying them will error.
- **The seeded certificate has no file behind it.** Upload a PDF to the
  `stock-certificates` bucket at
  `11111111-1111-1111-1111-111111111111/certificate-2019.pdf` to exercise the
  PDF viewer; until then the row lists but will not open.
- **Column types are inferred.** e.g. `birth_date_hijri` is `text` (it holds
  Hijri strings like `1400-05-12`) while `birth_date_gregorian` is `date`.
- **The write policies are deliberately loose.** Inserts into `feedback`,
  `feedback_responses`, `feedback_answers` and `contact_submissions` use
  `with check (true)`, and there is no per-submission rate limiting. Production
  tightened exactly this (see migration
  `20260728141926_secure_feedback_tables_remove_anonymous_write_access.sql`), so
  **do not copy these policies into a production project.**

## Validation

Both files are verified against a real PostgreSQL 16.4 cluster (installed in
userspace at `~/.local/pgsql`, listening on port 5433) using a Supabase shim that
provides the `auth`/`storage` schemas and the `anon`/`authenticated`/
`service_role` roles. Applying the schema and seed succeeds, and 18 assertions
pass covering the portal's real query paths:

| Checked as | Result |
|---|---|
| Ahmed (`1000000001`) | sees exactly his 1 profile row, 3 transactions, 3 dividend years, 1 certificate; net 650 shares / 66,500 SAR |
| Any signed-in user | sees the 2 published announcements but **not** the draft; sees 4 active survey questions |
| Sara (`1000000002`) | sees only her own 2 transactions, and 0 of Ahmed's certificates |
| No JWT | 0 stockholders, 0 transactions — nothing leaks |
| Any signed-in user | `otp_verification_codes` and `request_rate_limits` return 0 rows (service-role only) |
| Write paths | contact submission, survey response + answers, and legacy feedback all insert successfully |

The test scripts live next to the cluster in `~/.local/pgsql/client/`
(`00_supabase_shim.sql`, `run.mjs`, `rls_test.mjs`, `insert_test.mjs`). To re-run:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
~/.local/pgsql/bin/pg_ctl -D ~/.local/pgsql/data -o "-p 5433" -l ~/.local/pgsql/server.log start
cd ~/.local/pgsql/client && node rls_test.mjs && node insert_test.mjs
```
