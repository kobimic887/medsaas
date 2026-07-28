# What runs where, and why

**Decision record, 2026-07-28.** Supersedes the topology in every other document. Written after
production was inventoried for the first time ([PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md)),
which changed the answer.

---

## The shape

| | What runs there |
|---|---|
| **83.229.87.94** | nginx/TLS → **this repo's `server/index.js` serving `client/dist`** — one process, one origin |
| **The box** (new, Amsterdam) | AutoDock-GPU · DiffDock · convertSTR · Tanimoto + Postgres/RDKit · GROMACS · ADMET worker · glioblastoma |
| **Managed, unchanged** | MongoDB Atlas · NVIDIA NIM (MolMIM, OpenFold3) |
| **Retired** | `chem_beo` · `material-tailwind-dashboard-react` · the `:3000` server · Oracle · CloudAMQP |

---

## 1. The API does not go on the box

The box has **pick-up warranty** — on-site service does not exist in the Netherlands
([BOX-SPEC.md](./BOX-SPEC.md) §3). A hardware fault means the machine ships to Germany and is
gone for **1–3 weeks**. That is the dominant fact about it, and the architecture should be
chosen around it.

- **API on the box** → box dies → nobody logs in, sees past results, browses the catalog, or
  buys credits. The product is gone for three weeks.
- **API on 83** → box dies → docking stops. Everything else works, and you repoint
  `ligandServiceConfig` back at Asinex while the box is away.

The whole point of spending €24,727 was to stop having one machine in one place decide whether
the product works. Moving everything onto one uninsured chassis in Amsterdam rebuilds that,
with a worse repair time than Moscow.

**"The box is much faster" does not apply here.** The API is an Express app that proxies HTTP
and talks to Mongo. It is I/O-bound: it spends its life waiting on the network, not on a CPU.
A Threadripper makes it no faster. The things that *are* compute-bound — docking, MD, ADMET,
fingerprint search — all go on the box.

## 2. The API is this repo, not `chem_beo`

Not a style judgement. `chem_beo` has **7 of 73 routes behind `authenticateToken`**, on a server
bound `0.0.0.0` with no host firewall:

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
is the worst available outcome. And since it has to be replaced regardless, the only question is
what replaces it.

**This repo already is the replacement.** `server/index.js` has authentication on every
protected route, tenant isolation, credit enforcement that cannot be called from the browser,
audit logging, rate limiting, and `ligandServiceConfig`. It is written and CI is green on it.

## 3. One process on 83, not three

Today 83 runs a Vite **dev server** on `:5173` proxied by nginx, a Stripe server on `:3001`, and
a second HTTPS server on `:3000` that terminates TLS itself and bypasses nginx — all started by
hand in `screen` sessions with no restart policy.

This repo's server serves `client/dist` when `FRONTEND_DIST` is set. So 83 becomes:

```
:443 nginx ──► server/index.js  (+ client/dist, same origin)
```

That single change removes, at once: the `:3000` direct-TLS server, `app.use(cors())` wildcard
CORS, the dev server in production, the cross-origin 401 auto-logout problem, and all 66
unauthenticated routes. Under a systemd unit, it also removes "a reboot ends production."

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

## 6. Sequencing — how arrival day gets short

The instinct is to do everything on arrival day because that is "faster." It is the opposite:
it stacks every risky change onto the one day that also involves unfamiliar hardware, with no
working fallback beside it.

**Move the risk earlier instead.**

**Before the box ships** — all of this is doable now, with no deadline and `chem_beo` still
running:

1. Set `PLATFORM_NAME=Pyxis Discovery`. **No company is created and none is shown.** See §8.
2. Run `scripts/migrate-legacy-users.mjs` — dry run, then apply. 49 of 50 users need
   `companyId`, `role`, `active`, `createdAt`, and a numeric `simulationTokens`.
3. Build `client/dist` and stand this repo's server up on 83 **beside** `chem_beo`, on a spare
   port, pointing at Atlas and at Asinex exactly as today.
4. Exercise it: login, a dock, credits, Stripe, invite email, Tanimoto.
5. Cut nginx from `:5173` to it. Roll back by pointing nginx back — `chem_beo` never stopped.
6. systemd units. Delete the `screen` sessions.

**Arrival day** — what is left is small, and every step is one field with one rollback:

7. Base platform, drivers, CUDA, storage (runbook Phases 1).
8. Stand up the box's services. Verify each against its own acceptance test.
9. Repoint one service at a time through `ligandServiceConfig`: docking → verify → DiffDock →
   verify → Tanimoto → verify. Rollback is repointing.
10. Retire Oracle only after Tanimoto has served real queries from the box.

Arrival day becomes an afternoon of pointing URLs, because everything that could go wrong went
right three weeks earlier, on a day when nothing was at stake.

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
