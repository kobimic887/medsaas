# What production actually is

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

- **Every tenant-filtered query returns nothing.** `buildTenantFilter` keys on `companyId`;
  49 users see an empty account.
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
   codebase. The §5.0 symlink-swap plan still works — but there is no "old bundle" directory to
   preserve, because there is no bundle. **Rollback means restarting the Vite dev server**, so
   `/root/material-tailwind-dashboard-react` must not be touched or deleted.
3. **Serving the new frontend needs an nginx change** — `proxy_pass` to :5173 has to become a
   static `root`. That is exactly the change the standing rule forbids without the box owner.
   **Raise it early; it is on the critical path.**
4. **The user migration blocks the cutover.** §5.
5. **Retiring :3000 is a security fix as well as a migration step** — an internet-facing Node
   process with wildcard CORS, no firewall, hand-started in a terminal.
6. `/convertSTR` is already down; DiffDock is already broken. Rebuild it on the box rather than
   migrating it.
7. **GROMACS's working config is on this box** — capture it before decommissioning.

## 7. Rules observed during this inventory

Read-only throughout: `ps`, `ss`, `ls`, `grep`, `nginx -T`, and Mongo `countDocuments` /
`findOne`. Nothing was started, stopped, edited, or deleted. nginx, TLS, DNS and the firewall
were not touched, and the unrelated `finsrv` stack on :4000 was not inspected beyond noting the
port. Temporary query scripts were removed after use.

**No credential from this host is recorded here or anywhere in this repo** — not the SSH
password, not the Atlas URI's user or password, not the contents of any `.env`. Field *names*
only. Keep it that way.
