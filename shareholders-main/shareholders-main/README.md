# Stockholder Portal

A bilingual (Arabic / English) self-service web portal that allows Tour Guides Cooperative stockholders to log in with their National ID and view their account, shareholding details, transaction history, yearly dividends, and stock certificates.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 7 |
| Styling | Tailwind CSS 3, Framer Motion |
| Internationalisation | i18next / react-i18next (AR + EN) |
| Backend / DB | Supabase (PostgreSQL, Auth, Storage, Edge Functions) |
| OTP / SMS | Twilio Verify |

## Features

- **OTP Login** — stockholders authenticate with their National ID; a one-time code is sent to their registered phone number via Twilio Verify.
- **Dashboard** — personal profile, shareholding summary, transaction history, yearly dividends, and stock certificates (private signed-URL access).
- **Contact & Feedback forms** — with per-submission rate limiting enforced at the database level.
- **Privacy Notice** — bilingual PDPL-compliant privacy notice with consent checkpoint on every data-collection form.
- **Session timeout** — automatic idle session expiry with a warning modal.
- **RTL / LTR layout** — full right-to-left support for Arabic.

## Project Structure

```
src/
  components/       # Page-level and shared UI components
  context/          # AuthContext (session management)
  i18n/             # Translation files (en, ar)
  services/         # Supabase data-access layer (stockholderService.ts)
  lib/              # Utility helpers
supabase/
  functions/
    auth-send-otp/  # Edge Function: looks up national ID, triggers Twilio OTP
    auth-login/     # Edge Function: verifies OTP, issues Supabase session
docs/
  pdpl_dpia.md                      # Data Protection Impact Assessment
  pdpl_data_rights_and_retention.md # Data subject rights & retention schedule
```

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project
- A Twilio account with a Verify Service

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### 3. Configure Supabase Edge Function secrets

Set the following secrets in the Supabase dashboard (Edge Functions → Manage secrets):

| Secret | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service SID |
| `TWILIO_ENV` | `production` (live Twilio SMS) or `test` (mock OTP; see Testing) |

### 4. Run locally

```bash
npm run dev
```

### 5. Build for production

```bash
npm run build
```

## Test Login

> **Requires test mode to be active.** Follow the [Testing](#testing-local--staging) section below before attempting this.

### Step 1 — Enter National ID

Use the National ID of any **active** stockholder in your database.  
You can find one by running this in the Supabase SQL editor:

```sql
select national_id, name from public.stockholders where is_active = true limit 5;
```

### Step 2 — Enter OTP code

When test mode is active, no real SMS is sent. Enter the fixed code you set as `TEST_OTP_CODE` (default: `123456`).

### Step 3 — Access the dashboard

On success you are redirected to the stockholder dashboard showing the matching account's data.

---

## Edge Functions

### `auth-send-otp`

Receives a `national_id`, looks up the stockholder's phone number in the database, and triggers a Twilio Verify SMS. Includes:

- IP-based rate limiting (20 requests / hour) when not in OTP test mode
- National ID-based rate limiting (5 requests / hour) when not in OTP test mode
- Phone number sanitisation for Saudi numbers (`+966` format)
- CORS restricted to configured production origins

### `auth-login`

Receives `national_id` + `otp_code`, verifies the code against Twilio, then creates or updates a Supabase auth user and returns a session. Includes:

- Randomised password rotation on every login (no deterministic credentials)
- `portal_admin: false` enforced in `app_metadata` for all stockholder accounts
- Same rate limiting as `auth-send-otp` (disabled when `TWILIO_ENV=test`)

## Testing (Local / Staging)

To develop without sending real SMS messages, add the following secrets **temporarily** in the Supabase dashboard (Edge Functions → Manage secrets):

| Secret | Value |
|---|---|
| `ALLOWED_ORIGINS` | `http://localhost,http://localhost:3000,http://localhost:5173` (if needed for CORS) |
| `TWILIO_ENV` | `test` — mock OTP (`TEST_OTP_CODE`), no SMS, **no auth rate limits** |
| `TEST_OTP_CODE` | optional; default `123456` if unset |

With `TWILIO_ENV=test`, **any active stockholder national ID accepts `TEST_OTP_CODE` without a real SMS.**

**Still seeing “Too many requests” after setting `TWILIO_ENV=test`?**

1. **Redeploy both functions** — Changing secrets does not replace old deployed code. Run `supabase functions deploy auth-send-otp auth-login` (or deploy from the dashboard) so the running bundle includes the “skip rate limits in test mode” logic.
2. **Secret scope** — Add `TWILIO_ENV` under **Project Settings → Edge Functions → Secrets** (not only in your local `.env`; the portal app never sends this value to the browser).
3. **Value** — Use exactly `test` (no quotes in the dashboard). Leading/trailing spaces are trimmed by the functions.

### Switching back to production

When you are ready to go live, do the following in the Supabase secrets panel:

1. **Delete** `ALLOWED_ORIGINS` (or set to your production domains)
2. **Delete** `TEST_OTP_CODE` if you added a custom one
3. **Edit** `TWILIO_ENV` → `production`

Real OTPs will then be sent to stockholders' registered phone numbers via Twilio Verify.

## Changing Your Domain

When you move from your current hosting URL to a new domain (e.g. from a Hostinger preview URL to a custom domain like `app.yourcompany.com`), follow these steps:

### 1. Update the CORS allowed origins (Edge Functions)

The edge functions `auth-send-otp` and `auth-login` have your current domain hardcoded as the default allowed origin. You have two options:

**Option A — Set the `ALLOWED_ORIGINS` secret (recommended, no redeployment needed)**

In the Supabase dashboard → Edge Functions → Manage secrets, add or update:

| Secret | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://your-new-domain.com` |

The secret overrides the hardcoded default. Multiple origins can be comma-separated:
```
https://your-new-domain.com,https://www.your-new-domain.com
```

**Option B — Update the source code and redeploy**

In `supabase/functions/auth-send-otp/index.ts` and `supabase/functions/auth-login/index.ts`, update the `defaultAllowedOrigins` array at the top of each file, then redeploy both functions.

### 2. Update the Content Security Policy

In `index.html`, find the `<meta http-equiv="Content-Security-Policy" ...>` tag and update any explicit domain references to match your new domain.

### 3. Update `.env`

The `.env` file contains both runtime variables (read by the app) and local reference variables (documentation only). Here is what to update:

| Variable | Used by app? | Update on domain change? |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes — Supabase project URL | No — tied to Supabase, not your domain |
| `VITE_SUPABASE_ANON_KEY` | Yes — Supabase anon key | No — tied to Supabase, not your domain |
| `USER_DASHBOARD_URL` | No — local reference only | **Yes** — update to your new domain |
| `ADMIN_DASHBOARD_URL` | No — local reference only | **Yes** — update to your new domain |
| `ALLOWED_ORIGINS` | No — local reference only | **Yes** — update to your new domain |

> `ALLOWED_ORIGINS` in `.env` is a local reminder only. The value that actually controls the live edge functions is the `ALLOWED_ORIGINS` **secret** set in the Supabase dashboard (step 1 above).

The only time you need to update `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` is if you are **migrating to a different Supabase project**.

### 4. Redeploy the frontend

Rebuild and redeploy the site to your new hosting provider:

```bash
npm run build
```

Then upload the `dist/` folder to your new host.

### 4. Verify after the change

- Open the new URL → confirm the login page loads without CSP errors (check browser console)
- Attempt a login → confirm OTP is sent (test mode) or received via SMS (production)
- Confirm the old domain no longer works (CORS should block it)

---

## Security

- All sensitive identity data (`national_id`) is stored in `app_metadata` (server-controlled), not `user_metadata`.
- Row Level Security (RLS) is enabled on every table; stockholders can only read their own rows.
- Stock certificates are stored in a **private** Supabase Storage bucket; access is via short-lived signed URLs only.
- CORS is restricted to explicitly listed production origins.
- Content Security Policy headers are set in `index.html`.

## PDPL Compliance

- Privacy notice displayed at login and on every data-collection form (bilingual).
- Explicit consent checkbox required before form submission.
- Data subject rights workflow documented in `docs/pdpl_data_rights_and_retention.md`.
- Data Protection Impact Assessment in `docs/pdpl_dpia.md`.
