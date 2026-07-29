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

## Do these now — no box required

### 1. Ship Release A

Full steps: **`ARRIVAL-RUNBOOK.md` Phase 5**. Gates, all runnable today:

- [ ] Run `scripts/migrate-legacy-users.mjs`. 49 of 50 production users have no `companyId`.
- [ ] **Rotate `JWT_SECRET`.** Not optional, and not a hygiene task —
      `buildTenantFilter` (`server/index.js:1064`) reads `companyId` from the **JWT payload,
      not the database**. Reusing `chem_beo`'s secret keeps legacy tokens valid, and those
      tokens have no `companyId`, so a migrated user still takes the legacy branch: their
      results go invisible, the cache misses, and they get charged twice.
- [ ] Verify response shapes route by route **while both servers are still running**. Once
      5173 changes hands this is no longer possible.
- [ ] Confirm the old dev server still starts: `npm run dev` in
      `/root/material-tailwind-dashboard-react`. **Never delete that directory** — it is the
      rollback, and a different codebase from this repo's `client/`.

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

This expires without warning. Each of these is a `curl` against production and belongs in
`deploy/box/docking/reference/`:

- [ ] **A DiffDock response.** The response schema is **completely uncaptured** — no DiffDock
      result was ever stored. The DiffDock service in `BRIEF-SERVICES.md` is being built blind
      until this exists. Highest value item on this list.
- [ ] **A failed dock.** The platform only writes on success, so Asinex's error shape is
      unknown.
- [ ] **An apo-structure dock.** Every stored dock has a co-crystal ligand, which is where the
      search box centre comes from. A receptor without one has no centre by that rule, and
      nobody knows what Asinex does.

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
