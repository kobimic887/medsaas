# What runs where, and why

**Decision record, 2026-07-28. Revised 2026-07-29 — §2 and §3 were reversed.** Supersedes the
topology in every other document. Written after production was inventoried for the first time
([PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md)), which changed the answer.

---

## The shape — arrival day

| | What runs there |
|---|---|
| **83.229.87.94** | nginx/TLS → **`chem_beo` on `:3000`, patched** ([deploy/chem_beo/](../deploy/chem_beo/)) → the existing frontend, untouched |
| **The box** (new, Amsterdam) | AutoDock-GPU · DiffDock · convertSTR · Tanimoto + Postgres/RDKit · GROMACS · ADMET worker · glioblastoma |
| **Managed, unchanged** | MongoDB Atlas · NVIDIA NIM (MolMIM, OpenFold3) |
| **Retired** | Oracle · CloudAMQP |
| **Later, separate release** | swapping `chem_beo` for this repo's `server/index.js` + `client/dist` — §3 |

**Arrival day changes no server and no bundle.** It changes environment variables on a process
that is already running. That is the whole reason the maintenance window is short.

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

## 2. On arrival day the API is `chem_beo`, patched — not this repo

**Revised 2026-07-29. This section previously said the opposite; that was wrong for arrival day.**

The goal is *1:1 with what `app.pyxis-discovery.com` does today, plus the bugs fixed and the
compute moved*. Swapping the server is not that — it is a second, larger change riding along
with the one that matters, on the one day that also involves unfamiliar hardware.

So arrival day patches the running server in place:
[`deploy/chem_beo/01-fixes-and-config.patch`](../deploy/chem_beo/), which is written, applied
cleanly against `index.js` as deployed, and **verified by running it** on 83 against the real
Atlas database — charge-then-refund proven end to end, `99999 → 99999` on a failed dock. It
does four things: lifts every service address into an environment variable **defaulting to
today's value**, makes the credit charge atomic and refundable, closes the five routes that
cost money or destroy data, and makes signup produce a usable account.

Because the defaults reproduce current behaviour exactly, applying the patch changes nothing.
Cutover is then setting one variable at a time, and rollback is unsetting it.

### Why the swap still has to happen — later

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

The patch closes the five that reach money or data — `/api/generate-molecules`,
`/api/diffdock/generate`, the two Tanimoto writes and the Tanimoto delete, plus
`issueSimulationTokens`. **It deliberately leaves the other ~60 open**, because closing them
risks breaking the deployed frontend in ways only testing reveals, and none of them spend money
or destroy anything. That is an accepted risk with a deadline attached, not a solved problem.

**This repo is the eventual replacement.** `server/index.js` has authentication on every
protected route, tenant isolation, credit enforcement that cannot be called from the browser,
audit logging, rate limiting, `ligandServiceConfig`, the NVIDIA key pool with 429 rotation and
a circuit breaker, and `upstreamProxyStatus()`. It is written and CI is green on it. **None of
that reaches production until §3 happens.**

## 3. One process on 83, not three — a later, separate release

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

**Why it is not arrival day.** It replaces both halves at once — a different server answering
`/api/*` and a different bundle calling it — and the two cannot move independently. That brings
a rehearsal, a bundle swap with a symlinked webroot, a rollback plan, and response-shape
verification for 73 routes. All of it is real work and none of it is made easier by being done
the same afternoon as first power-on. It is also **safer once the box exists**: the box can
serve `client/dist` itself via `FRONTEND_DIST`, so the whole new stack can be rehearsed
same-origin on hardware that is not yet carrying traffic.

The route delta is already known to be safe (§7): this repo is a strict superset of every path
the production frontend calls. What is not known is response *shapes*. That is the gate.

Sequence: patch `chem_beo` and move compute (arrival day) → run on it for a week → then this.

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

**Not arrival day.** The publisher lives in `chem_beo:4085`, so replacing the broker means
editing `chem_beo` — and it is a feature that has never worked for a single user. Leave
CloudAMQP connected and ignored through the cutover; do this with the §3 release. **The one
thing worth saying out loud now: every ADMET result a user has ever waited for is still
`status: "queued"`, and moving to the box does not change that by itself.**

## 6. Sequencing — how arrival day gets short

The instinct is to do everything on arrival day because that is "faster." It is the opposite:
it stacks every risky change onto the one day that also involves unfamiliar hardware, with no
working fallback beside it.

**Move the risk earlier instead.**

**Before the box ships** — all of this is doable now, with no deadline and `chem_beo` still
running. **None of it depends on the box, and none of it is a swap.**

1. **Apply the patch** ([`deploy/chem_beo/`](../deploy/chem_beo/)) as a real commit in
   `chem_beo`, deploy it, set **nothing**. Defaults reproduce today's behaviour, so this is a
   restart, not a change. Verified: a failed dock now refunds instead of charging.
2. Take the Tanimoto `pg_dump` from Oracle and prove it restores. It is production data, it is
   the only copy, and an unauthenticated `DELETE` currently reaches it.
3. Back up the current frontend bundle on 83. It predates this repo and there may be no other
   copy. It is the rollback for the *later* release, and it costs nothing to keep now.
4. Optional, and independent: `PLATFORM_NAME=Pyxis Discovery` (§8) and
   `scripts/migrate-legacy-users.mjs`. **Neither gates arrival day** — they gate the §3
   release. The migration does fix 47 users who cannot run a single simulation, which is
   worth doing on its own merits.

**Arrival day** — every step is one variable with one rollback:

5. Base platform, drivers, CUDA, storage (runbook Phase 1).
6. Stand up the box's services. Verify each against its own acceptance test.
7. Repoint one variable at a time, verifying between each: `DOCKING_API_URL` → verify →
   `DIFFDOCK_API_URL` → verify → `TANIMOTO_API_BASE` → verify. Rollback is unsetting it and
   restarting. **Keep the Asinex URLs valid — they are the disaster-recovery path.**
8. Retire Oracle only after Tanimoto has served real queries from the box, for days.

Arrival day is an afternoon of pointing URLs. The database is never touched, the frontend is
never touched, nginx is never touched, and no user session breaks.

**Then, weeks later and separately:** the §3 release — this repo's server and bundle, with its
own rehearsal and its own rollback.

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
