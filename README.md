# Tawani Integration

Three services that work together but stay independently owned:

| Directory | What it is | Stack |
|---|---|---|
| `shareholders-main/` | Stockholder portal — shareholders and subscribers sign in with National ID + OTP | React 18, Vite, Tailwind, Supabase |
| `stackholders-admin-panel-main/` | Admin panel — manage users, shares, dividends, announcements, reports | React 18, Vite, TanStack Query, Supabase |
| `--main/` | **Tawani agent** — Arabic tourism news + AI report generation | FastAPI, LangGraph, AWS Bedrock, SQLite |

## How they fit together

The agent **owns its own data**. It scrapes tourism news, generates Arabic
reports as PDFs, and keeps both in its own SQLite database — nothing about a
report is mirrored into Supabase. The two React apps reach it over HTTP through
a same-origin `/tawani` path, so there is no CORS surface between them.

```
      browser
         │
     nginx (host, TLS)
         ├── /            → portal or admin container
         └── /tawani/*    → agent container ──→ its own SQLite + PDFs
                 │
      portal/admin ──→ Supabase (shareholder data, auth)
```

Generating a report costs minutes of LLM time, so it lives **only** in the admin
panel. The portal is read-only over the same API.

## Roles

Four roles, carried in the Supabase JWT as `app_metadata.role`:

| Role | Signs into | Sees |
|---|---|---|
| **admin** | admin panel | everything |
| **editor** | admin panel | Tourism News, Tourism Reports, Announcements only |
| **shareholder** | portal | own shareholding + published content |
| **subscriber** | portal | published content only — no financial data |

Admins and editors are auth accounts created in the Users tab. Shareholders and
subscribers are directory rows; their auth account is minted by `auth-login` on
first successful OTP.

Editors deliberately never receive `portal_admin`, so the database's own
`is_portal_admin()` RLS policies keep them out of shareholder tables regardless
of what the UI does.

## Running locally

```bash
# Agent
cd --main/quality_bot && ../.venv/Scripts/python -m uvicorn agent.api:app --port 8010

# Portal      → http://localhost:3000
cd shareholders-main/shareholders-main && npm run dev

# Admin panel → http://localhost:3001
cd stackholders-admin-panel-main/stackholders-admin-panel-main && npm run dev
```

Both apps proxy `/tawani/*` to the agent through the Vite dev server, so the
browser stays same-origin and never needs the agent's host name.

### Switching Supabase project

Each app keeps `.env.testproject` / `.env.local.testproject` backups:

```bash
cp shareholders-main/shareholders-main/.env.local.testproject \
   shareholders-main/shareholders-main/.env.local
cp stackholders-admin-panel-main/stackholders-admin-panel-main/.env.testproject \
   stackholders-admin-panel-main/stackholders-admin-panel-main/.env
```

Restart both dev servers afterwards — Vite reads `.env` at startup.

## Deployment

Live on `165.22.84.74`:

- portal — https://jtgcsa.thetransformix.com
- admin — https://admin.jtgcsa.thetransformix.com

Full recipe in [DEPLOYMENT.md](DEPLOYMENT.md).

### Note: the admin key and report generation

`VITE_TAWANI_ADMIN_KEY` is **not a secret**. Anything `VITE_*` is compiled into
the public JS bundle and readable by anyone who loads the admin panel, signed in
or not. So it can never be what protects the agent's generate/publish routes.

The first deployment set `TAWANI_ADMIN_KEY` on the agent while leaving the
matching build arg empty, which made the two disagree: the agent demanded a
header the admin bundle was built never to send, and every `POST /reports/*`
returned **401**. Resolved by clearing `TAWANI_ADMIN_KEY` on the agent and
letting nginx be the control it always effectively was:

- **portal vhost** — only `GET`/`HEAD` on `/tawani/news` and `/tawani/library`;
  everything else under `/tawani/` returns 403
- **admin vhost** — full access, 900s read timeout for 1–6 minute report runs

If you ever set `TAWANI_ADMIN_KEY` again, you must rebuild the admin image with
`ADMIN_TAWANI_KEY` set to the same value, or generation breaks the same way.

## Remaining work

### 1. Replace the shared key with JWT verification (recommended)

Right now anyone who can reach `admin.jtgcsa.thetransformix.com` can start a
report run, and each run costs real Bedrock tokens. nginx is the only gate.

The durable fix is for `require_admin` in `--main/quality_bot/agent/api.py` to
verify the caller's Supabase JWT (`portal_admin` / `role` claims) instead of a
shared key, with the client sending its session token. That ties generation to
an actual admin login rather than to who can reach the URL.

**Interim mitigation:** uncomment the `allow`/`deny` block in
`deploy/nginx/tawani-admin.conf` to restrict the panel to known networks.

### 2. Regenerate the X/Twitter token

`fetch_twitter_news` gets **401 on every endpoint**, including a basic tweet
lookup — the token is revoked or expired. The feed degrades gracefully and runs
on Skift, the Saudi Press Agency and The National, so nothing is broken; the X
sources are simply absent.

Regenerate at [developer.x.com](https://developer.x.com) → Keys and tokens →
Bearer Token, and put it in `--main/.env`. Note `/2/tweets/search/recent` needs
at least X's **Basic** tier; on the free tier a valid token still returns 403.

### 3. Production OTP mode

`TWILIO_ENV` on the production Supabase project switches OTP verification:

- `production` — real SMS codes, rate limiting on
- `test` — `123456` works for **any** active shareholder, **and rate limiting is
  disabled**

`test` is for short, supervised testing only. On a public URL it means anyone
who knows a national ID can read that person's financial records. A safer
alternative already exists in `auth-login`: set `REVIEWER_NATIONAL_ID` and
`REVIEWER_OTP_CODE` to give exactly **one** account a fixed code while everyone
else still needs a real OTP.

### 4. Housekeeping

- `AdminUsers.tsx` is unused (superseded by `Users.tsx`) — `knip` flags it
- The `--main/` directory name breaks any tool that parses argv (`scp`, `cd`,
  `grep` all trip on the leading dashes). Renaming it would remove a whole class
  of papercuts, at the cost of touching the Dockerfile, compose context and
  `CLAUDE.md`
- Rotate the Supabase access tokens and the generated admin password used during
  setup

## Database

`supabase/migrations/` is the source of truth for production. `supabase/dev/`
holds a reconstruction for the disposable test project plus the scripts that
close the gaps it was missing (`03`–`05`).

The two projects are **not** identical: production carries an `audit_log`, push
notification machinery, PDPL deletion support and 41 RLS policies that the dev
reconstruction never had. Anything touching those works in production and fails
locally — see the notes in `supabase/dev/README.md`.
