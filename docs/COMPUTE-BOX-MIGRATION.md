# Compute Box Migration — full trace and move plan

**Status:** planning. **Nothing has been changed or removed.** This document is the
inventory and the sequence; every code/compose/Dockerfile edit it implies is still to be
approved.

**Why this is happening: Asinex's servers are in Moscow, and they go down because of the
war.** Every docking job the platform runs today is answered from there. When it is down,
`app.pyxis-discovery.com` cannot dock, which is the product. The box moves the docking path
into a building we control, in the EU. Read [BOX-SPEC.md](./BOX-SPEC.md) §1 first — it is
the reason behind every hardware choice below.

**Target machine** (Coreto **RECT WS-3229C**, RECT-ID 1493, configured 2026-07-28,
**€24,727 net**): Threadripper **PRO 9975WX 32C** @ 4.00 GHz · 128 GB DDR5-5600 ECC Reg.
(4×32) · **2× GeForce RTX 5090 32 GB** · **2× 2 TB Samsung 9100 PRO in RAID 1** + 1× 4 TB
9100 PRO scratch · 24 TB Toshiba MG · 2200 W · WRX90 · 2×10 GbE · IPMI · Ubuntu Server
24.04 LTS, headless. **36 months pick-up warranty — no on-site service in the Netherlands.**
Physically at Science Park 408 Unit 1.05, 1098 XH Amsterdam.

Full reasoning for every line of that, and what was rejected: [BOX-SPEC.md](./BOX-SPEC.md).

**Goal, as revised 2026-07-28.** Self-reliance is *not* the objective — availability is.
Folding and molecule generation **stay on NVIDIA's hosted NIM** (`health.api.nvidia.com`)
because NVIDIA runs them on faster hardware than we can buy, and because they are not the
thing that keeps breaking. The box is being built for **AutoDock-GPU and DiffDock**, with
classic CPU Vina as a reference path. Anything else that gets faster here does so
incidentally and gets no budget spent on it. Sections below carry inline notes where they
still encode the older, broader assumption.

**One correction that matters and is easy to get backwards: DiffDock is Asinex's, not
NVIDIA's.** Only MolMIM (`server/index.js:268`) and OpenFold3 (`:319`) call
`health.api.nvidia.com`. DiffDock calls `services.asinex.com:58000` (`:88`) — Asinex running
NVIDIA's DiffDock **NIM container** on their own Moscow hardware. So **DiffDock dies with
Asinex** and must be rebuilt here from OSS DiffDock (`gcorso/DiffDock`, MIT); the NIM
container needs NVIDIA AI Enterprise, which was refused, and is not supported on GeForce.

---

## 1. This is not one move. It is three different jobs.

Reading the trace as a lift-and-shift is the main way to get this wrong. Only the first
pile is actually a migration.

### Pile 1 — running today, changes host (a real move)

> **Corrected 2026-07-28.** Oracle was a **side project, never production**. The production
> database is **83's Mongo** — the users are there. Oracle's copies are discarded, not
> migrated, and Oracle leaves the project (§7 Phase 5). Rows below say which is which.

| Thing | Runs today on | Port | Moves to box as |
|---|---|---|---|
| **The production API** | **83** — never inventoried, see §3 | — | replaced by the box's Express API |
| **MongoDB — the real one** | **83** | — | **moves, with a data restore.** Contents unknown; Phase 0 inventories it |
| Express API + baked-in frontend | Oracle `medsaas-app-1` | 3000 | **nothing — deleted.** Defunct non-prod copy |
| MongoDB 7 (`--auth`) | Oracle `medsaas-mongo-1` | internal 27017 | **nothing — data discarded.** Side project |
| ChemBench MCP server (`services/mcp-server`) | Oracle `medsaas-mcp-server-1` | 8080 | rebuilt on the box, needs public HTTPS |
| tonomitosql API (Tanimoto/RDKit search) | Oracle `tonomitosql-api-1` | 8000 | rebuilt on the box |
| Postgres + RDKit cartridge (`informaticsmatters/rdkit-cartridge-debian:Release_2024_09_3`) | Oracle `tonomitosql-db-1` | internal 5432 | rebuilt. **Probably a non-prod index** — rebuild from source rather than restoring, but dump it before decommissioning |
| SMILES→SDF converter (`/convertSTR`) | **the 83 box** `83.229.87.94:8001` | 8001 | rebuild on box (see §6) |
| `mol_price` data + its importer | Mongo collection; loaded by `npm --prefix server run import:mol-price -- <mol_price.xlsx>` | — | rides along in `mongodump`, but **the xlsx source is not in the repo** — find out where it lives before it is needed again |

### Pile 2 — code exists in this repo, no live deployment

Oracle runs exactly five containers. None of these is among them, and none is on 83 either.

| Thing | Source | Notes |
|---|---|---|
| RabbitMQ | `docker-compose.yml` service `rabbitmq` | required by the ADMET flow |
| ADMET worker | `services/admet/` (`admet_sender.py`) | `admet-ai`, consumes the queue, calls back `PUT /api/simulation/:key/admet` |
| GROMACS API | `services/gromacs-api/` | Ubuntu 22.04 + distro `gromacs`, **CPU-only build today** |
| Glioblastoma predictor | `services/glioblastoma-predictor/` | Flask + scikit-learn RandomForest, CPU-only by nature |

So the ADMET, GROMACS and glioblastoma features in the dashboard have no live backend. The
box is where they get a supported one.

**Correction 2026-07-28: "never deployed" was wrong.** ADMET and GROMACS *did* run somewhere
at some point — possibly on the owner's PC — but no record of that deployment survives: no
compose file, no host, no logs. **Go looking for it before rebuilding from scratch**
(Phase 0, step 11). A working configuration is worth more than a clean-room rebuild,
especially the GROMACS CUDA build.

### Pile 3 — does not exist anywhere yet (net-new build)

This is the part the €25k was actually justified on, and it is worth being blunt: **no
code in any traced repo performs an MSA, a fold, or a local dock.**

> **Scope changed 2026-07-28 — read [BOX-SPEC.md](./BOX-SPEC.md) before this table.**
> Folding and molecule generation **stay on NVIDIA's hosted NIM** and are no longer part of
> Pile 3. The box exists for **docking**, which is the capability that cannot be bought from
> anyone. Everything below marked *dropped* was removed by that decision.

| Capability | Today | On the box |
|---|---|---|
| Docking | `POST /api/diffdock/generate` → Asinex-hosted DiffDock URL | **local DiffDock + AutoDock-GPU + Vina — this is the build** |
| `server/diff_dock.sh` | posts to `http://localhost:8000/molecular-docking/diffdock/generate` — **a NIM that has never run** | becomes real, or gets deleted |
| Structure prediction | `POST /api/openfold3/predict` → thin proxy to `health.api.nvidia.com` | ~~OSS OpenFold3 / Boltz-2~~ **dropped — stays on NIM** |
| MSA generation | none — NVIDIA does it inside their hosted call | ~~MMseqs2 + ColabFold databases~~ **dropped — NVIDIA keeps doing it** |
| Molecule generation | `POST /api/generate-molecules` → proxy to NVIDIA MolMIM | ~~OSS replacement~~ **dropped — stays on MolMIM** |

The owner will not pay for NVIDIA AI Enterprise. Anything built locally is therefore the OSS
stack; the two features that stay hosted use the same public endpoints they use today.

---

## 2. Repos traced

| Repo | Role | Verdict |
|---|---|---|
| `kobigenis/medsaas` (this one) | current platform: Express API, Vite client, `services/*` | **the source of truth.** Superset of the legacy repos' endpoints |
| `kobimic887/tonomitosql` | the Tanimoto/RDKit search API — this is what `TANIMOTO_API_BASE` points at | **moves.** Cloned at `~/projects/tonomitosql`; deployed on Oracle from `~/sql/tonomitosql` |
| `eitangenis/chem_beo` | predecessor of `server/index.js` (`utils/asynexUtils.js`, `rabbitMQUtils.js`, its own `diff_dock.sh`) | **legacy.** Verified: contains no external compute endpoint that medsaas lacks |
| `eitangenis/material-tailwind-dashboard-react` | predecessor of `client/` plus assorted `server.js`/`stripe-server.cjs` variants | **legacy.** No unique compute endpoints |
| `eitangenis/eShop` (private, not cloned) | legacy ASINEX storefront — Oracle DB + chem cartridge behind `/api/Shop` | reference only. Already reverse-engineered into `docs/ASINEX-ESHOP-REVERSE-ENGINEERING.md` |

Verification used for the legacy repos: every `http(s)://` host in each repo was extracted
and diffed against this repo's set. The legacy hosts are `151.145.91.17:8000`,
`83.229.87.94:8001`, the three Asinex hosts, `health.api.nvidia.com`, `files.rcsb.org`,
PubChem, and `pyxis-discovery.com`. All are already present here.

---

## 3. The two machines, after the move

Frontend on 83 (unchanged, already there). Everything else consolidates onto one box.
**Oracle leaves the project entirely** — see §7 Phase 5.

```
                          browser
                             |
                  app.pyxis-discovery.com
                             |
  ┌──────────────────────────────────────────────────────────┐
  │ 83.229.87.94 — shared VPS, nginx + TLS                   │
  │   static frontend (client/dist)  ← stays here            │
  │   also: an unrelated project on :4000                    │
  │   MongoDB ← PRODUCTION TODAY, MOVES to the box           │
  │   /convertSTR :8001  ← MOVES to the box, then stops      │
  └──────────────────────────────────────────────────────────┘
                             |  HTTPS, cross-origin, bearer token
                             v
  ┌──────────────────────────────────────────────────────────┐
  │ AMSTERDAM BOX — everything else          [DOES NOT EXIST │
  │                                           YET, see below]│
  │   Express API :3000 · Mongo · MCP :8080                  │
  │   tonomitosql :8000 + Postgres/RDKit                     │
  │   RabbitMQ · ADMET worker · GROMACS · glioblastoma        │
  │   AutoDock-GPU · DiffDock · Vina  ← THE POINT OF THE BOX │
  │   SDF converter                                          │
  │   local molecule generator (NVIDIA 429 failover, §7b)    │
  │   (folding stays on NVIDIA NIM, not here)                │
  └──────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────┐
  │ ORACLE VPS 151.145.91.17 — LEAVES THIS PROJECT           │
  │   was a side project, never production                   │
  │   loses: medsaas app, Mongo, MCP, tonomitosql, deploy.yml│
  │   its data is DISCARDED, not migrated                    │
  │   keeps (owner's own, unrelated): CLIProxyAPI, Crafty,   │
  │   the Codex token. NOT a backup target.                  │
  └──────────────────────────────────────────────────────────┘
```

**One chassis holds everything now.** With Oracle out and 83 down to a static frontend, every
service and every database in this project lives on the box — pick-up warranty, no offsite
backup. The mirror and the second GPU cover component failure; nothing covers the chassis.

**The box does not exist yet.** As of 2026-07-28 it is **configured and priced but not
ordered** — Coreto still has to confirm they will build and warranty two triple-slot RTX
5090s (BOX-SPEC §4). Its hostname, IP, MAC, network position at Science Park, and disk
device names are all unknown, so every plan below is written against roles (`/srv/scratch`,
"the box") rather than addresses. Nothing that needs a real address can start until it
lands. What *is* known is the hardware, at the top of this document.

### Settled — the frontend stays on 83, and it is already there

Confirmed by the owner: **`83.229.87.94` serves the production frontend today at
`app.pyxis-discovery.com`, and it keeps doing that.** The box gets the backend only.

The apparent contradiction in the code resolves cleanly once you notice which environment is
which:

- The root `Dockerfile` builds `client/dist` and copies it into the API image, and
  `server/index.js` serves it when `FRONTEND_DIST` is set. That image runs on **Oracle**.
- But `deploy.yml` is literally named *"Build & Deploy (**non-prod**)"* and targets
  `environment: non-prod`. So the Oracle stack is a **self-contained non-prod copy** that
  happens to serve its own bundled frontend — it is not what users hit.
- Production frontend = 83. That is also where the legacy `chem_beo`-era references to
  `https://app.pyxis-discovery.com:3000` point, which is the remaining unknown below.

**Unknown to confirm on the 83 box (Phase 0):** what is currently answering the production
API for `app.pyxis-discovery.com` — a legacy `chem_beo` deployment, an nginx proxy to Oracle,
or something else. This matters because that is the thing being replaced, and nobody should
find out mid-cutover. It is an inventory task on 83, not a code question.

Consequences of the split that still have to be built, because non-prod on Oracle never
needed them (same-origin there):

- **CORS on the API.** The dashboard on 83 will call an API on a different origin. Allowlist
  the frontend origin explicitly; do not use `*`, because the API takes a bearer token.
- **`FRONTEND_URL` / `BASE_URL` / `PLATFORM_WEBSITE_URL`** all repointed. These are not
  cosmetic — they appear in invite emails, password-reset links, and Stripe success/cancel
  redirect URLs. A wrong `BASE_URL` produces a checkout that returns the user to the wrong
  host after paying.
- **`VITE_API_BASE_URL` becomes required** for the 83 build. It is empty in dev because Vite
  proxies `/api`, `/tanimoto`, `/create-checkout-session*` and `/health` to port 3000, and it
  is empty on Oracle because the API serves the bundle. Neither applies on 83 — the built
  frontend must be told where the API is at **build** time.
- **The `frontend` stage of the root `Dockerfile`** either drops out of the box image or stays
  and is simply not served. Leaving it in costs a build stage but keeps the non-prod
  single-container mode working, which is worth something.
- **The 401 auto-logout invariant.** The client logs the user out on any 401 from the API.
  That path becomes cross-origin; a CORS preflight failure or a proxy 401 must not be allowed
  to read as "dead session". Reserve 401 for dead-session only — authz is 403, validation 400,
  upstream 401 becomes 502.
- **Deploying `client/dist` to 83** is a new pipeline. The rule on that box is *"The VPS is
  shared. Do not modify nginx, TLS, DNS, firewall, or other apps."* Publishing static files
  into an existing document root does not violate that; adding a proxy pass for the API would.

### Open decision B — public HTTPS ingress for the box (blocking)

Two things need to reach the box from the public internet:

1. **Stripe webhooks.** Credits are granted *only* by `checkout.session.completed`. Per
   the current state there is no webhook registered at all, so real purchases grant no
   credits — this move is the moment that gets fixed, and it needs a stable public HTTPS
   URL.
2. **The MCP server**, which exists so Claude for Life Sciences can reach the platform.

The box sits behind a router at Science Park with no TLS and no DNS. The obvious answer —
terminate TLS on 83 and reverse-proxy to the box — **conflicts with the written rule on
that box** quoted above. Options, none picked:

| Option | Pro | Con |
|---|---|---|
| nginx on 83 proxies to the box | TLS already there | violates the "don't touch nginx" rule on a shared VPS; adds a hop and a second point of failure |
| Cloudflare Tunnel from the box | no inbound port forwarding at all, free TLS, survives IP changes | dependency on Cloudflare; another account to hold |
| Caddy on the box + port forward 80/443 + DNS A record | fully self-reliant, matches the owner's goal | needs a static-enough IP, router config, and the box becomes internet-facing |
| Keep the API on Oracle as the public front; box is compute-only behind a private link | smallest change, Oracle already public | contradicts "all backend on the box"; adds latency; Oracle has 2 vCPU |

**Recommendation:** Caddy on the box with a real DNS name, because it matches the
self-reliance goal, with Cloudflare Tunnel as the fallback if the router or IP cannot be
pinned. Do not plan on modifying nginx on 83.

---

## 4. Self-reliance: what can genuinely be brought in-house, and what cannot

The owner asked for this to be fully self-reliant, "mongo and asinex too". Honest split:

### Fully in-house (yes)

- **MongoDB** — already ours, just moves. Runs as a compose service with a volume.
- **Postgres + RDKit cartridge / Tanimoto search** — already ours, just moves. Also gets
  *better* on this box: see the arm64 note in §6.
- **SMILES→SDF conversion** — trivial RDKit call; the only reason it lives on a foreign
  VPS is history. Reimplement as a route in the tonomitosql service or a tiny sidecar.
- **Docking compute** (AutoDock-GPU, Vina, DiffDock) — that is the point of the box.
- **MD, ADMET, glioblastoma** — come along and get much faster, but as a bonus. Not worth
  spending on. Folding and molecule generation deliberately do **not** move (BOX-SPEC §1).

### The Asinex question — mostly yes, with one honest exception

There are **four** distinct Asinex dependencies, and they are not equivalent:

| Dependency | Env var | Can it be self-hosted? |
|---|---|---|
| Catalog browse/search | `ASINEX_API_BASE` | **Yes.** Mirror the catalog into the local Postgres+RDKit cartridge. Exact/substructure/similarity are already implemented in tonomitosql. |
| Stock/eShop `/api/Shop` | `ASINEX_STOCK_API_URL` | **Partly.** The *pricing* table is already reverse-engineered (`docs/ASINEX-ESHOP-REVERSE-ENGINEERING.md` §1) and a local mirror already exists in the Mongo `mol_price` collection. **Live milligram stock levels are Asinex's own inventory and cannot be computed here** — a mirror is a snapshot that goes stale. |
| Docking `/docking` | `ASINEX_DOCKING_API_URL` | **Yes.** Replace with local AutoDock-GPU / Vina. |
| DiffDock | `DIFFDOCK_API_URL` | **Yes.** Replace with local DiffDock. VRAM is not the constraint — see BOX-SPEC §2. |

So: **three of the four Asinex dependencies disappear.** The fourth (real-time stock)
stays a vendor call by nature — you can mirror the catalog and the price table, but you
cannot host someone else's warehouse count. Plan the UI to show mirrored catalog + local
price, and treat the live stock check as an optional at-order-time confirmation.

Note the trap already in the code: `ASINEX_*` and `DIFFDOCK_API_URL` are **per-company
overridable**, stored on the company record as `ligandServiceConfig`. See §6.

### Cannot be self-hosted, and does not move

- **NVIDIA hosted endpoints** (`health.api.nvidia.com` MolMIM + OpenFold3) — **decided
  2026-07-28: they stay, permanently for now.** Not "until the OSS stack works". NVIDIA runs
  these on datacenter GPUs we will not beat per job. BOX-SPEC §1.
- **`files.rcsb.org`** (PDB and ideal-ligand SDF fetches, used by the DiffDock route and
  `diff_dock.sh`) and **PubChem / NCI CACTUS** (client-side name→structure lookups). These
  are public reference data. A local PDB mirror is possible later; not worth it now.
- **Stripe**, **Titan Mail** — external by definition.

---

## 5. CUDA: what actually gets a GPU, and what a GPU cannot help

Everything that can use CUDA should — but three of the heaviest pieces are not GPU work at
all, and pretending otherwise is how the box ends up idle.

> **Scope changed 2026-07-28 — see [BOX-SPEC.md](./BOX-SPEC.md).** Folding and molecule
> generation stay on hosted NIM, so the OpenFold3/MSA rows below no longer describe the
> plan. They are kept because the *reasoning* still stands and is what the decision rests on,
> and because BOX-SPEC recommends 32 GB cards precisely to keep that decision reversible.

Blackwell is **sm_120**. That means CUDA **≥ 12.8** and PyTorch **cu128** wheels
everywhere. flash-attn must be built with `TORCH_CUDA_ARCH_LIST="12.0"`, or use
flash-attn 4.

| Workload | GPU? | What to do |
|---|---|---|
| DiffDock | **Yes** | cu128 torch. Bandwidth-sensitive (e3nn tensor products), not purely core-count-sensitive — see BOX-SPEC §2 |
| AutoDock-GPU | **Yes** | build for sm_120. **The throughput workhorse, and the reason the box is being bought** |
| ~~OpenFold3 / Boltz-2 inference~~ | n/a | **Stays on NIM.** Would have needed cu128 torch, one model per card, ~32 GB floor, MIG off |
| GROMACS | **Yes** | current image is the Ubuntu distro package = **CPU only**. Rebuild from source with `-DGMX_GPU=CUDA`; do not ship the apt build |
| ADMET-AI (chemprop) | Yes, marginal | models are tiny, GPU barely helps — but install the **cu128 torch wheel BEFORE `admet-ai`**, see §6 |
| ~~MSA generation (MMseqs2 / jackhmmer)~~ | n/a | **Not built.** Was the bottleneck — pure CPU + memory bandwidth, ~⅔ of job wall clock. NVIDIA keeps doing it inside the hosted call |
| AutoDock Vina (classic) | No | CPU, embarrassingly parallel across 32 cores. **A first-class workload, not an afterthought** — this is why core count still matters |
| Tanimoto / RDKit cartridge search | No | CPU + RAM-resident index; no CUDA path exists |
| Glioblastoma predictor | No | scikit-learn RandomForest. CPU |
| Express API, Mongo, Postgres, RabbitMQ | No | — |

Two consequences that **no longer apply**, kept because they are the argument that removed
folding from the build:

- **Job shape.** ~800-token protein+ligand jobs on four memory channels: MSA ≈ 5.5 min,
  templates ≈ 1 min, inference 2–5 min, I/O ≈ 1 min → **≈ 8.5 min/job**, ~18–20 jobs/hour
  with two cards. Eight channels would have been ~7.2 min; that option was not bought — and
  since MSA is not being built, the eight-channel case is now moot. See BOX-SPEC §3.
- **Scheduling.** MSA being CPU-bound and inference GPU-bound meant the two had to be
  pipelined through RabbitMQ rather than serialised, or both cards would idle two thirds of
  the time. That whole piece of work is removed with the MSA.

### Will local folding actually be faster than NVIDIA's hosted NIM? — **answered: no, so it stays hosted**

Worth answering directly, because it is the one place where moving in-house may **cost**
speed rather than gain it, and the answer changes depending on how the machine is used.

**Per single cold job: probably slower.** Two reasons.

1. **The card.** An RTX 5090 has 32 GB of GDDR7 at roughly 1.79 TB/s. NVIDIA
   almost certainly serves the OpenFold3 NIM on datacenter parts — H100 at ~3.35 TB/s HBM3,
   H200 at ~4.8 TB/s. Transformer inference tracks memory bandwidth closely, so expect our
   inference stage to be somewhere in the region of 2–3× slower than theirs. *Caveat: what
   NVIDIA actually runs behind that endpoint is not published. This is an inference from
   hardware class, not a measurement.* The 32 GB also sits right on OpenFold3's ~32 GB
   working-set floor, where the old 48 GB card had margin — one more reason this stays
   hosted rather than becoming a project.
2. **The MSA, which is the bigger factor.** When you call the hosted endpoint, NVIDIA does
   the MSA too — on their infrastructure, with the databases already resident. Locally that
   becomes ours: ~5.5 min on four DDR5 channels, roughly ⅔ of the job. That is not a GPU
   problem and a better GPU does not touch it.

**So the honest headline: your instinct is right.** For the two features that were on hosted
NIM — folding and molecule generation — the gain is *not* raw per-job speed.

**But "only unlimited rate limits" undersells it substantially.** What is actually gained:

- **Throughput instead of latency.** Their endpoint is rate-limited and metered per call.
  Ours is limited only by hardware: ~18–20 jobs/hour sustained, 24/7, at zero marginal cost.
  For screening — which is the actual workload — total jobs completed per day matters far
  more than the wall clock of any one job.
- **No data leaves the building.** Every sequence and structure currently goes to a
  third-party API. On-prem is a real requirement for pharma work, not a nice-to-have.
- **No vendor dependency.** No quota, no price change, no deprecation, no NVIDIA AI
  Enterprise licence question — which is what pushed this to the OSS stack in the first place.
- **Control.** Pinned model versions, custom weights, template and recycling parameters the
  NIM does not expose, and Boltz-2 alongside OpenFold3 (Boltz-2 is lighter and also predicts
  binding affinity, which OpenFold3 does not).

**And the thing that inverts the comparison: cache the MSA.**

The workload is protein + ligand. In practice that means **one target protein screened
against many ligands.** The MSA depends only on the protein sequence — not on the ligand. So:

| | first job on a target | every subsequent ligand |
|---|---|---|
| MSA | ~5.5 min | **0 — cache hit** |
| templates | ~1 min | ~1 min |
| inference | 2–5 min | 2–5 min |
| I/O | ~1 min | ~1 min |
| **total** | **~8.5 min** | **~4–7 min, GPU-bound** |

Key the cache on a hash of the sequence. The hosted NIM cannot do this for you — it recomputes
(and re-charges) per call, because it is stateless and does not know your screen is 300 ligands
against the same protein.

**Caveat on that table, and it matters because this is the number that will get quoted.** The
"0 — cache hit" line is the *expected* behaviour of an MSA keyed on sequence alone, not a
measurement. Two things could erode it: template search may not be fully ligand-independent
depending on which model is used, and a co-folding path may redo work the cache cannot cover.
Treat the second column as the case to *verify* in Phase 4.1, alongside the cold-job baseline —
same rule as every other timing in this document.

Once MSAs are cached, a screening run is inference-only, both cards saturated, no rate limit —
and local wins outright.

**Decision taken 2026-07-28: not now.** The cache argument is the strongest case for local
folding, but it rests on an untested assumption, and building it means building the entire MSA
pipeline and downloading ~900 GB of reference databases first. Weighed against a hosted
endpoint that already works, folding stays on NIM. BOX-SPEC §2 recommends 32 GB cards so this
can be revisited without buying hardware again.

### Everything that was *not* on NIM gets dramatically faster

Only the two hosted-NIM features are ambiguous. Everything else is a straight upgrade, and the
comparison is not close, because the thing being replaced is a **2 vCPU / 12 GB free-tier
Ampere instance** (and for GROMACS, a CPU-only build):

| Workload | Before | After | Rough expectation |
|---|---|---|---|
| GROMACS MD | apt build, **CPU-only**, never deployed | source build, `-DGMX_GPU=CUDA`, 2 cards | order-of-magnitude class change |
| Tanimoto / RDKit search | 2 vCPU, 12 GB, aarch64 | 32 cores, 128 GB, x86_64 + native `rdkit-pypi` | very large |
| ADMET | never deployed; CPU torch | 32 cores + cu128 torch | very large (mostly from the CPU) |
| Glioblastoma predictor | never deployed | 32 cores | large |
| AutoDock-GPU / Vina | did not exist locally | 2 cards + 32 cores | new capability |
| Express API / Mongo / Postgres | 2 vCPU shared with everything | 32 cores, NVMe | large |

### RAM reality check

The 128 GB was argued for concurrent MSA slots plus keeping the Tanimoto fingerprint index
hot in cache. If the *entire* backend also lands here — Mongo, Postgres+RDKit, RabbitMQ, an
`ADMETModel` resident per worker, plus the OS page cache that MMseqs2 leans on — then less
is available for MSA than the purchase case assumed. Not a blocker. Budget it explicitly:
cap Postgres `shared_buffers`, cap the Mongo WiredTiger cache, and run one ADMET worker,
not four.

---

## 6. Storage: what goes on which medium

**Rewritten 2026-07-28 for the ordered machine.** Four devices in three tiers, with three
different failure semantics. Assign by *what losing it costs*, not by size.

| Mount | Device | Contents | Why here |
|---|---|---|---|
| `/` | **2× 2 TB Samsung 9100 PRO, RAID 1 (mdadm)** | Ubuntu 24.04, `/var/lib/docker`, Mongo `dbPath`, Postgres `pgdata` (RDKit cartridge + fingerprint GiST indexes), model weights (DiffDock/ADMET ≈ 10–30 GB), CUDA toolchain, `.env` | Everything whose loss is an **outage**. Mirrored because on-site service is not available in NL — see below |
| `/srv/scratch` | **4 TB Samsung 9100 PRO**, unmirrored | per-job working dirs, PDBQT conversions, `autogrid` output, DiffDock poses, GROMACS running trajectories | Highest-churn writes on the machine, and **deliberately off the mirror**. Wipe on a timer |
| `/srv/cache` | **4 TB Samsung 9100 PRO** (same device) | `autogrid` grid-map cache, keyed by PDB ID — ~60 MB per receptor | Rebuildable, so it does not need the mirror; random-read and latency-sensitive, so it does need NVMe |
| `/srv/archive` | **24 TB Toshiba MG** (HDD) | finished job outputs, completed GROMACS trajectories, Asinex catalog dumps, nightly `mongodump` + `pg_dump`, offsite-backup staging | Sequential, write-once-read-rarely. Exactly what an HDD is for |

One of four M.2 slots is left free on purpose — M.2 is user-serviceable, so capacity can be
added later without a warranty conversation.

Notes and cautions:

- **Scratch is not on the mirror, and that is deliberate.** RAID 1 doubles every write.
  Docking is write-churn for data that gets thrown away; putting it on the mirror would burn
  both drives' 1200 TBW endurance at twice the rate for no benefit. Do not "tidy this up"
  by consolidating onto the array.
- **RAID 1 is not a backup and must not be read as one.** It survives a dead disk. It does
  not survive a bad drop, a bad restore, a fire, or a theft. `mongodump`/`pg_dump` to
  `/srv/archive` protects against *logical* mistakes only — and `/srv/archive` is in the
  same chassis, on the same power supply, in the same room.
- **An offsite copy is still needed and still unsolved.** Oracle cannot be it; that box has
  ~24 GB free. This is open decision 4 in §9.
- The service level on the box is **36 months pick-up, and on-site was not available for the
  Netherlands**. A hardware fault means the machine ships to Germany and is out of production
  for 1–3 weeks. That is why there are two GPUs and a mirrored boot pair, and it is why
  **restore-elsewhere must be possible from the offsite copy alone.**
- **Keep a spare 2 TB NVMe on a shelf** (~€200 retail, not from Coreto). With pick-up
  warranty, a drive failure is otherwise weeks of downtime for a part you could swap in an
  afternoon.
- **Historical:** `/srv/refdb` is gone. It held ColabFold/MMseqs2 databases (~900 GB) for an
  MSA pipeline that is no longer being built — folding stays on NIM. Any reference to
  `refdb`, UniRef30, envDB or PDB100 elsewhere in this document is dead.

---

## 7. Migration sequence

Ordered so that nothing is switched off before its replacement is proven. **Nothing here
is destructive; the Oracle stack keeps running throughout.**

### Phase 0 — before the box arrives (can start now)

Nothing here needs the hardware. Items 1 and 2 are the two that are *only* doable now, while
Asinex is still answering.

1. **Capture the docking output contract — do this first, while Asinex is up.** The engine
   is known (AutoDock, confirmed by the Asinex/Pyxis CEO) but the **field names are not**.
   Pull several stored results and record the exact shape:
   ```
   db.simulation_logs.find({}, {result: 1, pdbid: 1, smiles: 1}).limit(20)
   ```
   Three consumers depend on that shape and will break silently if the local engine emits
   something different: `client/src/pages/dashboard/simulation.jsx`,
   `GET /api/sanitizedpdb/:simulationKey`, and `GET /api/sanitizedminimalsdf/:simulationKey`.
   Do the same for DiffDock — `position_confidence`, `ligand_positions`, `protein` and
   `ligand` are all read by name in `simulation.jsx`. **If Asinex goes down before this is
   captured, the contract has to be reverse-engineered from the client.**
2. **Inventory the persisted per-company overrides** —
   `db.companies.find({}, {companyId:1, name:1, ligandServiceConfig:1})`. These are the
   cutover switch (see Phase 4) and any non-default URL there is a stale pointer that
   survives the move.
3. **Inventory 83's Mongo — this is the production database and nobody has looked at it.**
   Collections and document counts, whether auth is on, how it is reached, and whether the
   schema matches what `server/index.js` expects today (`users`, `companies`, `audit_logs`,
   `billing_events`, `simulation_logs`, `projects`, `mol_price`). Then `mongodump` it.
   **Do not dump Oracle's Mongo** — that is a side project and its data is discarded.
4. Decide **B** (public HTTPS ingress). Blocks Stripe webhooks and the MCP server.
5. Check whether Oracle's Tanimoto index is worth restoring at all. It is a side-project
   database, so it is probably a non-prod index — in which case **rebuild it on the box from
   the source data** rather than restoring a `pg_dump`. Take the dump anyway before
   decommissioning; it costs nothing and it is the only copy.
6. Write down every value in the box's future `.env`. It is not in git and never will be.
7. **Add 429 handling and key pooling to the two NVIDIA routes** (§10). Independent of the
   hardware, shippable whenever — and right now a burst of use takes folding and molecule
   generation down with no retry at all.
8. **Find out who is physically setting the box up**, and get the IPMI credentials to them.
9. Prepare, don't apply: an amd64 build of each image and a **CUDA 12.8** base for the GPU
   services. Blackwell is **sm_120** — anything built for an older arch will not run.
10. **Rotate `services/glioblastoma-predictor/chemtest_tech_private.key`.** It is a private
    key committed to the repo and `COPY`'d into the image. Harmless while nothing runs;
    a live exposure the moment Phase 3 deploys it. Treat the committed key as compromised —
    it is in git history.
11. **Go looking for where ADMET and GROMACS were deployed once.** They ran somewhere,
    possibly the owner's PC, with no surviving record. A working configuration — especially
    a working GROMACS CUDA build — is worth more than a clean-room rebuild in Phase 3.
12. Get Coreto's answer on two triple-slot RTX 5090s (BOX-SPEC §4). Blocks the order.

### Phase 1 — box arrives, base platform

The machine **will not be usable on arrival even though Coreto assembles and tests it** —
Ubuntu is pre-installed, but SSH access, the account, the firewall, and port forwarding on
the Science Park router are all still ours to do.

1. IPMI first — it is the only way back in if networking is misconfigured.
2. SSH keys, no passwords; unattended-upgrades; UFW default deny.
3. **Docker published ports bypass UFW.** This bit us on Oracle: `3000` and `8080` were
   internet-reachable despite a default-deny UFW. Bind every publish to `127.0.0.1` and
   let the reverse proxy be the only listener.
4. **Verify the RAID 1 mirror actually boots degraded.** Coreto was asked for an EFI System
   Partition on *both* mirror disks. Confirm it — `efibootmgr -v`, then pull one drive and
   boot. A mirror that only boots off one disk is a mirror that does not work, and finding
   that out during a failure is the whole thing this was bought to avoid.
5. Partition and mount `/srv/scratch`, `/srv/cache`, `/srv/archive` per §6.
6. **NVIDIA driver 570 branch or newer** + CUDA 12.8 + `nvidia-container-toolkit`. Verify
   `nvidia-smi` reports both cards as `sm_120`, and that a container sees them. The 550
   branch does not support Blackwell — if Coreto shipped it, replace it before anything else.
7. Record sustained GPU temperatures under a real two-card load before trusting the build.
   Two 575 W triple-slot cards in a noise-damped tower is the one thing Coreto has not
   confirmed (BOX-SPEC §4); measure it rather than assume it.

### Phase 2 — move Pile 1 (the actual migration)

1. Bring up Mongo on the box and **restore from 83's dump, not Oracle's** — 83 is production
   and holds the users. Verify counts against the Phase 0 inventory. Bring up Postgres and
   either restore the Tanimoto index or rebuild it from source data, per Phase 0 step 5.
2. Build and start the app image for **amd64** (see §6 arch note) and the tonomitosql
   stack. Point `TANIMOTO_API_BASE` at the box's own service over the compose network.
   **Cut the MCP server over in the same step as the app**, not separately — it is hard-wired
   to `MEDSAAS_API_BASE: http://app:3000` on the compose network, so it follows the app or it
   breaks. It is also the other service that needs public HTTPS (decision B).
3. Reimplement `/convertSTR` locally and repoint `SDF_CONVERTER_URL`. **Leave the 83
   service running** until the local one is proven.
4. Stand up ingress per decision B; register the Stripe webhook against the new URL and
   verify a real `checkout.session.completed` grants credits.
5. Rewrite the stale `ligandServiceConfig` values found in Phase 0.
6. Cut over DNS / the frontend's API base. Keep Oracle running.

### Phase 3 — deploy Pile 2 (first-time)

RabbitMQ → ADMET worker → GROMACS (CUDA rebuild) → glioblastoma. Each gets a healthcheck
and each is verified end-to-end from the dashboard, since none of these paths has ever run
in production.

### Phase 4 — docking (this is the point of the machine)

Rewritten 2026-07-28. See [BOX-SPEC.md](./BOX-SPEC.md) §1 and §5.

**Phase 4 does not have to wait for Phase 2.** It is numbered last because it is the largest
build, not because it is blocked. The cutover is a **config change, not a deploy** (see
below), so docking can move to the box the moment Phase 1 is green — while the API, Mongo
and the MCP server are all still on Oracle. Given the reason for the purchase is Moscow
availability, **do this as early as it will go**, not last.

1. **AutoDock-GPU**, built for `sm_120`. This replaces `dockingApiUrl`
   (`services.asinex.com:8000/docking`), which the Asinex/Pyxis CEO confirms is AutoDock.
   Match the output contract captured in Phase 0.1 — the engine is known, the field names
   are not, and `simulation.jsx` plus the two `sanitized*` endpoints read them by name.
2. **`autogrid` map cache.** Maps are per-receptor, CPU-bound, ~30–60 s, ~60 MB, and
   *cacheable*. Roughly 60 MB per target — an **estimate from typical box dimensions, not measured**; confirm it before trusting the cache sizing. Key them by PDB ID on `/srv/cache`. The first dock against a protein
   pays for the maps; every subsequent ligand against the same target does not. This is
   what makes 32 cores sufficient — grid generation happens once per target, not once per
   dock.
3. **OSS DiffDock** (`gcorso/DiffDock`, MIT), torch cu128. **Not the NIM container** — that
   needs NVIDIA AI Enterprise, which was refused, and NIM is not supported on GeForce.
   Asinex's `services.asinex.com:58000` *is* the NIM container on their hardware, so this is
   a rebuild, not a lift.
4. **AutoDock Vina** (classic, CPU) across the **32 cores**, as the reference/fallback path
   and the second opinion when a GPU score looks wrong.
5. **Fix the synchronous hold.** `/api/simulation` and `/api/diffdock/generate` block an HTTP
   connection for up to **10 minutes** (`EXTERNAL_HTTP_TIMEOUT_LONG_MS`, `server/index.js:217`).
   That is acceptable against a remote proxy; against two local cards it becomes an invisible
   queue with no cancel and no progress. Give it a job ID and a poll endpoint, reusing the
   RabbitMQ path ADMET already uses. Jobs are independent, so this is fan-out — not the
   two-stage CPU/GPU pipeline an MSA would have needed.
6. Resolve `server/diff_dock.sh` — it posts to a `localhost:8000` NIM that has never run.
   Make it real or delete it.

**Not in scope:** the Asinex catalog and stock services. `catalogApiBase` and `stockApiUrl`
keep pointing at Asinex — the catalog because replacing it needs their compound file (a
licensing question), and stock because **no machine can compute it**. BOX-SPEC §5. Note that
`dev.asinex.com:58181` is in the same Moscow, so the catalog carries the same availability
risk; 128 GB of RAM was bought partly to keep moving it a decision rather than a re-purchase.

**Also not in scope any more:** ColabFold databases, OSS OpenFold3/Boltz-2, the MSA pipeline,
and the MolMIM replacement. `/api/openfold3/predict` and `/api/generate-molecules` keep
calling `health.api.nvidia.com` and need no work at all.

#### The cutover is four fields, and it is also the rollback

`company.ligandServiceConfig` (`server/index.js:886–906`, validated at `:1189`) overrides
all four Asinex URLs **per company**, and it is editable from the Company Admin UI. Every
request resolves them through `getRequestLigandServiceConfig(req)` rather than reading the
env directly.

| Field | Points at, after Phase 4 |
|---|---|
| `dockingApiUrl` | the box |
| `diffdockApiUrl` | the box |
| `catalogApiBase` | Asinex, unchanged |
| `stockApiUrl` | Asinex, unchanged |

Consequences worth being explicit about:

- **No deploy is needed to cut over**, and none is needed to roll back. If the box misbehaves,
  point the two URLs back at Asinex from the admin UI and the product is running again in
  seconds — degraded to Moscow's availability, but running.
- **Keeping the Asinex URLs valid is the disaster-recovery plan** for a machine with pick-up
  warranty. Do not let the Asinex account lapse the day the box goes live.
- Migration risk on the highest-value part of this project is therefore close to zero, which
  is the argument for doing it first rather than last.
- The same mechanism is a footgun: a company row with a stale hard-coded URL silently keeps
  using it. That is what Phase 0.2 inventories.

### Phase 5 — take this project off Oracle

**Revised 2026-07-28: Oracle loses all connection to this project.** It was a side project,
never production; its Mongo is not migrated and its data is discarded. Earlier versions of
this document kept it as a reduced host and the offsite backup target — both are wrong now.

The machine keeps running as the owner's own box. What leaves is medsaas. Five containers,
in this order, **each only after its replacement has served real traffic for a while**:

| Order | Container | Remove when |
|---|---|---|
| 1 | `medsaas-app-1` | Immediately — a defunct non-prod copy nobody uses |
| 2 | `medsaas-mcp-server-1` | The box's MCP server is reachable and Claude for Life Sciences has connected |
| 3 | `medsaas-mongo-1` | The box's Mongo is live. Data **not** migrated |
| 4 | `tonomitosql-api-1` | `/tanimoto/v1/*` on the box has answered real queries |
| 5 | `tonomitosql-db-1` | **Last.** Take a final `pg_dump` to `/srv/archive` first — the index is being rebuilt rather than restored, but it costs nothing and it is the only copy |

Then remove the `deploy.yml` target, the deploy key, and any Actions secret pointing at
`151.145.91.17` — and **drop the hardcoded Oracle fallback in `TANIMOTO_API_BASE`**
(`server/index.js:80` defaults to `http://151.145.91.17:8000`; leave it and a missing env var
silently routes Tanimoto to a decommissioned host).

**Do not touch** CLIProxyAPI (`:8317`), the Codex OAuth token, or Crafty (`:8443`) — owner
tooling, unrelated to Pyxis. Ops notes for that machine are in `~/projects/oracle`.

**Sequencing rule: rebuild on the box, verify against real traffic, then remove from Oracle.**
Nothing is deleted to make room — the box has 24 TB.

**Consequence to state plainly:** with Oracle gone and 83 reduced to a static frontend, every
service and every database in this project lives in **one chassis**, on pick-up warranty, with
no offsite backup. The mirror and the second GPU cover component failure. Nothing covers the
chassis. See open decision 4.

---

## 7b. The NVIDIA rate limit — the other single point of failure

Added 2026-07-28. The box solves Moscow. It does nothing about the other external dependency,
which is currently in worse shape than anyone had noticed.

Folding and molecule generation each run on **one free-tier API key**
(`NVIDIA_OPENFOLD_API_KEY` at `server/index.js:313`, `NVIDIA_MOLMIM_API_KEY` at `:260`), and
the free tier exhausts fast under real use. **Neither route handles a 429 at all** — both do
`error.response?.status || 500`, so NVIDIA's rate-limit response is relayed straight to the
user with no retry, no backoff and no queue. One burst and two dashboard features stop
working, with no signal beyond a red toast.

**1. Handle the 429. Do this regardless of everything else, and before the box arrives.**
Cheapest available fix, helps under every scenario. Both keys are already separate env vars,
so widen each to a comma-separated pool, select the least-recently-429'd key, back off
exponentially, and open a circuit breaker to the failover when the whole pool is cooling. It
converts a hard failure into a wait. Roughly sixty lines; independent of the hardware.

**2. Price paid access. Nobody has asked.** Free credits are a trial, not a product. If
folding matters to Pyxis users the honest answer may be to pay for it. Note that NVIDIA AI
Enterprise — refused earlier on cost — is the licence for **self-hosting NIM containers**,
which is not obviously the same product as hosted API access. Ask before assuming.

**Do not create extra accounts for extra free keys.** Against build.nvidia.com's terms, and
the failure mode is every key revoked simultaneously at the worst possible moment.

**3. Self-host as failover — the cheap half only.**

| Feature | Self-host? | Reasoning |
|---|---|---|
| **Molecule generation** (MolMIM) | **Yes** | Small model, **no MSA**, fits one 5090 easily. REINVENT4 or similar behind the circuit breaker turns a 429 into "slightly different results" instead of an error |
| **Protein folding** (OpenFold3) | **Not yet** | Needs an MSA — the single largest engineering item on this project, and the ~900 GB ColabFold database build that was deliberately cut from the box's scope |

If folding ever comes in-house, scope it as **Boltz-2 with a remote MSA server**, not
OpenFold3 with local databases; that is days rather than weeks. Two honest caveats: it swaps
the NVIDIA dependency for the ColabFold MSA server (also free, also rate-limited, also
somebody else's academic infrastructure), and **32 GB of VRAM sits right at OpenFold3's
working-set floor** — itself an argument for Boltz-2 over OpenFold3 locally. **Verify the
remote-MSA capability before planning against it**; it is recalled, not checked.

The framing that decides it: §5 asked *"is NVIDIA faster than we can be?"* — yes, still. The
question now is *"what happens when NVIDIA returns 429?"* A slow local run beats a hard
failure, but only where standing it up is cheap. That is generation, not folding.

---

## 8. Gotchas found in the trace

Each of these will bite silently if it is not handled deliberately.

**arm64 → x86_64.** Oracle is Ampere A1 `aarch64`; the box is Threadripper `x86_64`. Every
image is rebuilt. Specifically:

- `deploy.yml`'s entire build-on-box rationale is *"avoids cross-architecture/QEMU build
  issues for the Oracle Ampere arm64 host."* On an amd64 box, runner-side build or a
  registry becomes viable again. `docs/CI-CD.md` describes the current arm64 reality and
  will need updating **when** the switch happens, not before.
- `tonomitosql`'s `Dockerfile` has an explicit ARM fallback: `pip install rdkit-pypi ||
  (echo "rdkit-pypi failed (likely ARM)" && install without it)`, and `app/chem.py`
  degrades to SQL-side validation when it is missing. On x86_64 `rdkit-pypi` installs
  normally — so this **improves** on the box. Verify the fallback branch is not silently
  taken anyway.
- Confirm `informaticsmatters/rdkit-cartridge-debian:Release_2024_09_3` publishes an amd64
  tag (it should — amd64 is the primary target).

**The ADMET CPU-wheel trap.** `services/admet/requirements.txt` is just
`admet-ai / pika / requests / pandas` on `python:3.12-slim` — a CPU-only torch. Rebuild on
`nvidia/cuda:12.8.x-runtime-ubuntu24.04` and install the **cu128 torch wheel before**
`admet-ai`. Installing `admet-ai` first lets chemprop's pins silently reinstall the CPU
wheel, and **that failure never errors** — it is just slow forever. Verify inside the
image with `torch.cuda.is_available()`.

**Private addresses are rejected for ligand URLs.** `getRequestLigandServiceConfig` calls
`assertConfiguredUrlsArePublic`, which resolves the hostname and rejects `10/8`,
`127/8`, `169.254/16`, `172.16/12`, `192.168/16`, **`100.64/10` (CGNAT — this is
Tailscale)**, plus IPv6 loopback/link-local/ULA. It only checks values that **differ from
the default**, so:

- Wiring `dockingApiUrl` or `diffdockApiUrl` to the box over a LAN or Tailscale address
  **fails at runtime with a confusing error.**
- Use the compose service name resolved inside the Docker network, or a real public
  hostname, or change the defaults rather than setting per-company overrides.
- `TANIMOTO_API_BASE`, `GROMACS_API_BASE`, `GLIOBLASTOMA_API_BASE` and
  `SDF_CONVERTER_URL` are **not** subject to this check — only the four ligand fields.

**Stale per-company config in Mongo.** `ligandServiceConfig` lives on the company record.
A company that overrode a URL keeps pointing at the old host after the move, silently, for
that tenant only. Phase 0 step 4 exists for this.

**A private key is committed in the repo.** `services/glioblastoma-predictor/` contains
`chemtest_tech_private.key` (plus `.crt`, `.csr`, `.p7b`, a full chain, and a domain
validation file), and the `Dockerfile` `COPY`s the key into the image. Deploying that
service for the first time means deploying a checked-in private key for `chemtest.tech`.
Rotate it, move it to a secret, and scrub it — flagged only, nothing removed.

**`server/diff_dock.sh` is dead code today.** It posts to `localhost:8000` where no NIM has
ever run, and it hardcodes 8G43/ZU6. Either it becomes the real local-DiffDock caller or it
goes; do not leave it looking functional.

**Oracle is not just medsaas.** The medsaas and tonomitosql containers leave (§7 Phase 5), but
the machine keeps running: `cliproxyapi.service` (the CLIProxyAPI AI gateway on `:8317` that
`claude-gpt` and T3 Code route through — **owner tooling, unrelated to Pyxis**), Crafty on
`:8443`, and the Codex OAuth refresh token in `~/.cli-proxy-api/auths/`. Remove this
project's five containers and its deploy plumbing; leave everything else alone. **It is not
the offsite backup target** — that idea assumed it stayed part of the project, and it has
~24 GB free besides.

**The 83 box is shared and rules apply.** It runs finbs production on `:4000` and its notes
say: *"The VPS is shared. Do not modify nginx, TLS, DNS, firewall, or other apps."* The
`/convertSTR` service on `:8001` is a Pyxis dependency squatting there. Move it, then stop
it — but do not touch anything else on that machine.

---

## 9. Still to decide (all owner calls)

1. **Will Coreto build two triple-slot RTX 5090s in that chassis?** BOX-SPEC §4. The last
   technical unknown, and it blocks the order.
2. **Who physically sets the box up.** Unboxing, power, two network cables, IPMI address and
   credentials, and the Science Park router. The owner will not be there and nobody is
   assigned. **This blocks everything.**
3. **Public HTTPS ingress for the box** (§3-B) — blocks Stripe webhooks and Claude for Life
   Sciences. Caddy + a DNS name on the box recommended; do not plan on touching nginx on 83.
4. **Offsite backup target** (§6) — and it is **now unowned**. Oracle was the placeholder and
   Oracle is leaving. Not the 24 TB in the same chassis, not the mirror. With everything on
   one machine and pick-up warranty, restore-elsewhere has to work from the offsite copy
   alone. **This is the largest open risk in the plan.**
5. **NVIDIA paid API access — never priced.** Both hosted features run on a single free-tier
   key with no 429 handling (§10). Ask what production access costs; it decides whether local
   folding is ever a project. Note that NVIDIA AI Enterprise, refused earlier on cost, is the
   licence for *self-hosting* NIM, which is not obviously the same product.
6. **When do the catalog and stock move?** Both are Moscow, both carry the same war risk as
   the docking services being replaced, and the owner has confirmed **both are temporary**.
   The catalog is blocked on Asinex's compound file (licensing). Stock cannot be *computed*
   here at any price and needs a different answer — a data feed, or a different supplier.
   Buyer has accepted the interim.

Settled, recorded here so they are not re-litigated:

- **The reason for the whole project is that Asinex's servers are in Moscow and go down
  because of the war** (2026-07-28). Not performance, not cost, not self-reliance. BOX-SPEC §1.
- **Hardware is chosen**: RECT WS-3229C, 2× RTX 5090, PRO 9975WX 32C, 128 GB, RAID 1 boot
  pair, €24,727 net. BOX-SPEC §2–3 records why, including what was rejected.
- **Folding and molecule generation stay on NVIDIA's hosted NIM.** The box is for
  **docking**. Everything else that gets faster here does so incidentally and gets no budget
  spent on it.
- **MolMIM needs no replacement** — it stays hosted.
- **DiffDock is Asinex's, not NVIDIA's**, and must be rebuilt locally from OSS. It does not
  survive the cut.
- **The 1-click docking engine is AutoDock**, confirmed by the Asinex/Pyxis CEO.
- **The docking workload is interactive single-ligand, not batch** — verified in code, not
  assumed. It is why the GPU choice favoured per-card speed over aggregate core count.
- **Frontend stays on 83** at `app.pyxis-discovery.com` (§3). The box is backend only.
- **83's Mongo is production and holds the users** (2026-07-28). This closes what was open
  item 2 in every earlier version. Oracle's Mongo belongs to a side project, was never
  production, and its data is **discarded, not merged**. Every restore step that pointed at
  Oracle has been repointed at 83. What remains is an inventory task: nobody has looked at
  83's Mongo — collections, counts, auth, reachability, schema drift.
- **Oracle leaves this project entirely** (§7 Phase 5, §8). Not a reduced host, not a backup
  target. The machine keeps running the owner's unrelated tooling.
- **The box is the whole backend, not just compute** — Mongo included.
- **ADMET and GROMACS ran somewhere once**, possibly the owner's PC, with no surviving record.
  "Never deployed" was wrong. Look for the working configuration before rebuilding from
  scratch — particularly the GROMACS CUDA build.
