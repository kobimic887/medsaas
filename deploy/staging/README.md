# Isolated Pyxis staging (`/staging/` on the existing hostname)

Owner-test staging lives at **https://app.pyxis-discovery.com/staging/** — no new
DNS record, subdomain, or certificate.

**Live since 2026-09-07** (branch `staging/folding-preview`, commit `2d32f4a`
— folding preview since `f06e8a6`, Simulation catalog + docking/DiffDock
owner-authorized at `2d32f4a`; tree `/root/pyxis-STAGING-5274`, service
`pyxis-web-staging` on loopback `:5274`). Nginx backups made at install (REAL
file copies — see the symlink warning below):
- `/root/pyxis-staging-nginx-backup.20260907T152427.original` — pre-staging
  config (md5 `4241cf29f104cb40d5ccbf0d722e01c3`)
- `/root/pyxis-staging-nginx-backup.20260907T152427.current` — config WITH the
  `/staging/` block (md5 `b9b5885e046cc015914841f6b8d93c82`)

> **Symlink trap:** on this host `/etc/nginx/sites-enabled/app.pyxis-discovery.com`
> is a symlink into `sites-available/`. Never back it up with `cp -a`, which
> copies the symlink and tracks the live file. Back up and restore FILE CONTENT:
> `sudo sh -c 'cat /etc/nginx/sites-available/app.pyxis-discovery.com > /root/...'`
> and `sudo sh -c 'cat /root/...original > /etc/nginx/sites-enabled/app.pyxis-discovery.com'`
> (writing through the symlink updates the sites-available target nginx reads). It is a *second, isolated application
process* on the same host (`oracleNew` / `84.13.81.51`), reached through an
nginx `location /staging/` that forwards to a loopback-only staging server.

The staging process is separate from the consumer app. It does not use the
production API or MongoDB Atlas, Stripe, or email. Docking/DiffDock are
explicitly forwarded to real providers and can incur cost. See
[`docs/STAGING.md`](../../docs/STAGING.md) for the isolation contract and the
demo/fixture semantics.

## Topology

| Thing | Value |
|---|---|
| Public URL | `https://app.pyxis-discovery.com/staging/` (nginx `:443`) |
| Staging service | systemd **`pyxis-web-staging`** — Bun, `server/index.js` |
| Listen | `127.0.0.1:5274` only (`BIND_HOST`), never public |
| Tree | `/root/pyxis-STAGING-5274` (mirrors the `pyxis-LIVE-5174` layout) |
| Frontend build | staging mode: `vite build --mode staging` (base `/staging/`, noindex, namespaced storage) |
| Mode | `PYXIS_DEMO_MODE=true` → **no MongoDB, no Stripe. Folding fixture-only; Simulation catalog read-only + real docking/DiffDock (owner-authorized)** |
| DB | none (in-process demo history store, resets on restart) |
| Sign-in | synthetic demo account via the sign-in page demo button |
| Production | untouched: same `pyxis-web` on `:5174`, same nginx server block |

### Ports / units on 84 (measured when this file was written)

- `pyxis-web` `:5174` — production (public)
- `pyxis-vite-legacy` `:5173`, `pyxis-api-legacy` `:3000`, `pyxis-stripe` `:3001` — stopped rollback
- `pyxis-convertstr` docker `127.0.0.1:8001` — converter (production only)
- **`pyxis-web-staging` `127.0.0.1:5274`** — this staging service (loopback)
- **`pyxis-macrocycle-search-staging` `127.0.0.1:8274`** — read-only macrocycle index (loopback)
- FinSrv `:4000` — unrelated

## Files

- `pyxis-web-staging.service` — systemd unit (install to `/etc/systemd/system/`)
- `nginx-staging.conf` — server-block snippet for `app.pyxis-discovery.com`
- `env.server.template` — non-secret env layout; secrets are generated on the host
- `pyxis-macrocycle-search-staging.service` — separate loopback index unit
- `10-macrocycle-search.conf` — staging-only web service drop-in
- `deploy-staging.sh` — repeatable staging deploy (run on 84 as root)
- `rollback-staging.sh` — remove routing + service + tree

## First install (one time, on 84, root)

```bash
# 0. Back up the nginx site file's content first (owner-approved action).
sudo sh -c 'cat /etc/nginx/sites-enabled/app.pyxis-discovery.com > \
      /root/pyxis-staging-nginx-backup.$(date +%Y%m%dT%H%M%S).original'

# 1. Ship the tree + built staging frontend (run from the Mac, this branch).
git archive --format=tar HEAD | ssh oracleNew \
  'sudo mkdir -p /root/pyxis-STAGING-5274 && sudo tar -x -C /root/pyxis-STAGING-5274'
tar -C client -cf - dist | ssh oracleNew \
  'sudo tar -x -C /root/pyxis-STAGING-5274/client'
#   client/dist MUST be the STAGING build (bun run build:staging), not the prod build.

# 2. Server deps + env (root on 84). The .env file is a credential file: only
#    write it after the owner approves this exact path.
cd /root/pyxis-STAGING-5274/server
bun install
umask 077
openssl rand -base64 48 > /dev/null   # just to confirm openssl exists
cat > /root/pyxis-STAGING-5274/server/.env <<EOF
PYXIS_DEMO_MODE=true
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
# Real Simulation services (owner-authorized): catalog defaults to
# http://dev.asinex.com:58181 when unset; docking/DiffDock default to
# services.asinex.com. Set SDF_CONVERTER_URL for DiffDock SMILES ligands.
SDF_CONVERTER_URL=http://127.0.0.1:8001/convertSTR
EOF
chmod 600 /root/pyxis-STAGING-5274/server/.env

# 3. Unit + start (never enable: staging must not autostart after a reboot).
cp /root/pyxis-STAGING-5274/deploy/staging/pyxis-web-staging.service /etc/systemd/system/
systemctl daemon-reload
systemctl start pyxis-web-staging
curl -s http://127.0.0.1:5274/health          # must answer {"status":"OK",...}
curl -s http://127.0.0.1:5274/api/staging/status

# 4. nginx routing. Validate BEFORE reloading; the reload touches production
#    nginx, so this is the only step with any blast radius on :443. The live
#    file is a symlink — back up CONTENT (cp -a would copy the link):
sudo sh -c 'cat /etc/nginx/sites-enabled/app.pyxis-discovery.com > \
      /root/pyxis-staging-nginx-backup.$(date +%Y%m%dT%H%M%S).original'
#   Insert the `location = /staging` + `location /staging/` block (from
#   nginx-staging.conf) inside the 443 server block, then:
nginx -t && systemctl reload nginx

# 5. Verify scoped + production unchanged.
curl -s -o /dev/null -w '%{http_code}\n' https://app.pyxis-discovery.com/staging/       # 200
curl -s https://app.pyxis-discovery.com/staging/api/staging/status                      # demo payload
curl -s -o /dev/null -w '%{http_code}\n' https://app.pyxis-discovery.com/               # 200 (prod root)
curl -s -o /dev/null -w '%{http_code}\n' https://app.pyxis-discovery.com/api/health     # prod API still fine
```

## Updating staging after code changes (Mac → 84)

```bash
cd /Users/kobigenis/projects/medsaas
bun --cwd=client run build:staging   # client/dist now = staging build (base /staging/)
git archive --format=tar HEAD | ssh oracleNew \
  'sudo tar -x -C /root/pyxis-STAGING-5274'
tar -C client -cf - dist | ssh oracleNew \
  'sudo tar -x -C /root/pyxis-STAGING-5274/client'
ssh oracleNew 'sudo systemctl restart pyxis-web-staging'
#   then rebuild the production default locally so the checked-out tree's
#   client/dist returns to the prod build:
bun --cwd=client run build
```

### Macrocycle preview configuration

The September 23 real and virtual macrocycle sources use the separate,
read-only compact search service (`pyxis-macrocycle-search-staging.service`)
bound to `127.0.0.1:8274`. Install
[`10-macrocycle-search.conf`](10-macrocycle-search.conf) as
`/etc/systemd/system/pyxis-web-staging.service.d/10-macrocycle-search.conf`
and run `systemctl daemon-reload` before restarting `pyxis-web-staging`.
This non-secret systemd setting points only the staging process at the index;
the app's `server/.env` holds its JWT secret and is not edited during preview
updates. The search service must be running and must list both exact dataset
names (`Macrocycles real stock — 2026-09-23` and
`Macrocycles virtual — 2026-09-23`) before the Simulation source controls
report them as available. If either is missing, its source reports unavailable
without substituting the older stock corpus or the Asinex catalog.

Copy the complete, validated index artifacts from the builder described in
[`docs/DATA-MACROCYCLES.md`](../../docs/DATA-MACROCYCLES.md) into
`/root/pyxis-macrocycle-index-staging` (six files: two each of `.fpb`,
`.rows.csv`, and `.manifest.json`). Install the service unit to
`/etc/systemd/system/pyxis-macrocycle-search-staging.service`. Check that
`curl http://127.0.0.1:8274/health` and `/v1/datasets` succeed before
restarting `pyxis-web-staging`. The unit starts neither automatically after a
reboot nor through production `pyxis-web`. Keep a copy of the previous staging
tree, `client/dist`, systemd fragments, and index directory for rollback;
restore only those and restart the two staging units if verification fails.

The preview index and staging API are separate loopback processes. The
consumer-facing Pyxis service on `:5174` has no macrocycle search environment
setting and its nginx route is unchanged. Keep the existing staging stock
search at `503 STOCK_SEARCH_UNAVAILABLE` until that separate dataset is
provisioned for staging.

> The deployed tree on 84 is **source + prebuilt dist**, like the live tree. The
> staging tree keeps `server/.env` (created above) — source uploads via
> `git archive` never overwrite it because `.env` is git-ignored and absent from
> the archive. Do not `git checkout .` or extract a full tarball over it either.

## Rollback / stop (restore only this task's changes)

```bash
# Full rollback of staging (routing, service, tree):
ssh oracleNew
systemctl stop pyxis-web-staging
rm /etc/systemd/system/pyxis-web-staging.service && systemctl daemon-reload
#   restore nginx CONTENT from the backup made before the /staging block was
#   added (sites-enabled is a symlink — write through it, never cp -a):
sudo sh -c 'cat /root/pyxis-staging-nginx-backup.<ts>.original > /etc/nginx/sites-enabled/app.pyxis-discovery.com'
sudo nginx -t && sudo systemctl reload nginx
#   tree can stay on disk (harmless, loopback-only); remove with:
sudo rm -rf /root/pyxis-STAGING-5274
```

Rollback never touches `/root/pyxis-LIVE-5174`, the `pyxis-web` unit, or the
production `.env`. Because the staging server binds `127.0.0.1:5274`, stopping
the unit plus removing the nginx location fully removes it from the internet.

## Owner notes

- Staging demo history (folding predictions and simulation runs) lives **in the
  process** and resets when `pyxis-web-staging` restarts. Persistent history
  needs an approved isolated database; production Atlas is off-limits by design.
- The demo folding predict is a labelled server fixture — no NVIDIA folding call.
- Simulation browsing/search is the **live read-only Asinex catalog**; docking
  and DiffDock forward to the **real providers** under the synthetic demo
  account (owner-authorized) and each run costs money. `SDF_CONVERTER_URL`
  points at 84's shared loopback converter container (a stateless utility).
  Stock-compound search reports `503 STOCK_SEARCH_UNAVAILABLE` until the
  separate Simulation stock service provisions a dataset for staging.
- Real-docking behaviour is fixture-verified in
  `server/test/staging-simulation.test.mjs`; the first live provider round-trip
  should happen in the owner's browser (it bills the service).
