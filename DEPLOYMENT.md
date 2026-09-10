# Deployment

Three containers behind the VPS's existing nginx. Nothing here has been deployed
yet — this is the recipe.

## How it fits the box

`165.22.84.74` already runs ~12 apps on one pattern, and this follows it rather
than inventing another:

- **nginx runs on the host**, not in a container, and owns TLS via certbot
- **each app is a container bound to `127.0.0.1:<port>`** — never `0.0.0.0`, so
  the only route in is nginx
- vhosts live in `/etc/nginx/sites-enabled/*.conf` and share
  `snippets/ssl.conf` + `snippets/proxy.conf`
- app directories live under `/root/<app-name>`

### Ports

Chosen to miss everything already listening (3000, 3002, 3010, 3030, 3040, 3050,
4003, 5004, 5050, 8000, 8001, 8011, 8080, 8085, 8090, 8099, 9000, 9005, …):

| Service | Host port | Container |
|---|---|---|
| portal | `127.0.0.1:3060` | nginx :80 |
| admin | `127.0.0.1:3061` | nginx :80 |
| agent | `127.0.0.1:8012` | uvicorn :8010 |

## The one thing to understand before building

**Vite inlines `VITE_*` variables at build time.** They are not runtime config:
the Supabase URL and key are compiled into the JS bundle. Pointing an image at a
different Supabase project means **rebuilding**, not restarting. That is why
`docker-compose.yml` passes them as `build.args`, not `environment`.

The agent is the opposite — plain runtime env, read from `--main/.env`.

## Steps

### 1. Copy the repo to the VPS

```bash
ssh root@165.22.84.74
cd /root
git clone https://github.com/AhmedELwekel2/tawani_integration.git tawani
cd tawani
```

### 2. Provide the secrets (never committed)

```bash
# Agent runtime secrets: AWS Bedrock, Twitter, etc.
cp --main/.env.example --main/.env
nano --main/.env          # AWS_BEARER_TOKEN_BEDROCK, AWS_REGION,
                          # AWS_BEDROCK_INFERENCE_PROFILE_ID, TWITTER_BEARER_TOKEN

# Build-time + compose config
cp .env.deploy.example .env
nano .env                 # PORTAL_/ADMIN_SUPABASE_URL + ANON_KEY, TAWANI_ADMIN_KEY
```

Leave `ADMIN_TAWANI_KEY` empty — see the security note below.

### 3. Build and start

```bash
docker compose build      # the agent image is large: Playwright + Chromium
docker compose up -d
docker compose ps
curl -s http://127.0.0.1:8012/health
curl -sI http://127.0.0.1:3060 | head -1
curl -sI http://127.0.0.1:3061 | head -1
```

### 4. nginx

```bash
cp deploy/nginx/tawani-portal.conf /etc/nginx/sites-available/
cp deploy/nginx/tawani-admin.conf  /etc/nginx/sites-available/
# set the real hostnames in both
ln -s /etc/nginx/sites-available/tawani-portal.conf /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/tawani-admin.conf  /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. Certificates

DNS must already point at the VPS.

```bash
certbot --nginx -d investors.example.com -d admin.example.com
```

### 6. Redeploying later

```bash
cd /root/tawani && git pull
docker compose build portal admin      # only if VITE_* or frontend code changed
docker compose up -d
```

The agent's database and PDFs live in named volumes (`agent-db`, `agent-data`),
so redeploys keep the published report library. `TAWANI_DB_PATH=/app/data/tawani.db`
puts SQLite on the volume — without it the database would sit in the image layer
and be lost on every rebuild.

## Security notes

**`VITE_TAWANI_ADMIN_KEY` is not a secret.** Any `VITE_*` value is compiled into
the public bundle and readable by anyone who loads the admin panel, signed in or
not. So the key alone does not protect the agent's generate/publish routes.

The real control is nginx, and the two vhosts differ deliberately:

- **portal** — only `GET`/`HEAD` on `/tawani/news` and `/tawani/library`;
  everything else under `/tawani/` returns 403. A tampered portal bundle still
  cannot start a paid LLM run.
- **admin** — full `/tawani/` access, with a 900s read timeout because a report
  run takes 1–6 minutes.

Set `TAWANI_ADMIN_KEY` on the agent anyway (defence in depth), and consider
restricting the admin vhost by IP — there is a commented `allow`/`deny` block in
`deploy/nginx/tawani-admin.conf`.

The durable fix is for the agent to verify the caller's Supabase JWT
(`portal_admin` / `role` claims) instead of a shared key. That is a contained
change to `require_admin` in `--main/quality_bot/agent/api.py`.

## Not yet verified

The Dockerfiles have **not been build-tested** — there is no Docker daemon on the
development machine. What has been checked: the compose file parses, every path
the Dockerfiles `COPY` exists in its build context, no `.dockerignore` excludes a
needed file, and both apps' `npm run build` succeeds outside Docker.

Expect the first `docker compose build` to need iteration, most likely on the
agent image (Playwright system libraries) rather than the two frontends.
