# Compute Box Migration — full trace and move plan

**Status:** planning. **Nothing has been changed or removed.** This document is the
inventory and the sequence; every code/compose/Dockerfile edit it implies is still to be
approved.

**Target machine** (Coreto RECT WS-2229C, ordered 2026-07): Threadripper 9980X 64C ·
128 GB DDR5-5600 ECC Reg. (4×32, **four** populated channels) · 2× RTX PRO 5000 Blackwell
48 GB (no NVLink, MIG off) · 2 TB + 4 TB Samsung 990 Pro NVMe · 8 TB WD Red Plus ·
2×10 GbE · IPMI · Ubuntu Server 24.04 LTS. Physically at Science Park 408 Unit 1.05, 1098
XH Amsterdam.

**Goal as stated by the owner:** the box is the **whole backend and all computation**, as
self-reliant as possible. The frontend is served elsewhere. Everything that can use CUDA
should use CUDA.

---

## 1. This is not one move. It is three different jobs.

Reading the trace as a lift-and-shift is the main way to get this wrong. Only the first
pile is actually a migration.

### Pile 1 — running today, changes host (a real move)

| Thing | Runs today on | Port | Moves to box as |
|---|---|---|---|
| Express API (`server/index.js`) + baked-in frontend | Oracle VPS `medsaas-app-1` | 3000 | API only (see §3) |
| MongoDB 7 (`--auth`) | Oracle VPS `medsaas-mongo-1` | internal 27017 | same, plus data restore |
| ChemBench MCP server (`services/mcp-server`) | Oracle VPS `medsaas-mcp-server-1` | 8080 | same, needs public HTTPS |
| tonomitosql API (Tanimoto/RDKit search) | Oracle VPS `tonomitosql-api-1` | 8000 | same |
| Postgres + RDKit cartridge (`informaticsmatters/rdkit-cartridge-debian:Release_2024_09_3`) | Oracle VPS `tonomitosql-db-1` | internal 5432 | same, plus `pgdata` restore |
| SMILES→SDF converter (`/convertSTR`) | **the 83 box** `83.229.87.94:8001` | 8001 | rebuild on box (see §6) |
| `mol_price` data + its importer | Mongo collection; loaded by `npm --prefix server run import:mol-price -- <mol_price.xlsx>` | — | rides along in `mongodump`, but **the xlsx source is not in the repo** — find out where it lives before it is needed again |

### Pile 2 — code exists in this repo, deployed nowhere (first-time deployment)

Oracle runs exactly five containers. None of these is among them.

| Thing | Source | Notes |
|---|---|---|
| RabbitMQ | `docker-compose.yml` service `rabbitmq` | required by the ADMET flow |
| ADMET worker | `services/admet/` (`admet_sender.py`) | `admet-ai`, consumes the queue, calls back `PUT /api/simulation/:key/admet` |
| GROMACS API | `services/gromacs-api/` | Ubuntu 22.04 + distro `gromacs`, **CPU-only build today** |
| Glioblastoma predictor | `services/glioblastoma-predictor/` | Flask + scikit-learn RandomForest, CPU-only by nature |

So the ADMET, GROMACS and glioblastoma features in the dashboard have never had a live
backend. The box is where they get one for the first time.

### Pile 3 — does not exist anywhere yet (net-new build)

This is the part the €25k was actually justified on, and it is worth being blunt: **no
code in any traced repo performs an MSA, a fold, or a local dock.**

| Capability | Today | On the box |
|---|---|---|
| Structure prediction | `POST /api/openfold3/predict` → thin proxy to `health.api.nvidia.com` | OSS OpenFold3 and/or Boltz-2, local weights, local MSA |
| MSA generation | none — NVIDIA does it inside their hosted call | MMseqs2 + ColabFold databases, **CPU + memory bandwidth, no GPU** |
| Molecule generation | `POST /api/generate-molecules` → proxy to NVIDIA MolMIM | OSS replacement — open decision, see §7 |
| Docking | `POST /api/diffdock/generate` → Asinex-hosted DiffDock URL | local DiffDock + AutoDock-GPU + Vina |
| `server/diff_dock.sh` | posts to `http://localhost:8000/molecular-docking/diffdock/generate` — **a NIM that has never run** | becomes real, or gets deleted |

The owner will not pay for NVIDIA AI Enterprise, so this is the OSS stack, not NIM.

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

## 3. The three machines, after the move

Frontend on 83 (unchanged, already there). Backend consolidates from **three** scattered
places onto one box. Oracle stays alive in a reduced role.

```
                          browser
                             |
                  app.pyxis-discovery.com
                             |
  ┌──────────────────────────────────────────────────────────┐
  │ 83.229.87.94 — shared VPS, nginx + TLS      [UNCHANGED]  │
  │   static frontend (client/dist)  ← stays here            │
  │   also: an unrelated project on :4000                    │
  │   /convertSTR :8001  ← MOVES to the box, then stops      │
  └──────────────────────────────────────────────────────────┘
                             |  HTTPS, cross-origin, bearer token
                             v
  ┌──────────────────────────────────────────────────────────┐
  │ AMSTERDAM BOX — the whole backend        [DOES NOT EXIST │
  │                                           YET, see below]│
  │   Express API :3000 · Mongo · MCP :8080                  │
  │   tonomitosql :8000 + Postgres/RDKit                     │
  │   RabbitMQ · ADMET worker · GROMACS · glioblastoma        │
  │   MSA (MMseqs2) · OpenFold3/Boltz-2                      │
  │   DiffDock · AutoDock-GPU · Vina · SDF converter         │
  └──────────────────────────────────────────────────────────┘
                             |  backup target only
                             v
  ┌──────────────────────────────────────────────────────────┐
  │ ORACLE VPS 151.145.91.17 — reduced, NOT switched off     │
  │   keeps: CLIProxyAPI gateway, Codex token, offsite dumps │
  │   loses: medsaas app, Mongo, MCP, tonomitosql            │
  └──────────────────────────────────────────────────────────┘
```

**The box does not exist yet.** It is ordered, not delivered. Its hostname, IP, MAC, network
position at Science Park, and disk device names are all unknown, so every plan below is
written against roles (`/srv/refdb`, "the box") rather than addresses. Nothing that needs a
real address can start until it lands. What *is* known is the hardware, at the top of this
document.

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
- **All folding, docking, MD, ADMET, and MSA compute** — that is the point of the box.

### The Asinex question — mostly yes, with one honest exception

There are **four** distinct Asinex dependencies, and they are not equivalent:

| Dependency | Env var | Can it be self-hosted? |
|---|---|---|
| Catalog browse/search | `ASINEX_API_BASE` | **Yes.** Mirror the catalog into the local Postgres+RDKit cartridge. Exact/substructure/similarity are already implemented in tonomitosql. |
| Stock/eShop `/api/Shop` | `ASINEX_STOCK_API_URL` | **Partly.** The *pricing* table is already reverse-engineered (`docs/ASINEX-ESHOP-REVERSE-ENGINEERING.md` §1) and a local mirror already exists in the Mongo `mol_price` collection. **Live milligram stock levels are Asinex's own inventory and cannot be computed here** — a mirror is a snapshot that goes stale. |
| Docking `/docking` | `ASINEX_DOCKING_API_URL` | **Yes.** Replace with local AutoDock-GPU / Vina. |
| DiffDock | `DIFFDOCK_API_URL` | **Yes.** Replace with local DiffDock on a 48 GB card. |

So: **three of the four Asinex dependencies disappear.** The fourth (real-time stock)
stays a vendor call by nature — you can mirror the catalog and the price table, but you
cannot host someone else's warehouse count. Plan the UI to show mirrored catalog + local
price, and treat the live stock check as an optional at-order-time confirmation.

Note the trap already in the code: `ASINEX_*` and `DIFFDOCK_API_URL` are **per-company
overridable**, stored on the company record as `ligandServiceConfig`. See §6.

### Cannot be self-hosted, and does not move

- **NVIDIA hosted endpoints** (`health.api.nvidia.com` MolMIM + OpenFold3) — these are a
  *replace with OSS* decision, not a migration. Until the OSS stack works, they stay.
- **`files.rcsb.org`** (PDB and ideal-ligand SDF fetches, used by the DiffDock route and
  `diff_dock.sh`) and **PubChem / NCI CACTUS** (client-side name→structure lookups). These
  are public reference data. A local PDB mirror is possible later; not worth it now.
- **Stripe**, **Titan Mail** — external by definition.

---

## 5. CUDA: what actually gets a GPU, and what a GPU cannot help

Everything that can use CUDA should — but three of the heaviest pieces are not GPU work at
all, and pretending otherwise is how the box ends up idle.

Blackwell is **sm_120**. That means CUDA **≥ 12.8** and PyTorch **cu128** wheels
everywhere. flash-attn must be built with `TORCH_CUDA_ARCH_LIST="12.0"`, or use
flash-attn 4.

| Workload | GPU? | What to do |
|---|---|---|
| OpenFold3 / Boltz-2 inference | **Yes** | cu128 torch, one model per card. 48 GB clears the ~32 GB floor; **MIG stays off** (2×24 GB is below that floor) |
| DiffDock | **Yes** | cu128 torch |
| AutoDock-GPU | **Yes** | build for sm_120; this is the throughput workhorse for ligand screens |
| GROMACS | **Yes** | current image is the Ubuntu distro package = **CPU only**. Rebuild from source with `-DGMX_GPU=CUDA`; do not ship the apt build |
| ADMET-AI (chemprop) | Yes, marginal | models are tiny, GPU barely helps — but install the **cu128 torch wheel BEFORE `admet-ai`**, see §6 |
| **MSA generation (MMseqs2 / jackhmmer)** | **No — and this is the bottleneck** | pure CPU + memory bandwidth. ~⅔ of every job's wall clock. The cards are idle ~65–75 % of a job |
| AutoDock Vina (classic) | No | CPU, embarrassingly parallel across 64 cores |
| Tanimoto / RDKit cartridge search | No | CPU + RAM-resident index; no CUDA path exists |
| Glioblastoma predictor | No | scikit-learn RandomForest. CPU |
| Express API, Mongo, Postgres, RabbitMQ | No | — |

Two consequences to keep in view:

- **Job shape.** ~800-token protein+ligand jobs on four memory channels: MSA ≈ 5.5 min,
  templates ≈ 1 min, inference 2–5 min, I/O ≈ 1 min → **≈ 8.5 min/job**, ~18–20 jobs/hour
  with two cards. Eight channels would have been ~7.2 min; that option was not bought.
- **Scheduling.** Because MSA is CPU-bound and inference is GPU-bound, the two should be
  pipelined, not serialised — run MSA for job *n+1* while job *n* is on a card. Otherwise
  both cards sit idle two thirds of the time. This is a real piece of work, not a config
  flag. Queue it in RabbitMQ with separate CPU-stage and GPU-stage consumers.

### Will local folding actually be faster than NVIDIA's hosted NIM?

Worth answering directly, because it is the one place where moving in-house may **cost**
speed rather than gain it, and the answer changes depending on how the machine is used.

**Per single cold job: probably slower.** Two reasons.

1. **The card.** RTX PRO 5000 Blackwell has 48 GB of GDDR7 at roughly 1.3 TB/s. NVIDIA
   almost certainly serves the OpenFold3 NIM on datacenter parts — H100 at ~3.35 TB/s HBM3,
   H200 at ~4.8 TB/s. Transformer inference tracks memory bandwidth closely, so expect our
   inference stage to be somewhere in the region of 1.5–3× slower than theirs. *Caveat: what
   NVIDIA actually runs behind that endpoint is not published. This is an inference from
   hardware class, not a measurement.*
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

Once MSAs are cached, a screening run is inference-only, both cards saturated, no rate limit —
and local wins outright. **Build the MSA cache in Phase 4; it is not an optimisation to defer,
it is what makes the machine pay for itself.**

### Everything that was *not* on NIM gets dramatically faster

Only the two hosted-NIM features are ambiguous. Everything else is a straight upgrade, and the
comparison is not close, because the thing being replaced is a **2 vCPU / 12 GB free-tier
Ampere instance** (and for GROMACS, a CPU-only build):

| Workload | Before | After | Rough expectation |
|---|---|---|---|
| GROMACS MD | apt build, **CPU-only**, never deployed | source build, `-DGMX_GPU=CUDA`, 2 cards | order-of-magnitude class change |
| Tanimoto / RDKit search | 2 vCPU, 12 GB, aarch64 | 64 cores, 128 GB, x86_64 + native `rdkit-pypi` | very large |
| ADMET | never deployed; CPU torch | 64 cores + cu128 torch | very large (mostly from the CPU) |
| Glioblastoma predictor | never deployed | 64 cores | large |
| AutoDock-GPU / Vina | did not exist locally | 2 cards + 64 cores | new capability |
| Express API / Mongo / Postgres | 2 vCPU shared with everything | 64 cores, NVMe | large |

### RAM reality check

The 128 GB was argued for concurrent MSA slots plus keeping the Tanimoto fingerprint index
hot in cache. If the *entire* backend also lands here — Mongo, Postgres+RDKit, RabbitMQ, an
`ADMETModel` resident per worker, plus the OS page cache that MMseqs2 leans on — then less
is available for MSA than the purchase case assumed. Not a blocker. Budget it explicitly:
cap Postgres `shared_buffers`, cap the Mongo WiredTiger cache, and run one ADMET worker,
not four.

---

## 6. Storage: what goes on which medium

Three devices, no RAID, no redundancy. Assign by access pattern, not by size.

| Mount | Device | Contents | Why here |
|---|---|---|---|
| `/` | **2 TB NVMe** (990 Pro) | Ubuntu 24.04, `/var/lib/docker` (images + layers), model weights (OpenFold3/Boltz-2/DiffDock/ADMET ≈ 10–30 GB), CUDA toolchain | Boot device. Container image churn is write-heavy; keep it away from the data and scratch |
| `/srv/refdb` | **4 TB NVMe** (990 Pro) | **ColabFold / MMseqs2 databases** — UniRef30 + envDB + PDB100, ~900 GB expanded and considerably more transiently during index build | **The most important placement decision.** MMseqs2 prefilter is random-read; NVMe is the reason the 4 TB stayed in the cart |
| `/srv/scratch` | **4 TB NVMe** | per-job working dirs: MSA intermediates, GROMACS running trajectories, DiffDock poses | Highest-churn writes on the machine, and they pair with `refdb` reads. Keeping them off the boot device leaves Docker layer churn on its own disk. Wipe on a timer |
| `/srv/db` | **4 TB NVMe** | Postgres `pgdata` (RDKit cartridge + fingerprint GiST indexes), Mongo `dbPath` | Random-read, latency-sensitive, and small (tens of GB) |
| `/srv/archive` | **8 TB WD Red Plus** (HDD) | finished job outputs, completed GROMACS trajectories, raw database download tarballs, Asinex catalog dumps, nightly `mongodump` + `pg_dump` | Sequential, write-once-read-rarely. Exactly what an HDD is for |

Notes and cautions:

- **Do not put `refdb` on the 8 TB HDD.** MMseqs2's prefilter does random reads across a
  ~900 GB index; that is the access pattern HDDs are worst at, and it was the justification
  for the 4 TB NVMe staying in the cart. How much worse it actually is has not been
  measured — see Phase 4.1, benchmark before trusting any number, including this one.
- **Headroom and ordering:** full ColabFold DB creation transiently needs roughly double the
  final size, so build the indexes on `/srv/refdb` **before** `/srv/scratch` fills with job
  data — the two share the 4 TB. Download the tarballs to `/srv/archive` (HDD), expand and
  index onto `/srv/refdb`, and keep the tarballs on the HDD so a rebuild never re-downloads
  ~900 GB.
- **Backups are not solved by the 8 TB disk.** It is in the same chassis, on the same
  power supply, in the same room. `mongodump`/`pg_dump` to `/srv/archive` protects against
  *logical* mistakes only. **An offsite copy is still needed** — and Oracle cannot be it,
  that box has ~24 GB free.
- The service level on the box is **pick-up warranty**: a hardware fault means the machine
  ships to Germany and is out of production for 1–3 weeks. Restore-elsewhere must be
  possible from the offsite copy alone.

---

## 7. Migration sequence

Ordered so that nothing is switched off before its replacement is proven. **Nothing here
is destructive; the Oracle stack keeps running throughout.**

### Phase 0 — before the box arrives (can start now)

1. Decide **A** (frontend location) and **B** (public HTTPS ingress). Both block later
   phases.
2. Take a full backup of what has to survive: `mongodump` of `medsaas-mongo-1` and a
   `pg_dump` of `tonomitosql-db-1`. The Postgres dump *is* the Tanimoto index —
   re-uploading CSVs is not equivalent, dataset ids and fingerprints would change.
3. Write down every value in the box's future `.env`. It is not in git and never will be.
4. Inventory the persisted per-company overrides:
   `db.companies.find({}, {companyId:1, name:1, ligandServiceConfig:1})`. Every non-default
   URL there is a stale pointer that survives the move.
5. Prepare, don't apply: an amd64 build of each image, a CUDA 12.8 base for the GPU
   services, and the ColabFold DB download list.

### Phase 1 — box arrives, base platform

The machine **will not be usable on arrival even though Coreto assembles and tests it** —
Ubuntu is pre-installed, but SSH access, the account, the firewall, and port forwarding on
the Science Park router are all still ours to do.

1. IPMI first — it is the only way back in if networking is misconfigured.
2. SSH keys, no passwords; unattended-upgrades; UFW default deny.
3. **Docker published ports bypass UFW.** This bit us on Oracle: `3000` and `8080` were
   internet-reachable despite a default-deny UFW. Bind every publish to `127.0.0.1` and
   let the reverse proxy be the only listener.
4. Partition and mount per §6.
5. NVIDIA driver + CUDA 12.8 + `nvidia-container-toolkit`; verify `nvidia-smi` sees both
   cards and that a container can too.

### Phase 2 — move Pile 1 (the actual migration)

1. Bring up Mongo and Postgres on the box; restore the Phase 0 dumps; verify counts.
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

### Phase 4 — build Pile 3 (the science stack)

1. ColabFold databases onto `/srv/refdb`; benchmark a real MSA and record the actual
   minutes — every throughput number in the purchase case is an estimate.
2. OSS OpenFold3 and/or Boltz-2 behind an internal API matching the shape
   `/api/openfold3/predict` already returns, so the client does not change.
3. AutoDock-GPU + Vina; then DiffDock. Repoint `dockingApiUrl` / `diffdockApiUrl`.
4. Pipeline the CPU (MSA) and GPU (inference) stages through RabbitMQ per §5.
5. Decide the MolMIM replacement — **open.** MolMIM is BioNeMo/NIM and NVIDIA AI
   Enterprise is off the table, so `/api/generate-molecules` needs a different generator
   (REINVENT4 and similar are the usual OSS answer). Until then this one route keeps
   calling NVIDIA's hosted endpoint.
6. Mirror the Asinex catalog into Postgres per §4.

### Phase 5 — decommission review

Only after everything above is green. See §8 — Oracle does not simply get turned off.

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

**Oracle is not just medsaas.** Before anyone thinks about switching it off, note what else
lives there: `cliproxyapi.service` (the CLIProxyAPI AI gateway on `:8317` that `claude-gpt`
and T3 Code route through — **owner tooling, unrelated to Pyxis**), Crafty on `:8443`, and
the Codex OAuth refresh token in `~/.cli-proxy-api/auths/`. Oracle is free-tier and always
on; keeping it as the offsite backup target and the AI gateway is the sensible outcome, not
decommissioning it.

**The 83 box is shared and rules apply.** It runs finbs production on `:4000` and its notes
say: *"The VPS is shared. Do not modify nginx, TLS, DNS, firewall, or other apps."* The
`/convertSTR` service on `:8001` is a Pyxis dependency squatting there. Move it, then stop
it — but do not touch anything else on that machine.

---

## 9. Still to decide (all owner calls)

1. **Public HTTPS ingress for the box** (§3-B) — blocks Stripe webhooks and Claude for Life
   Sciences. Caddy + a DNS name on the box recommended; do not plan on touching nginx on 83.
2. **What replaces MolMIM** for `/api/generate-molecules` (§7 Phase 4.5).
3. **Offsite backup target** (§6) — not Oracle, not the 8 TB disk in the same chassis.
4. **Does the Asinex live-stock call stay?** (§4) — recommended yes, as an at-order-time
   check only, with catalog and price served locally.

Settled, recorded here so they are not re-litigated:

- **Frontend stays on 83** at `app.pyxis-discovery.com` (§3). The box is backend only.
- **Oracle is not decommissioned** (§8) — it keeps the CLIProxyAPI gateway and becomes the
  offsite dump target.
- **The box is the whole backend, not just compute** — Mongo included.
