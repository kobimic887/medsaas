# What production actually is

> ⚠ **Snapshot taken 2026-07-28; two things have changed since.** The findings are still the
> best measured record of what production *is*, but: (1) all four services are now under
> **systemd** (`deploy/83/systemd/`) and enabled, so "hand-started in shells, a reboot ends
> production" is **no longer true**; (2) this repo's server runs alongside on **:5174**, and
> the public site was deliberately rolled back to the original Pyxis on 2026-07-31. Where this
> file describes process management, check
> [`deploy/83/systemd/README.md`](../deploy/83/systemd/README.md) instead.

**Inventoried 2026-07-28 over SSH, read-only.** Phase 0.9 / 0.2 / 0.10 of
[ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md).

Nobody had ever looked. Several things every other document in `docs/` asserted turn out to be
wrong, and one of them **blocks the migration**. Corrections are marked ❌.

---

## 1. The machine

`83.229.87.94`, hostname `chem`, x86_64, Ubuntu, up 26 days, `ufw` **inactive** and `iptables`
INPUT policy `ACCEPT` — no host firewall.

## 2. What is actually running

| Port | Process | From | Started |
|---|---|---|---|
| 80/443 | nginx | — | — |
| **3000** | `node index.js` | **`/root/chem_beo`** | Jul 02 |
| **3001** | `node stripe-server.cjs` | `/root/material-tailwind-dashboard-react` | Jul 02 |
| **5173** | **`vite`** (dev server) | `/root/material-tailwind-dashboard-react` | Jul 08 |
| 8000 | `uvicorn app:app` (Docker `gromacs-api`) | — | 3 weeks |
| 4000 | `bun dist/index.js`, user `finsrv` | — | — (**not ours** — `app.fin-srv.com`) |

Every one of the Pyxis processes was started by hand inside a **detached GNU `screen`
session** — three of them, owned by `root`:

```
1765.screen1   Jul 02 19:49   → npm run start   → node index.js            (chem_beo, :3000)
1899.screen0   Jul 02 19:50   → npm run dev     → stripe-server.cjs        (:3001)
451103.screen1 Jul 08 11:10   → npm run dev     → concurrently vite+stripe (:5173)
```

`pstree` confirms the chain: `systemd(1) → screen → bash → npm → sh → node`. No systemd unit,
no pm2, no Docker, no restart policy, no crontab. There are **two duplicate `concurrently`
stacks** (Jul 02 and Jul 08); only one of each pair won its port, the other is a zombie that
failed to bind and was left running.

**A reboot takes production down permanently until a human logs in and retypes the commands.**
26 days of uptime is the only thing that has been keeping the product alive.

**For an agent working here this is good news and bad news.** Good: `screen -r <pid>` reattaches
to a real, restartable session, so the cutover mechanism (edit `src/utils/api.js`, restart vite)
is reachable without inventing a supervisor. Bad: there is no record anywhere of the exact
commands, and killing the wrong one of a duplicate pair is indistinguishable from killing the
live one until the port goes quiet. **Note the PIDs before touching anything, and never restart
`chem_beo` and the vite stack in the same step.**

### ❌ Correction: `/convertSTR` on :8001 is not running

Documented as a live service on this box. Nothing listens on 8001. `SDF_CONVERTER_URL` points
at a service that is **down**, which means `/api/diffdock/generate` cannot be working today.

### ✅ Finding: GROMACS *is* deployed, here

Docs said "not currently deployed anywhere." It has been up 3 weeks in Docker on `:8000`
(`uvicorn app:app`, healthy). This is the "ADMET/GROMACS ran somewhere once" note in Phase 0.5 —
resolved, and the working config is on this box.

## 3. The request path

```
app.pyxis-discovery.com:443
        │  nginx  (sites-enabled/app.pyxis-discovery.com)
        │  location /  →  proxy_pass http://localhost:5173
        ▼
   VITE DEV SERVER  ── /api/* ──► 127.0.0.1:3001   stripe-server.cjs (7 routes)
                                                    Stripe + email only
   the browser also calls, directly, bypassing nginx entirely:
        https://app.pyxis-discovery.com:3000  ──►  chem_beo/index.js (73 routes)
```

Three things fall out of this:

1. **The production frontend is a Vite dev server.** No build, no `dist/`, no static files.
   nginx proxies straight into `vite`, websocket upgrade headers and all.
2. **The main API is a second HTTPS server on :3000**, terminating TLS itself from
   `/etc/letsencrypt/live/app.pyxis-discovery.com/` (`chem_beo/index.js:3132-3135`) and bound
   `0.0.0.0`. It bypasses nginx completely. With no firewall, it is directly internet-facing.
3. `chem_beo/index.js:41` is `app.use(cors())` — **wildcard CORS**, every origin, on the API
   that serves all 73 routes.

### ❌ Correction: the frontend is not "an older copy of this repo"

It is **`/root/material-tailwind-dashboard-react`** — the Creative Tim template this project
was originally built from. The backend is **`/root/chem_beo`** (4,358 lines, 73 routes), the
legacy repo the migration docs refer to. Neither is a checkout of this repository. "This repo's
`client/` is a strict superset of what runs on 83" was wrong: they are different lineages, and
the delta is a rewrite, not a version bump.

## 4. The database

### ❌ Correction: production Mongo is **Atlas**, not on 83

```
MONGODB_URI=mongodb+srv://<redacted>@cluster0.asrz0o3.mongodb.net/?appName=Cluster0
```

No `mongod` runs on 83 and no Mongo container exists. Every plan that said "83's Mongo is
production, `mongodump` it onto the box" was wrong about *where*, though right about *which*.

Consequences that change the runbook:

- Phase 4's dump/restore is a **cloud egress**, not a local file copy. It can be run from
  anywhere with the URI and an allowlisted IP — including from the box itself.
- **Atlas can simply stay.** Nothing forces the database onto the box. It is off-Moscow,
  already backed up by Atlas, and moving it re-creates the single-chassis backup problem the
  runbook flags as its largest open risk. **Recommend keeping Atlas and moving only compute.**
- The URI carries **no database name**, so the driver falls back to `test`. Production data is
  in a database literally called `test`.
- See [[atlas-tls-rejection]]: a TLS alert 80 from Atlas means the client IP is not allowlisted.
  **The box's IP has to be added to the Atlas allowlist before it can serve anything.**

### Contents of `test`

| Collection | Count |
|---|---|
| `users` | **50** |
| `companies` | 1 |
| `simulation_logs` | **4** |
| `audit_logs` | 2 |
| `billing_events` | **0** |

Four docks, ever. Zero billing events — consistent with [[stripe-integration-status]]: checkout
works but no webhook is registered, so no purchase has ever granted credits.

## 5. 🛑 The blocker — user schema

Runbook check 0.10 requires `users` without `companyId` to be **0**. It is **49 of 50**.

Field coverage across the 50 production users:

| Field | Present |
|---|---|
| `verified` | 50 / 50 |
| `companyId` | **1 / 50** |
| `role` | **1 / 50** |
| `active` | **1 / 50** |
| `companyName` | **1 / 50** |
| `createdAt` | **1 / 50** |

And `simulationTokens` by BSON type: **`int` 2 · `string` 1 · missing 47.**

The legacy user document is:

```js
{ _id, username, email, password, verified,
  phoneNumber, shippingAddress, billingAddress, simulationTokens }
```

This repo's `server/index.js` expects `companyId`, `role`, `active`, and a numeric
`simulationTokens`. Deploy it against this data as-is and:

- **New results go missing as they are created.** ⚠️ *Corrected — this originally read "every
  tenant-filtered query returns nothing", which was too strong.* `buildTenantFilter`
  (`server/index.js:1065`) falls back to `{'user.username': …}` when `companyId` is absent, and
  that matches the **legacy** `simulation_logs` shape. But this repo writes `username` at the
  **top level**, so such a user still sees their old docks and **never sees a new one** — and
  the cache lookup misses too, so they are **charged again for a dock they already paid for.**
  See [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §8.
- **Nobody can run a simulation.** `chargeSimulationToken` filters on
  `simulationTokens: { $gt: 0 }`; 47 users have no such field, so every attempt is
  `403 No simulation tokens left`.
- **One user breaks `$inc` outright** — `simulationTokens` is a **string**, and `$inc` on a
  string is a MongoDB error, not a coercion.

The single complete user, the single company, and the `companies` document (which matches this
repo's shape exactly, `usagePolicy`/`monthlyUsage` and all) were created by someone running the
**new** server against this database at some point. So the two schemas already coexist.

**This is a data migration, and it is a prerequisite, not a follow-up.** It needs: backfill
`companyId`/`companyName`/`role`/`active`/`createdAt` for 49 users, coerce `simulationTokens`
to a number with a decided default, and a decision on which company the legacy users belong to
(almost certainly the one that exists). Write it as an idempotent script, dry-run it against an
Atlas restore, never against production first.

## 6. Consequences for the migration plan

1. **Keep Atlas.** Move compute only. Add the box's IP to the Atlas allowlist. Removes the
   dump/restore, the write-freeze window, and the single-chassis backup risk in one decision.
2. **The frontend is a rewrite, not an upgrade.** This repo's `client/` replaces a different
   codebase. ⚠ The §5.0 symlink-swap plan does **not** apply — see item 3. There is no bundle to
   preserve, because there is no bundle. **Rollback means restarting the Vite dev server**, so
   `/root/material-tailwind-dashboard-react` must not be touched or deleted.
3. ~~**Serving the new frontend needs an nginx change**~~ — ✅ **WRONG, corrected 2026-07-29.
   It needs no nginx change.** The claim was that `proxy_pass http://localhost:5173` would have
   to become a static `root`. It does not: this repo's `server/index.js` reads `PORT`
   (`:5368`) and serves `client/dist` through `express.static` when `FRONTEND_DIST` is set
   (`:6699`). So run it **on 5173**:

   ```bash
   PORT=5173 FRONTEND_DIST=/path/to/client/dist node server/index.js
   ```

   nginx keeps proxying to 5173 and never learns anything changed. **The swap is which process
   owns port 5173**, and the rollback is stopping it and restarting `npm run dev` in
   `/root/material-tailwind-dashboard-react` — which is also why that directory must never be
   deleted. This is *better* than the symlink-webroot plan in ARRIVAL-RUNBOOK §5.0, which
   assumed a static bundle that does not exist here.

   It also gets the new frontend and the new API **on one origin through nginx's TLS**, which
   retires `:3000` (finding 3/5 below) in the same action.
4. **The user migration blocks the cutover.** §5.
5. **Retiring :3000 is a security fix as well as a migration step** — an internet-facing Node
   process with wildcard CORS, no firewall, hand-started in a terminal.
6. `/convertSTR` is already down; DiffDock is already broken. Rebuild it on the box rather than
   migrating it.
7. **GROMACS's working config is on this box** — capture it before decommissioning.
8. **Oracle cannot be decommissioned on the schedule the runbook gives.** It serves production
   Tanimoto. §7.
9. **83 needs a supervisor before it needs a migration.** Three hand-started `screen` sessions
   are the only thing between the product and a reboot. §2.

### The open decision — what the NEW box runs

**Terminology, because it caused a misread:** "the box" in every document means the **new
Amsterdam GPU machine**. `83.229.87.94` is the current VPS. Confirmed 2026-07-28: **83 runs
`chem_beo`** — that is current state, not a decision about the new box.

**Recommendation: the new box should run neither API server. It should run the docking engines
only.**

```
browser → 83 (chem_beo, unchanged) ──docking──► NEW BOX (AutoDock-GPU, DiffDock, convertSTR)
               │
               └──users/credits──► Atlas (unchanged)
```

The box was bought because Moscow goes down. That requires it to answer docking requests in the
shape recorded in [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) — `pdbid` + `smiles` in,
`{pdb, sdf}` out. It does not require it to serve an API, a session, or a database.

Why that is optimal rather than merely easier:

- **The §5 user-migration blocker never applies.** Nothing touches the database.
- **Cutover becomes one URL**, once the env-var lift below is done. Rollback is identical.
- **Latency is irrelevant.** A dock takes seconds to minutes; one WAN hop is noise. There is no
  performance case for co-locating the API with the GPUs.
- **Blast radius is one feature.** A wrong AutoDock build breaks docking and you flip the URL
  back. Login, billing, catalog and Tanimoto stay out of the failure path — unlike a full API
  migration, where all of them are exposed on day one.
- **The GPUs do GPU work.** Running Express on a €25k Threadripper is the least valuable use
  of it.

Whether the API *eventually* moves to the box, and whether that is `chem_beo` or this repo,
then becomes a later decision made with the box already proven, rather than a bet the migration
depends on.

### Either way, these follow from `chem_beo` being what serves users

**1. 🛑 "Cutover is config, not a deploy" is false.** This is the single most load-bearing claim
in the whole migration, repeated in `CLAUDE.md`, `BOX-SPEC.md` and
the runbook. It is a property of **this repo's** `ligandServiceConfig`, which `chem_beo` does
not have — `grep -c ligandServiceConfig index.js` returns **0**. All five service URLs are
string literals:

| Service | `chem_beo/index.js` |
|---|---|
| Docking (GET, the 1-click path) | `1502` — `https://services.asinex.com:8000/docking/…` |
| Docking (POST) | `1589` — `https://services.asinex.com:8000/docking` |
| DiffDock | `2580` — `https://services.asinex.com:58000/molecular-docking/diffdock/generate` |
| Catalog | `1850` — `const ASINEX_API_BASE = 'http://dev.asinex.com:58181'` |
| Stock | `1454` — `https://stock.asinex.com:5443/api/Shop` |
| Tanimoto ×9 | `198`–`439` — `http://151.145.91.17:8000` (Oracle) |

`chem_beo` reads only eight env vars, none of them a service address: `BASE_URL`, `GMAIL_PASS`,
`GMAIL_USER`, `JWT_SECRET`, `MONGODB_URI`, `NODE_ENV`, `PORT`, `STRIPE_SECRET_KEY`.

**So the docking cutover is a source edit and a process restart, and so is the rollback.** That
is materially riskier than a config field, and it is not what any runbook step describes.

**Recommended first change to `chem_beo`, before arrival day:** lift those six addresses into
env vars with the current values as defaults. It is a small, mechanical, individually testable
patch, it changes no behaviour when the env is unset, and it restores the property the entire
plan was designed around — cut over by changing an environment variable and restarting, roll
back by changing it back. Doing this *before* the box exists means arrival day is a config
change against a server that has already been running with the new code for weeks.

**2. Nothing in this repository ships today.** The credit-refund fix, the atomic charge, the NVIDIA
429 key pool and the upstream-401→502 mapping all live in `server/index.js`, which will not run.
`chem_beo` has none of them, and it has the same underlying bugs: it charges the credit before
calling Asinex (`1487`–`1495`, `1575`–`1582`) with no refund path, using the same
`findOne`-then-`updateOne` race. **If those fixes are wanted, they must be ported.** They are
~80 lines and the reasoning is in `956f9d9`, `47babcb` and `7f2e83e`.

**3. The credit-minting hole in §8 is now permanent unless fixed.** `POST
/api/issueSimulationTokens` at `chem_beo/index.js:3343` lets any authenticated user `$set` their
own balance from the request body. It was going to be fixed *by* the migration, since this
repo's server has no such route. Now it survives the migration. **It has to be deleted or
locked down in `chem_beo` directly.**

**What this repo becomes** is now an open question worth asking deliberately rather than by
default: it is not the production server, so it is either a rewrite that eventually replaces
`chem_beo`, or it is dead code. Nobody should keep maintaining it on the assumption it ships.

## 7. 🛑 Oracle is production, and every document says it is not

This is the second blocker, and it is the one most likely to be tripped by an agent following
the existing plan.

`chem_beo/index.js` exposes **nine** `/tanimoto/*` routes and **every one of them proxies to
`http://151.145.91.17:8000` — Oracle — hardcoded, no env var, plaintext HTTP across the public
internet, and none of them carries `authenticateToken`:**

| `chem_beo` route | line | forwards to Oracle | auth |
|---|---|---|---|
| `GET /tanimoto/health` | 196 | `/health` | none |
| `POST /tanimoto/v1/upload` | 222 | `/v1/upload` | none |
| `GET /tanimoto/v1/search/exact` | 250 | `/v1/search/exact` | none |
| `GET /tanimoto/v1/search/similarity` | 293 | `/v1/search/similarity` | none |
| `GET /tanimoto/v1/search/substructure` | 319 | `/v1/search/substructure` | none |
| `POST /tanimoto/v1/search/batch` | 361 | `/v1/search/batch` | none |
| `GET /tanimoto/v1/datasets` | 383 | `/v1/datasets` | none |
| `GET /tanimoto/v1/datasets/:dataset_id` | 410 | `/v1/datasets/…` | none |
| **`DELETE /tanimoto/v1/datasets/:dataset_id`** | **437** | **`axios.delete('…/v1/datasets/…')`** | **none** |

`authenticateToken` is defined at `index.js:1441` and applied throughout `/api/*`. It is applied
to **no** `/tanimoto/*` route. Combined with §2's finding that `:3000` is internet-facing with
wildcard CORS and no host firewall, the last row means **anyone on the internet can delete the
dataset** — see §8.

### What is actually in that Postgres

Queried live through the proxy: `/v1/datasets` reports **2,951,975 molecules**, in a dataset
built from **`molsd4.csv`** and indexed **2026-03-12**.

**That corpus exists only on Oracle.** Nobody has identified where `molsd4.csv` lives, or
whether it still exists at all. Until someone does, the `pg_dump` is not a belt-and-braces
extra — it is **the only copy of three million indexed molecules**, and "rebuild from source
data on the box" has no source to rebuild from. Establishing whether `molsd4.csv` survives
somewhere is a Phase 0 task nobody has been given.

And the deployed frontend calls them. `src/pages/dashboard/deep-similarity.jsx:34-38` builds
`API_CONFIG.buildUrl('/tanimoto/v1/search/{exact,similarity,substructure}')`, which resolves to
`https://app.pyxis-discovery.com:3000/tanimoto/…`. So the full live path is:

```
browser → :3000 chem_beo → 151.145.91.17:8000 tonomitosql → Postgres/RDKit
```

**Verified live, 2026-07-28**, from 83:

```
$ curl http://151.145.91.17:8000/health          → HTTP 200 in 0.15s
$ curl http://151.145.91.17:8000/v1/datasets
{"datasets":[{"id":3,"name":"DATA","filename":"molsd4.csv",
              "row_count":2951975,"created_at":"2026-03-12 21:00:52+00"}],"count":1}
```

**2,951,975 molecules**, indexed 2026-03-12, in a single dataset named `DATA` built from
`molsd4.csv`. That is the production search corpus, and it lives only on Oracle.

Note also that these nine proxies carry **no `authenticateToken`** in `chem_beo` — unlike this
repo, where all nine equivalents sit behind auth. Anyone who can reach `:3000` can query the
corpus today.

### ❌ Correction: "Oracle is a side project, not production"

`deploy.yml` is titled *Build & Deploy (non-prod)* and that is true **of `medsaas-app-1`**. It
is not true of the machine. `tonomitosql-api-1` and `tonomitosql-db-1` on the same host answer
live user traffic from the Deep Similarity page today.

Consequences, in order of how much damage the mistake does:

1. **Phase 7's removal order is wrong.** It lists `tonomitosql-api-1` and `tonomitosql-db-1` as
   items 4 and 5 to be removed "once the box has answered real queries" — but treats the whole
   machine as discardable. Removing either **breaks a live dashboard feature**, and there is no
   config flip to roll it back: the URL is a string literal in `chem_beo`.
2. **The Postgres index is production data, not a non-prod artefact.** §4.3's "prefer rebuilding
   from source data on the box" was reasoning from the belief that the index was disposable. The
   `pg_dump` is now the primary path, and it must be taken and verified **before** anything on
   Oracle is touched — not as a nice-to-have afterthought.
3. **`server/index.js:80` is not a stale fallback.** The runbook calls
   `TANIMOTO_API_BASE`'s default of `http://151.145.91.17:8000` a leftover that "silently routes
   Tanimoto to a decommissioned host." It currently points at the *live* host. Delete it as part
   of standing the service up on the box — not before.
4. **Rule 4 of the runbook still holds and is unaffected.** *Mongo* must never be restored from
   Oracle; Oracle's Mongo is genuinely a side-project copy. The correction is about **Postgres**,
   which is a different database on the same machine. Do not let one collapse into the other.

### The related trap: `ligandServiceConfig` does not exist in production

The single `companies` document has **no `ligandServiceConfig` field at all**, and `chem_beo`
never reads one — it hardcodes `services.asinex.com:8000`, `services.asinex.com:58000`,
`dev.asinex.com:58181` and `stock.asinex.com:5443` as string literals.

So Phase 0.3 is answered — there are no stale overrides — but the more important consequence is
that **"cutover is config, not a deploy" is only true of the server in this repo.** Against what
is deployed today, repointing docking at the box is a **code edit and a process restart on 83**.
That property is inherited only once this repo's server is the thing running.

## 8. Security findings

None of these are caused by the migration; all of them are made worse by leaving them until it.

| # | Finding | Where | Action |
|---|---|---|---|
| 1 | **A live GitHub personal access token is embedded in a git remote URL**, in the clear, for user `eitangenis` | `/root/chem_beo/.git/config` | **Revoke it now.** It grants repo access to anyone who reads that file, and it is recoverable from any backup or clone of the host |
| 2 | **Credits can be minted from the browser, and it writes to the production database.** There are *two* `/api/issueSimulationTokens` routes and the dangerous one is not the obvious one. `stripe-server.cjs:202` is unauthenticated but a **no-op** — it returns `{success:true}` and its own comment says *"the client will handle updating localStorage"*. The real one is **`chem_beo/index.js:3343`**: it *is* behind `authenticateToken`, then takes the amount **from the request body** and does `$set: {simulationTokens: amount}` with `upsert:true` on the caller's own account. **Any logged-in user can set their own balance to any number with one POST.** Verified by reading the handler | `chem_beo/index.js:3343` · `stripe-server.cjs:202` | **Highest severity here.** Unlimited free docking for anyone with an account, against the live Atlas database, and credits are the only monetisation. Neither route may survive the cutover. This repo's server has no equivalent — credits come only from the Stripe webhook — so the fix ships with the migration, but the exposure is live now |
| 2b | **There is no Stripe webhook endpoint anywhere on 83** | — | This is why `billing_events` is 0. Runbook 3.2 calls it "re-register the webhook" — it is a **first-time registration** |
| 3 | The API on `:3000` is **internet-facing with wildcard CORS** (`app.use(cors())`, `index.js:41`) and **no host firewall** (`ufw` inactive, iptables INPUT `ACCEPT`) | `chem_beo` | Fixed by retiring `:3000` in favour of the box behind a reverse proxy with an explicit origin allowlist |
| 3b | **An unauthenticated `DELETE` proxies straight to Oracle's dataset API.** `DELETE /tanimoto/v1/datasets/:dataset_id` (`index.js:437`) does `axios.delete('http://151.145.91.17:8000/v1/datasets/…')` with no auth middleware — none of the nine `/tanimoto/*` routes has any (§7). With finding 3, **anyone on the internet can destroy the 2,951,975-molecule index**, which is the only copy | `chem_beo/index.js:437` | Take the `pg_dump` **today**, not on arrival day. Then either put `authenticateToken` on the route or drop it — a one-line change, and the only item on this page that is cheaper to fix now than to migrate around |
| 4 | Both `.env` files are mode **644** and contain Stripe secret keys | `chem_beo/.env`, `material-tailwind-dashboard-react/.env` | `chmod 600`, and rotate the Stripe secret if the host has ever been shared |
| 5 | Root SSH password authentication is enabled, and the password has been shared in plaintext | `83` | Rotate; move to keys. Runbook 1.4 does this on the box — 83 needs it too |

**Item 2 is also a correctness note for the migration.** This repo's server grants credits
*only* from `checkout.session.completed`. Production grants them from a frontend call. Any user
who has credits today got them by a path the new server does not implement, so **credit balances
cannot be assumed to be reconstructable** — carry them across as data, do not try to replay them.

## 9. Rules observed during this inventory

Read-only throughout: `ps`, `ss`, `ls`, `grep`, `pstree`, `screen -ls`, `docker inspect`,
`curl` against localhost, and Mongo `countDocuments` / `find` / `findOne`. Nothing was started,
stopped, edited or deleted. nginx, TLS, DNS and the firewall were not touched, and the unrelated
`finsrv` stack on `:4000` was not inspected beyond noting the port.

**One exception, stated plainly:** the Mongo queries needed the driver and the `MONGODB_URI`,
both of which live in `/root/chem_beo`. Three throwaway scripts (`.inv.mjs`, `.inv2.mjs`,
`.inv3.mjs`) were written into that directory, run with `node`, and deleted in the same command.
`git status` in `/root/chem_beo` is unchanged by this — it shows only the three untracked
`*.json` files that were already there. **A fresh agent should not copy this pattern.** Prefer
running the queries from your own machine against the Atlas URI, which needs nothing on 83 at
all beyond an allowlisted IP.

**No credential from this host is recorded here or anywhere in this repo** — not the SSH
password, not the Atlas URI's user or password, not the contents of any `.env`. Field *names*
only. Keep it that way.
