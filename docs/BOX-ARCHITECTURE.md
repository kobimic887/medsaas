# What runs where, and why

> ## Post-promotion note
>
> If `oracleNew` (`84.13.81.51`) has already been promoted by DNS, read
> [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) before applying any execution
> sequence. This document preserves the architecture decision and historical pre-promotion
> release record; it does not authorize a second DNS change or an automatic port swap. In the
> post-promotion state, `84` is production (public Pyxis = `:5174` since 2026-08-23),
> **`83` is imminent shutdown (not long-lived standby)**, `oracleOld` remains the temporary
> Tanimoto source, and Amsterdam remains compute-only. ⚠ Topology lines that still describe
> `83` as the live app host or as failover are historical; rollback-to-`83` / mirror-to-`83`
> language needs owner confirmation after kill.
>
> > ## ⚠ §2–§3 sequencing is SUPERSEDED. Read this first.
>
> This document says the two releases "must not be one day" and that the server swap should
> ship weeks before delivery. **That happened** — Release A went live 2026-07-29 — **and was
> then deliberately rolled back** on 2026-07-31. The owner's decision, 2026-08-01, is that
> arrival day does the **port swap and the docking cutover together**, in that order, with the
> port swap gated on the box services passing validation first. **Superseded again 2026-08-23:**
> the product/soft flip already ran (nginx → `:5174`); box day is compute cutover only. Do not
> re-swap ports.
>
> **For execution order, [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) wins over this file.**
> What remains authoritative here is the *topology* — what runs where and why — which is
> unchanged and still supersedes every other document.

**Decision record, 2026-07-28. Revised 2026-07-29 — §2 and §3 were reversed.** Supersedes the
topology in every other document. Written after production was inventoried for the first time
([PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md)), which changed the answer.

---

## The shape

> **Topology qualifier:** the table below is the historical/pre-promotion topology record.
> The post-promotion host roles are defined in `POST-PROMOTION-HANDOFF.md`; that document
> takes precedence for operations after DNS has moved to `84`.
>
| | What runs there |
|---|---|
| **83.229.87.94** | nginx/TLS on `:443` → **one Node process on `:5173`** serving the API *and* the frontend |
| **The box** (new, Amsterdam) | AutoDock-GPU · DiffDock · convertSTR · Tanimoto + Postgres/RDKit · GROMACS · ADMET worker · glioblastoma |
| **Managed, unchanged** | MongoDB Atlas · NVIDIA NIM (MolMIM, OpenFold3) |
| **Retired** | Oracle · CloudAMQP · the `:3000` direct-TLS server |

**Two releases, and they must not be one.** Neither depends on the other:

| | What changes | Needs the box? |
|---|---|---|
| **Release A — the server swap** (§2, §3) | `chem_beo` + Vite dev server → this repo's `server/index.js` + `client/dist`, on port 5173 | **no** |
| **Release B — arrival day** (§6) | docking, DiffDock and Tanimoto repoint at the box. **One setting each** | yes |

**Do A first, weeks before delivery.** It needs only this repo, Atlas and Asinex — all of which
exist today. Then hardware day is three URL fields on a server already proven in production, and
a failure that day is unambiguously about the hardware.

**If A has not shipped by delivery, defer it and run B alone** against a patched `chem_beo`
([deploy/chem_beo/](../deploy/chem_beo/)), whose env vars do the same job. Both routes work.
What must not happen is both on one day.

---

## 1. The API does not go on the box

The box has **pick-up warranty** — on-site service does not exist in the Netherlands
([BOX-SPEC.md](./BOX-SPEC.md) §3). A hardware fault means the machine ships to Germany and is
gone for **1–3 weeks**. That is the dominant fact about it, and the architecture should be
chosen around it.

- **API on the box** → box dies → nobody logs in, sees past results, browses the catalog, or
  buys credits. The product is gone for three weeks.
- **API on the live app host** (now `84`; this record said `83`) → box dies → docking
  stops. Everything else works, and you repoint `ligandServiceConfig` back at Asinex while
  the box is away.

The whole point of spending €24,727 was to stop having one machine in one place decide whether
the product works. Moving everything onto one uninsured chassis in Amsterdam rebuilds that,
with a worse repair time than Moscow.

**"The box is much faster" does not apply here.** The API is an Express app that proxies HTTP
and talks to Mongo. It is I/O-bound: it spends its life waiting on the network, not on a CPU.
A Threadripper makes it no faster. The things that *are* compute-bound — docking, MD, ADMET,
fingerprint search — all go on the box.

## 2. The API is this repo — and the swap does not wait for the box

**Revised twice on 2026-07-29.** This section first said the swap happens on arrival day, then
said it happens weeks *after*. Both were wrong about the same thing: **the swap has no
dependency on the box at all.** It needs `server/index.js`, Atlas and Asinex. It should ship
**before** delivery, as an ordinary release on a day of your choosing.

The reason to separate it from hardware day is not that it is risky in itself — it is that a
first-ever production deployment and unfamiliar hardware on the same afternoon makes every
failure ambiguous between the two, and each has a clean rollback only while they are apart.

### Why it has to happen at all

`chem_beo` has **7 of 73 routes behind `authenticateToken`**, on a server bound `0.0.0.0` with
no host firewall:

| Open route | `index.js` | Consequence |
|---|---|---|
| `POST /api/generate-molecules` | `74` | **Anyone on the internet can spend your NVIDIA quota.** This is the cause of the rate-limiting that started this project — not a quota too small, an open endpoint |
| `DELETE /tanimoto/v1/datasets/:id` | `437` | One `curl` deletes the 2,951,975-molecule corpus |
| `POST /api/diffdock/generate` | `2475` | Free docking for the internet — and on the box, free **GPU** |
| `POST /tanimoto/v1/upload` | `222` | Unauthenticated write to the search corpus |
| `GET /api/test-user/:username` | `1062` | User enumeration |
| `mol-price`, `molecules`, 4 email senders | various | Pricing data public; open mail endpoints |

Plus `POST /api/issueSimulationTokens` (`3343`), which *is* authenticated and lets any logged-in
user `$set` their own credit balance from the request body.

**`chem_beo` therefore cannot go on the box** — unauthenticated GPU endpoints on a €25k machine
is the worst available outcome.

**This repo is the replacement.** `server/index.js` has authentication on every protected route,
tenant isolation, credit enforcement that cannot be called from the browser, audit logging,
rate limiting, `ligandServiceConfig`, the NVIDIA key pool with 429 rotation and a circuit
breaker, and `upstreamProxyStatus()`. It is written and CI is green on it. **None of that
reaches production until Release A ships.** ⛔ **Shipped 2026-08-23** via nginx →
`pyxis-web` `:5174` on `84`. The sentence above is the 2026-07-28 record.

### The patch is the fallback, and it is worth applying either way

[`deploy/chem_beo/01-fixes-and-config.patch`](../deploy/chem_beo/) — written, applies cleanly
against `index.js` as deployed, and **verified by running it** on 83 against the real Atlas
database: charge-then-refund proven end to end, `99999 → 99999` on a failed dock. It lifts every
service address into an env var **defaulting to today's value**, makes the credit charge atomic
and refundable, closes the five routes above that reach money or data, and makes signup produce
a usable account.

⛔ **SETTLED 2026-08-01: never apply this patch.** `chem_beo` is rollback-only (units
**stopped** on `84`, still enabled). The “apply it now” paragraph below is the 2026-07-28
record — do not re-raise.

Apply it **now**, regardless of when Release A ships. Three reasons:

1. Defaults reproduce current behaviour exactly, so it is a restart, not a change.
2. It fixes live bugs *today* — users are being charged for docks that never ran, and the open
   `/api/generate-molecules` is the actual cause of the NVIDIA rate-limiting.
3. It is the **rollback target** for Release A. You want the credit fixes on both sides of that
   swap, not just the new one.

It deliberately leaves the other ~60 routes open, because closing them risks breaking the
deployed frontend in ways only testing reveals. Release A closes them properly.

## 3. Release A — one process on 83, not three. And it needs no nginx change.

> Historical 2026-07-28 record. Live public is `84` + `pyxis-web` `:5174` (soft flip
> 2026-08-23). Do not treat the “today 83 runs Vite” paragraph as current topology.

In July 2026, leftover `83` (not DNS) ran a Vite **dev server** on `:5173` proxied by nginx, a Stripe server on `:3001`, and
a second HTTPS server on `:3000` that terminates TLS itself and bypasses nginx — all started by
hand in `screen` sessions with no restart policy.

**A finding that makes this much cheaper than it looked.** It was recorded as needing an nginx
change — turning `proxy_pass http://localhost:5173` into a static `root` — which the standing
no-nginx rule forbids without the owner, and which was on the critical path. **It does not.**
`server/index.js` reads `PORT` (`:5368`) and serves `client/dist` via `express.static`
(`:6699`), so it can simply *be* the thing on 5173:

```bash
PORT=5173 FRONTEND_DIST=…/client/dist node server/index.js
```

```
:443 nginx ──► :5173 server/index.js  (+ client/dist, same origin)
```

nginx is untouched and never learns anything changed. **The cutover is which process owns port
5173; the rollback is `npm run dev` in `/root/material-tailwind-dashboard-react`** — which is
therefore the thing to preserve, not a bundle. There is no bundle; nginx proxies a dev server.

That single change removes, at once: the `:3000` direct-TLS server, `app.use(cors())` wildcard
CORS, the dev server in production, the cross-origin 401 auto-logout problem, and all 66
unauthenticated routes. Under a systemd unit, it also removes "a reboot ends production" —
the longest-standing operational problem on that machine.

**Its real gate is response shapes, not paths.** The route delta is already known safe (§7):
this repo is a strict superset of every path the production frontend calls. But matching paths
do not guarantee matching payloads — `simulation_logs` alone is written in two different shapes
by the two servers ([DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) §1). Verify route by route.

**Its real prerequisite is `scripts/migrate-legacy-users.mjs`**, and one trap worth stating
twice: `buildTenantFilter` (`server/index.js:1064`) reads `companyId` **from the JWT payload,
not the database.** So `JWT_SECRET` must be rotated as part of this release — reusing
`chem_beo`'s keeps legacy tokens valid, and a legacy token has no `companyId`, which silently
takes the legacy branch even for a migrated user. See ARRIVAL-RUNBOOK §5.3.

## 4. Atlas stays

"Everything backend on the box" is ambiguous about a managed database. It stays, and that is a
recommendation, not an oversight:

- It is already off-Moscow and already backed up.
- Moving it onto the box puts the **only copy of the user and billing data** on the one machine
  with a three-week repair time and no offsite backup — the largest open risk in the plan.
- It removes the dump/restore and the write-freeze window from the cutover entirely.

**The box's IP must be added to the Atlas allowlist** before it can reach anything — a TLS
alert 80 from Atlas means exactly this.

## 5. CloudAMQP goes

RabbitMQ has exactly one consumer: ADMET. `chem_beo:4085` publishes a job when a docking result
has no ADMET data, and a worker is meant to compute it and write back. **That worker has never
been deployed**, so jobs are queued and never consumed — users have been seeing
`status: "queued"` forever, and nobody noticed, because a broker's queue depth is not something
anyone looks at.

Replace it with a job collection in Mongo:

- No new infrastructure, no external dependency, no third-party account.
- Survives restarts, and is **queryable** — "how many jobs are stuck" becomes a `find()`.
  That is the property whose absence hid this bug.
- The producer and the worker will run on the same box. A network broker between two local
  processes, for a workload that has produced **four docking results in three months**, is
  solving a problem that does not exist.

If throughput ever justifies a broker, adding one back is easy. Nothing here forecloses it.

**Not arrival day, and not Release A either.** It is its own small job, and it has never worked
for a single user, so nothing regresses by leaving CloudAMQP connected and ignored. **The thing
worth saying out loud: every ADMET result any user has ever waited for is still
`status: "queued"`, and neither release changes that by itself.** Fixing it means deploying the
worker at all — which is Phase 6, on the box, where the GPU is.

## 6. Sequencing — how arrival day gets short

The instinct is to do everything on arrival day because that is "faster." It is the opposite:
it stacks every risky change onto the one day that also involves unfamiliar hardware, with no
working fallback beside it.

**Move the risk earlier instead.**

**Before the box ships** — all of this is doable now, with no deadline. **None of it depends on
the box.**

1. **Apply the patch** ([`deploy/chem_beo/`](../deploy/chem_beo/)) as a real commit in
   `chem_beo`, deploy it, set **nothing**. Defaults reproduce today's behaviour, so this is a
   restart, not a change. Verified: a failed dock now refunds instead of charging.
2. Take the Tanimoto `pg_dump` from Oracle and prove it restores. It is production data, it is
   the only copy, and an unauthenticated `DELETE` currently reaches it.
3. **Run `scripts/migrate-legacy-users.mjs`** — dry run, read the plan, apply. It gates
   Release A, and independently it fixes 47 users who have never been able to run a single
   simulation. Set `PLATFORM_NAME=Pyxis Discovery` at the same time (§8).
4. **Verify response shapes route by route** against `chem_beo` while it is still live. This is
   the one gate on Release A that cannot be done later, because it needs both servers running.
5. **Release A** — rehearse on a spare port on 83, then take over 5173. Rotate `JWT_SECRET`
   (§3). Confirm the old dev server still starts *before* cutting over. Run it a week.

**Arrival day** — every step is one setting with one rollback:

6. Base platform, drivers, CUDA, storage (runbook Phase 1).
7. Stand up the box's services. Verify each against its own acceptance test.
8. Repoint one setting at a time, verifying between each: docking → verify → DiffDock → verify
   → Tanimoto → verify. Rollback is putting it back. **Keep the Asinex URLs valid — they are
   the disaster-recovery path**, and the box has a 1–3 week repair time.
9. Retire Oracle only after Tanimoto has served real queries from the box, for days.

Which knob step 8 turns depends on whether Release A shipped: `ligandServiceConfig` on the
company if it did, `chem_beo`'s env vars if it did not. Confirm which server is live before
planning the day — `ss -ltnp | grep 5173`.

Arrival day is an afternoon of pointing URLs. The database is never touched, the frontend is
never touched, nginx is never touched, and no user session breaks.

**If Release A has not shipped by then, it still does not happen that day.** Falling back costs
nothing; doing both at once costs the ability to tell which one broke.

## 7. What this leaves open

- ~~**Which company the legacy users join.**~~ **RESOLVED — see §8. No company is surfaced.**
- **What balance the 47 users with no credits get.** The script defaults to 0 and will not
  invent balances.
- ~~**The `chem_beo` → this-repo route delta.**~~ **RESOLVED 2026-07-28 — the delta is
  effectively zero.** Comparing both files with path parameters normalised: `chem_beo` exposes
  **73** routes, this repo **83**, and only **two** exist in `chem_beo` and not here:

  | Route | What it is | Called by the frontend? |
  |---|---|---|
  | `GET /test` (`chem_beo:549`) | debug stub, returns `{message: "Test route working"}` | no |
  | `POST /api/data` (`chem_beo:1057`) | debug stub, echoes the request body | no |

  So this repo's server is a **strict superset of everything the production frontend calls.**
  Step 5 is far safer than it looked.

  **Still untested: response *shapes*.** Matching paths do not guarantee matching payloads —
  `simulation_logs` alone is written in two different shapes by the two servers
  ([DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) §1). Step 4's manual exercise is what catches
  that, and it remains the real gate before step 5.
- **AutoDock and DiffDock builds.** Specced against [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md)
  §6, not written blind — they cannot be compiled for sm_120 without the cards.

---

## 8. There is no company in the product

Decided 2026-07-28: the current `app.pyxis-discovery.com` experience has no company concept and
that is the intended one. This is the same conclusion as [PYXIS-ONLY.md](./PYXIS-ONLY.md) —
keep the tenancy plumbing, retire the tenant-facing surface — reached from the UX side.

**`companyId` is invisible plumbing and is still required.** It is how `buildTenantFilter`
scopes queries. Users are never shown it, never asked for it, never pick one.

**`companyName` is the only company field a user can perceive** — `getBrandName()`
(`server/config/branding.js:13`) uses it for the sidebar label and the email *from* name, and
**falls back to `PLATFORM_NAME` when it is absent.**

So: leave `companyName` unset and set `PLATFORM_NAME=Pyxis Discovery`. Branding then lives in
one environment variable instead of a database row someone can rename by accident, and nothing
company-shaped appears anywhere. `scripts/migrate-legacy-users.mjs` skips `companyName` by
default for exactly this reason; `--set-company-name` opts back in.

Remaining UI work, which is `PYXIS-ONLY.md`'s job: hide the Company Admin route
(`client/src/routes.jsx:135`, already `adminOnly`) and any invite-to-company flow.

**Correction to an earlier claim in this file and in PRODUCTION-83-INVENTORY §5.** "49 users
see an empty account" was too strong. `buildTenantFilter` (`server/index.js:1065`) falls back to
`{'user.username': …}` when `companyId` is absent, and that matches the legacy `simulation_logs`
shape. The actual failure is worse in a quieter way: **this repo writes `username` at the top
level, not `user.username`,** so a user without `companyId` still sees their old docks but never
sees a new one — and the cache lookup misses too, so they are charged again for a dock they
already paid for. The credits failure (47 users, `{$gt: 0}` against a missing field) is
unconditional and unchanged.
