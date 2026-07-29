# What to do next

Written 2026-07-29. Delete this file once the box has arrived and Release B is done —
it is a handoff note, not a document.

Read this first, then [`ARRIVAL-RUNBOOK.md`](./ARRIVAL-RUNBOOK.md).

---

## The plan, in one table

Everything ships as **v2, announced on box arrival day**. One item *deploys* earlier than it
is *announced*, and that is the only deviation from "deploy everything on arrival day".

| # | Item | Deploy when | Needs the box? |
|---|---|---|---|
| **A** | **Server swap** — this repo's `server/index.js` + `client/dist` take over port 5173 | **Before the box.** Any day. | **No** |
| B1 | Docking to the box | Arrival day | Yes |
| B2 | convertSTR to the box | Arrival day | Yes |
| B3 | Tanimoto to the box | Arrival day | Yes |
| B4 | GROMACS, CUDA build | Arrival day | Yes |
| B5 | ADMET worker, first ever deploy | Arrival day | Yes |
| B6 | Glioblastoma, first ever deploy | Arrival day | Yes |
| — | Announce **v2** | Arrival day | — |

### Why A moves earlier, and it is only this one reason

A has **no dependency on the box**. It is this repo, Atlas, and Asinex — all of which exist
today. It could have shipped a month ago.

If A ships on the same day as B1, and docking then looks broken, there are two suspects
producing one symptom: the new server, or the new docking service. Rollback becomes two
rollbacks in an order nobody established in advance.

Concretely: the "**The docking run returned no readable poses**" message added in `c9ce8d5`
lives in **this repo's** `client/`. Production currently serves a different codebase
(`/root/material-tailwind-dashboard-react`). That message therefore does not exist in
production until A ships. It is the clearest early warning that a box cutover produced a
malformed SDF — so shipping A and B1 together removes the warning light on the one day it is
most needed.

Nobody outside sees when A landed. The v2 announcement is still arrival day.

---

## 0. Two live vulnerabilities, found 2026-07-29. Read before anything else.

**Production JWTs are signed with the literal string `secret`.** `chem_beo:1049` is
`jwt.sign({username}, process.env.JWT_SECRET || 'secret', {expiresIn: '1d'})`, and `chem_beo`'s
`.env` sets no `JWT_SECRET`, so the fallback is what is live. Verified by minting a token with
`'secret'` and using it against the production API — it authenticated. **Anyone can forge a valid
token for any of the 50 accounts**, on an API that is internet-facing on `:3000`.

This reframes the "rotate `JWT_SECRET`" gate below. It is not cutover hygiene; it is the fix. And
Release A fixes it as a by-product, because this repo's server refuses to start without a real
one ≥32 characters.

**`:3001` is an open mail relay.** `stripe-server.cjs`, in *no* document until now, running from
`/root/material-tailwind-dashboard-react` since 2026-07-02 and reachable from the public internet
on `83.229.87.94:3001`. It exposes unauthenticated `POST /api/send-email`, which takes an
arbitrary `recipientEmail` and sends through the production Titan Mail account. It also exposes
`POST /api/issueSimulationTokens` and Stripe session creation with a **client-supplied price**,
none of it authenticated.

⚠ **Do not kill the process.** The live Vite dev server proxies `/api` → `127.0.0.1:3001`
(`vite.config.js`), so it is the contact form's backend *and* part of the rollback path. Bind it
to localhost or firewall `:3001` instead. Release A retires it properly: every one of those routes
exists in this repo's server behind authentication and rate limiting, and
`/api/issueSimulationTokens` there requires a company admin.

---

## Do these now — no box required

### 1. Ship Release A

Full steps: **`ARRIVAL-RUNBOOK.md` Phase 5**. Gate status as of **2026-07-29**, measured on
production, not assumed:

| Gate | State |
|---|---|
| Response shapes verified route by route, both servers live | ✅ **done** — 17 routes, 4 explained differences, none blocking. See below |
| Rollback proven to start | ✅ **done** — a second Vite booted on `:5199` from `/root/material-tailwind-dashboard-react`, served 200, production untouched |
| Rehearsal on a spare port against real Atlas | ✅ **done** — `/root/pyxis-release-a`, port 5199, `bun index.js` + `client/dist` |
| `scripts/migrate-legacy-users.mjs` | ⏳ **dry run clean, not applied.** 49/50 users get `companyId`, 47 get `simulationTokens: 0`, 1 string balance coerced |
| `scripts/migrate-legacy-simulation-logs.mjs` | ⏳ **dry run clean, not applied.** 5 documents, 0 orphans. **New — see below** |
| Rotate `JWT_SECRET` | ⏳ **not done, and it is now a live vulnerability — see §0** |
| `chem_beo` patch applied | ⏳ not applied |

**Run the two migrations in one window, users first.** Between them is the only interval where
history is invisible and the cache double-charges, so do not stop halfway. **Run them with
`node`, not `bun`** — `mongodb`'s bson calls `node:v8 isBuildingSnapshot`, which Bun 1.3.12 does
not implement, and the script dies on import. They also need `mongodb` resolvable from the repo
root, which a bare checkout does not have; on the rig this was `ln -s server/node_modules
node_modules`.

**Why the second migration exists.** `migrate-legacy-users.mjs` opens a gap it does not close.
The moment every user has a `companyId`, `buildTenantFilter` stops taking its legacy branch and
filters on `{companyId}` — but every `simulation_logs` document was written by `chem_beo`, which
nests `user.username` and writes no `companyId`. Verified on Atlas: 5 documents, 5 nested, 0 with
either field. So dock history vanishes and `/api/simulation`'s cache lookup
(`server/index.js:3165`) misses, **charging a credit again for a dock already paid for**. The new
script backfills both fields additively and leaves `user` in place, so `chem_beo` can still read
the documents after a rollback.

**The four parity differences, all benign:**

1. A garbage token gets **403 from `chem_beo`, 401 from this server**. 401 is the correct one —
   the client treats a same-origin 401 as a dead session and logs out, which is what a malformed
   token should cause.
2. `/api/activity` omits `createdAt` on users. Nothing in this repo's client reads it.
3. `/api/tanimoto/v1/*` (legacy) vs `/tanimoto/v1/*` (this repo). Each frontend calls its own
   server's path, and the halves ship together, so they cannot disagree.
4. `/api/asinex/exact/CCO` returns **500 on both** — `"Unexpected end of JSON input"`, Asinex
   answering with an empty body. Pre-existing, identical before and after, not a cutover risk.

The `/api/simulation` cache hit returned the **stored** `simulationKey` on both servers: no dock
ran and no credit was spent.

⚠ **The rollback command in the runbook is wrong.** `npm run dev` in
`/root/material-tailwind-dashboard-react` runs `concurrently "node stripe-server.cjs" "vite"` —
and `stripe-server.cjs` is *already running* on `:3001` from a different shell, so that half dies
on `EADDRINUSE`. There are two half-dead `concurrently` stacks on the box right now for exactly
this reason. **The rollback is `npm run dev-vite-only`.** Never delete that directory — it is a
different codebase from this repo's `client/`, not an older version.

Cutover is which process owns **port 5173**. nginx already proxies there; nothing in nginx,
TLS, DNS, or Stripe is touched. Check what holds it first: `ss -ltnp | grep 5173`.

### 2. Apply the `chem_beo` patch

`deploy/chem_beo/01-fixes-and-config.patch`. Written, applies cleanly, and verified by
running it against real Atlas on an isolated port. Not yet applied.

It lifts the five Asinex URLs and eight Tanimoto call sites into env vars **defaulting to
today's values**, makes the credit charge atomic and refundable, and closes five money/data
routes — including the open `/api/generate-molecules` that is causing the NVIDIA rate limit,
and the credit-minting hole at `chem_beo:3343`.

It is also what makes arrival day possible if Release A has not shipped: those env vars are
the only way to repoint docking on the legacy server. See `deploy/chem_beo/README.md` for the
~60 routes it deliberately leaves open.

### 3. Capture from Asinex while Moscow still answers

- [x] ~~**A DiffDock response.**~~ ✅ **Done 2026-07-29, and no call to Moscow was needed.**
      This item said the schema was "completely uncaptured". It was wrong: `chem_beo` has been
      logging every request and response to `/root/chem_beo/diffdock_api.log` since February —
      7.9 MB, 24 pairs, 8 successful. `deploy/box/diffdock/reference/` is the extracted contract,
      with a README covering the three things a reimplementation must get right: failure arrives
      as **HTTP 200** with `status: "failed"`, arrays are **padded to `num_poses`** with empty
      strings so length is not a pose count, and `position_confidence` is **ranked best-first and
      index-aligned** with `ligand_positions`.
- [x] ~~**A failed dock.**~~ ✅ **Done** — both distinct failure strings are in the same
      directory, along with the HTML error page DiffDock sometimes returns instead of JSON.
      Also `/root/chem_beo/output.json`, `output4.json` and `/root/output2.json` are three
      stored failed responses.
- [ ] **An apo-structure dock.** Still open. Every stored dock has a co-crystal ligand, which is
      where the search box centre comes from. A receptor without one has no centre by that rule,
      and nobody knows what Asinex does.
- [ ] **A failed `/api/simulation` dock** (AutoDock, not DiffDock). Still open — the platform
      only writes `simulation_logs` on success, so that engine's error shape is still unknown.

The same log settled `/convertSTR` too: `{"smiles": "..."}` → `{"sdf": "..."}`, and its last
line is a request at **2026-06-04T12:15:34Z with no response** — the exact moment `:8001` died,
carrying a leading space in the SMILES. `deploy/box/convertstr/` now trims and has a test for it.

### 4. `pg_dump` Oracle's Tanimoto Postgres

2,951,975 molecules, **the only copy**, and an unauthenticated `DELETE` route reaches it.
Runbook 4.3. Do not wait for the box for this.

### 5. Rotate the glioblastoma key

`services/glioblastoma-predictor/chemtest_tech_private.key` is committed and `COPY`'d into the
image. It is in git history — treat as compromised. Blocks B6.

---

## In flight

Codex is building two things, in parallel, in disjoint directories:

| Brief | Building into | State on 2026-07-29 |
|---|---|---|
| `deploy/box/docking/BRIEF.md` | `deploy/box/docking/service/` | ~1,200 LOC, `Dockerfile` + `docker-compose.yml` + 2 test files. Untracked. Mid-build |
| `deploy/box/BRIEF-SERVICES.md` | `deploy/box/convertstr/`, `deploy/box/diffdock/`, `services/admet/` | `convertstr/` started. Untracked |

Its docking plan was reviewed. Two corrections were pushed in `f426de2` — **the plan predates
them, so check the implementation honours both**:

1. **SCORE sorts ascending** (`-4.547 → -4.345`, most negative first). Three docs said
   descending; Codex was right and the docs were wrong.
2. **Do not hard-fail on a pose count other than 5.** The platform de-duplicates on `<smiles>`
   and renders one row, so the pose count is invisible to the user. Rejecting a 4-pose dock
   returns 502 and refunds a credit for work that succeeded. Emit what the engine produced,
   `WARN` if not 5, fail only on **zero**.

Also unresolved from that review, neither blocking:

- The plan fetches only `files.rcsb.org/download/{ID}.pdb`. RCSB returns **404** for entries
  too large for PDB format — those exist only as mmCIF. Needs a message saying so, not a
  generic 404.
- The plan rejects `;` in SMILES with 422. Defensible, but the frontend does
  `replace(',', ';')` with **no `/g` flag**, so it only rewrites the first comma — multi-SMILES
  input arrives as `A;B,C`. Whatever it does, log and count it.

**Scope note.** The docking service's `fcntl.flock` cross-process locking, multiprocess
cold-cache race tests, and versioned cache invalidation are sized for concurrency that does
not exist — production has done **four docks in three months**. Correct, ~120 LOC, harmless;
just past the load. The **cache itself is worth every line** — a warm receptor skips the RCSB
fetch and the OpenMM prep, and that is the one latency change a user will actually feel.

---

## Do not

- Do not deploy Release A and the docking repoint on the same day. See above.
- Do not touch **nginx, TLS, DNS, the firewall, or Stripe** on arrival day. Stripe works; the
  runbook needs no Stripe access.
- Do not move the **database**. Production Mongo is **Atlas** and stays. Runbook 4.1 and 4.2
  are dead permanently.
- Do not restore **Oracle's Mongo**. Discarded, never restored from. This is *Mongo only* —
  Oracle's **Postgres is production Tanimoto data and IS copied** (4.3).
- Do not put an API server or Mongo on the box. It runs **compute only**. The box has pick-up
  warranty and no on-site service in the Netherlands, so a fault costs 1–3 weeks: box dies,
  docking stops, product survives.
- Do not add tenant-facing or billing features. See `PYXIS-ONLY.md`.
- Do not edit `scripts/verify-docking-response.mjs`. It encodes the platform's real parsers
  verbatim, brittleness included. Loosening it to make a candidate pass defeats its purpose.

---

## Prompt for a fresh session

> Read `docs/NEXT-SESSION.md` and `CLAUDE.md`, then `docs/ARRIVAL-RUNBOOK.md` Phase 5.
> The box has not arrived. I want to ship Release A — the server swap — before it does.
> Start with the gates in NEXT-SESSION.md §1 and tell me which are done and which are not.
> SSH to production is `root@83.229.87.94`; I will give you the password.
