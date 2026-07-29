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

## What is left. Start here.

Everything below this section is context. These are the open items, in order.

> **Changed 2026-07-29 — the de-SaaS work is done, and it moved a gate.** The owner chose to
> rebrand **before** the cutover, and steps 1–5 of `PYXIS-ONLY.md` §5 are applied: marketing
> site and sign-up page deleted, signup 403 by default, accounts invite-only, plan checkout
> admin-only, product renamed to Pyxis Discovery. Ten commits, `387cbcd`..`01dd134`.
>
> **The consequence, and it is the item people will forget:** the route-parity and rollback
> evidence measured earlier on 2026-07-29 was gathered against the **pre-rebrand** frontend.
> It no longer describes what would ship. **It has to be gathered again before the cutover**,
> and `scripts/verify-server-swap-parity.mjs:45` reads `/root/pyxis-release-a/.env` — that rig
> was deleted after the last run, so this means standing it back up, not re-running a script.
> Two of the new differences are intended and predicted: `/api/signup` now answers 403 where
> `chem_beo` answers 200/400, and `/create-checkout-session` is admin-only.
>
> Also settled: the box is reached by **public hostname over HTTPS, no VPN** (ARRIVAL-RUNBOOK
> Phase 3.1), and the earlier claim that `assertConfiguredUrlsArePublic` blocks the cutover is
> **retracted** — one call site, admin-UI only. The Tanimoto cartridge image is pinned to a
> verified Postgres 17 tag, and `scripts/verify-tanimoto-restore.sh` proves the restore in one
> command (needs Docker; run it on the box).

0. **Re-verify Release A against the rebranded frontend.** New, and now the gate on cutover.
   See the note above. Nothing below this line should happen before it.
1. **Rotate `JWT_SECRET` on `chem_beo`.** Still signing with the literal string `secret` — §0.
   One `.env` line plus `systemctl restart pyxis-api-legacy`. It logs every user out, which is
   why it was not done unannounced.
2. **Rotate the mail password.** `EMAIL_PASS` was readable at
   `https://app.pyxis-discovery.com/.env` for roughly twenty minutes on 2026-07-29 (§0b).
   Also rotate `STRIPE_SECRET_KEY` in `/root/pyxis-secrets/stripe-server.env` — that one was a
   **test** key and was exposed far longer, since before this session.
3. **Grant credits.** 47 of 50 users now hold `simulationTokens: 0`. They had no such field
   before, so nothing changed for them — but they cannot run anything, and the new server says
   "No simulation tokens left" rather than explaining why.
4. **Apply `deploy/chem_beo/01-fixes-and-config.patch`.** Unchanged from before.
5. **Then cut over** — `systemctl disable --now pyxis-vite-legacy && systemctl enable --now
   pyxis-web`, after copying this repo and a locally-built `client/dist` to `/root/pyxis`.
   `deploy/83/systemd/README.md` has the exact commands and the rollback.
6. Hand `chem_beo` to systemd too (`systemctl start pyxis-api-legacy`) — it is the last process
   still hand-started in a `screen`, so a reboot still stops the API. Left alone here because it
   means restarting the live API.

Not started, and not blocking: DiffDock (`deploy/box/diffdock/` has only the captured contract),
ADMET, glioblastoma, Claude Science OAuth, and the marketing-copy half of the ChemBench→Pyxis
rename.

### What is still missing for arrival day — audited 2026-07-29

Everything here is doable **without the box** and every one of them is on arrival day's critical
path if it is not done first.

1. **How 83 reaches the box is undecided.** `compose.yml` binds `${BIND_ADDR:-127.0.0.1}` and
   no ingress exists. **Every cutover URL in `deploy/box/.env.example` depends on this.**

   **DECIDED 2026-07-29: no VPN, no tunnel.** Earlier comments floated "WireGuard/Tailscale";
   that was a suggestion in a code comment, never a decision, and it is rejected — it adds a
   third-party account and a daemon on both machines to solve a problem TLS already solves.

   **The box is reached exactly the way Asinex is reached today: a public hostname over
   HTTPS.** Production already calls `https://services.asinex.com:8000/docking` across the
   public internet; the box replacing it the same way is a true 1:1, and rollback is putting
   the Asinex hostname back.

   Shape: every service binds `127.0.0.1`, one Caddy/nginx on `:443` with a Let's Encrypt cert
   for a box hostname, and a host firewall allowing **only 83's IP** to reach `:443`. One open
   port, one certificate, one allowlist entry. The "⚠ NONE of these may be exposed to the
   internet" warning in `compose.yml` is satisfied by the firewall, not by a tunnel.
2. ~~`assertConfiguredUrlsArePublic` makes Release A the harder path.~~ **WRONG — retracted
   2026-07-29.** The guard at `server/index.js:1413` is called from **one** place (line 1325),
   on `company.ligandServiceConfig` — the admin-UI path. The environment variables that
   actually carry the cutover (`TANIMOTO_API_BASE`, `SDF_CONVERTER_URL`,
   `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL`, `server/index.js:80-88`) are read straight
   from `process.env` and never validated. Env-var cutover works identically on both servers.
   With the public-hostname decision in item 1 the question is moot regardless: a public
   address passes the guard anyway, so even the admin-UI path stays open.
3. **The Tanimoto dump is PostgreSQL 17.5, archive format 1.16.** Read straight out of the
   header of `~/backups/tanimoto/tonomitosql-20260729.dump`: `17.5 (Debian 17.5-1)`. Its
   `CREATE EXTENSION rdkit` needs the cartridge too. `informaticsmatters/rdkit-cartridge-debian`
   has historically shipped **older** majors, and an older `pg_restore` refuses a 1.16 archive
   outright — `unsupported version (1.16) in file header`. A verified sha256 is not a verified
   restore. Either pin a PG 17 cartridge image or re-dump `--format=plain`. Runbook §4.3 says
   "prove it restores"; that has not happened.
4. **sm_120 is the item most likely to miss the day, and it is checkable today.** RTX 5090 is
   Blackwell — CUDA 12.8+. AutoDock-GPU is a compile flag, tractable. **OSS DiffDock is a
   dependency-graph problem**: check whether cu128 wheels exist for the torch / torch-geometric
   versions it pins. If they do not, there is no build, and that is worth knowing weeks out.
5. **ADMET needs a decision, not a flag.** `services/admet/` is `amqpadmet.py` — RabbitMQ.
   `compose.yml` asserts it polls a Mongo job collection (BOX-ARCHITECTURE §5). One of the two
   has to change. Keeping CloudAMQP for the first deploy is legitimate: nothing regresses either
   way, because the worker has never run at all.
6. **`compose.yml`'s `x-gpu` anchor reserves no `device_ids`** — just `driver: nvidia,
   capabilities: [gpu]`, with `NVIDIA_VISIBLE_DEVICES` set per service. That combination is
   version-dependent; docking and diffdock can both end up seeing both cards. Use
   `device_ids: ['0']` / `['1']` in the reservation. Note `admet` is pinned to device 1 next to
   diffdock.
7. **GROMACS is still `apt-get install gromacs` on `ubuntu:22.04`** — CPU-only. Moving that image
   to the box buys nothing; it needs a `-DGMX_GPU=CUDA` source build to be worth the move.
8. **`services/glioblastoma-predictor/chemtest_tech_private.key` is committed to git** and
   `COPY`'d into the image. It is in the history — rotate before that service runs anywhere. It
   sits behind the `glioblastoma-key-rotated` profile so it cannot start by accident.

**Two of the six B-items have no 1:1 to hold, and that is fine.** DiffDock is *already broken in
production* (`SDF_CONVERTER_URL` → `83:8001`, nothing listening), so the box's convertstr is a
fix, not parity. ADMET and glioblastoma have **never run** — first deploy, not migration.

**The rungs that make arrival day short already exist.** `DOCKING_ENGINE=replay` returns the
committed reference payload with no GPU, and `vina` is real chemistry on CPU — both work today on
any x86_64 host. So the day is: bring the service up on `replay`, verify 83 → box → client end to
end through the real UI, flip to `vina`, then to `autodock-gpu`. `AutoDockGpuEngine` raising
`DockingUnavailable` until qualification is deliberate, and `/health` fails while it is selected,
so a half-built engine cannot silently take traffic.

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

### 0b. `https://app.pyxis-discovery.com/.env` served the file publicly — ✅ closed 2026-07-29

`/root/material-tailwind-dashboard-react/vite.config.js` set `server.fs.deny: ['.git',
'.git/**']`. **`fs.deny` replaces Vite's defaults rather than extending them**, and the defaults
are what block `.env` — so overriding it with only the `.git` patterns handed the file to anyone
who asked for it, through the public HTTPS site.

It held `STRIPE_SECRET_KEY` (a **test** key, exposed since long before this session) and, for
about twenty minutes, `EMAIL_PASS` — added while fixing the contact form, before this was known.
**Rotate the mail password**, and the Stripe test key.

Fixed three ways: every non-`VITE_` value moved to `/root/pyxis-secrets/stripe-server.env`
(mode 600, outside the webroot) and loaded via the unit's `EnvironmentFile`; `fs.deny` restored
to `['.env', '.env.*', '*.{crt,pem,key}', 'custom.secret', '.git', '.git/**']`; and backups of
the old file moved to `/root/pyxis-backups/`. Verified: all `.env` paths now return **403**.

Note Vite had the old contents cached in memory — its own `server.watch.ignored` covers
`**/.env*`, so editing the file on disk changed nothing until the process restarted. That
restart is what put `:5173` under systemd.

**`:3001` was an open mail relay — ✅ fixed 2026-07-29.** `stripe-server.cjs`, in *no* document
until now, running from `/root/material-tailwind-dashboard-react` since 2026-07-02 and reachable
from the public internet. Its unauthenticated `POST /api/send-email` took an arbitrary
`recipientEmail` and sent through the company mailbox. The three patches in `deploy/83/` pin the
destination server-side, rate-limit both mail routes per client IP plus globally, and make
`/api/test-email` answer only to localhost.

⚠ **Do not kill the process.** The live Vite dev server proxies `/api` → `127.0.0.1:3001`
(`vite.config.js`), so it is the contact form's backend *and* part of the rollback path. It now
runs under `systemd` as `pyxis-stripe`. Release A retires it properly: every route it serves
exists in this repo's server behind authentication and rate limiting, and
`/api/issueSimulationTokens` there requires a company admin.

Two things still open on it, neither reachable from the app (the deployed frontend calls
`chem_beo` on `:3000` for both): unauthenticated `POST /api/issueSimulationTokens`, which returns
success without touching the database, and Stripe session creation with a **client-supplied
`price`**. Both die with the process at Release A.

**And it had never worked.** The transport was hardcoded to `smtp.titan.email`. This account is
not on Titan — `EMAIL_HOST` is `server028.yourhosting.nl:587`, and Titan answers
`535 5.7.8 authentication failed` on 465 and 587 alike. **Every contact-form submission since the
page shipped failed**, and the visitor saw a generic error. Fixed and verified by sending a real
message. `server/utils/emailService.js` had the same hardcoding and only worked because the real
host appeared once, by accident, in its fallback list — also fixed, along with the `debug/logger:
true` that was writing the `AUTH PLAIN` line (the mailbox credentials) into the log on every send.

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
| `scripts/migrate-legacy-users.mjs` | ✅ **applied.** 49 documents written; verify says 0 users without `companyId`, 0 with unusable tokens |
| `scripts/migrate-legacy-simulation-logs.mjs` | ✅ **applied.** 5 documents; `user.username` left in place on all 5, and `chem_beo` re-verified afterwards — history, activity and the cache hit all still work |
| Rotate `JWT_SECRET` | ⏳ **not done, and it is now a live vulnerability — see §0** |
| `chem_beo` patch applied | ⏳ not applied |

**Both migrations ran on 2026-07-29**, users first, in one window, after a logical snapshot of
`users`, `companies` and `simulation_logs` — kept on 83 at `/root/pyxis-migrate/backup-<stamp>/`
with a `restore.mjs` beside it that replaces documents by `_id` rather than emptying the
collection. **47 of the 50 users now hold `simulationTokens: 0`**, which is deliberate: the
migration does not invent credits. They had no such field before, and `chargeSimulationToken`
filters `{$gt: 0}`, so nothing changed for them — but grant credits before telling anyone the new
server is live.

If they ever need re-running: **`node`, not `bun`** — `mongodb`'s bson calls
`node:v8 isBuildingSnapshot`, unimplemented in Bun 1.3.12, and the script dies on import. They
also need `mongodb` resolvable, which a bare checkout does not have; on 83 that was
`ln -s /root/chem_beo/node_modules node_modules`.

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

### 4. `pg_dump` Oracle's Tanimoto Postgres — ✅ done 2026-07-29

2,951,975 molecules (and 2,951,975 fingerprints), confirmed by count. 14 GB on disk,
**1.21 GB** as `pg_dump -Fc -Z6`, with a `sha256` beside it.

| Copy | Where |
|---|---|
| on Oracle | `~ubuntu/tanimoto-backup/tonomitosql-20260729.dump` |
| off Oracle | `~/backups/tanimoto/` on the dev Mac |

Postgres 17 with the **`rdkit` 4.6.1** cartridge — the restore target needs that extension or
the schema will not load. This is a backup, not a migration: Tanimoto compute still moves to the
box (B3). The point is that until now the data existed in exactly one place, with an
unauthenticated `DELETE` route pointing at it, so there was nothing to migrate *from* if it went.

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
