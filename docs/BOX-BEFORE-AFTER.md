# The box: before, after, and arrival day

Companion to [BOX-SPEC.md](./BOX-SPEC.md) (what was bought and why) and
[COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md) (the phased sequence). This document
answers three plainer questions: **what runs where today, what runs where afterwards, and
what actually happens on the day the machine turns up.**

**Status:** planning. Nothing here has been applied.

---

## The one-line version

Today, every docking job Pyxis runs is computed in **Moscow**. Afterwards, every docking job
is computed in **Amsterdam, on hardware we own.** Folding and molecule generation keep going
to NVIDIA either way. The catalog and stock lookups keep going to Moscow, because one needs
a licence we do not have and the other cannot be computed at all.

---

## Before — where everything is today

```
  browser ─── app.pyxis-discovery.com
                     │
      ┌──────────────┴───────────────────────────────────┐
      │ 83.229.87.94 — shared VPS (nginx + TLS)          │
      │   static frontend                                │
      │   /convertSTR :8001  (SMILES → SDF)              │
      │   ⚠ and something unidentified answering the API │
      │   ⚠ shared with an unrelated project — hands off │
      └──────────────┬───────────────────────────────────┘
                     │
      ┌──────────────┴───────────────────────────────────┐
      │ ORACLE VPS 151.145.91.17 — Ampere arm64, 2 vCPU  │
      │   medsaas-app-1        Express API :3000         │
      │   medsaas-mongo-1      MongoDB 7                 │
      │   medsaas-mcp-server-1 MCP :8080                 │
      │   tonomitosql-api-1    Tanimoto :8000            │
      │   tonomitosql-db-1     Postgres + RDKit          │
      │   (this is the *non-prod* stack — deploy.yml     │
      │    is literally "Build & Deploy (non-prod)")     │
      └──────────────────────────────────────────────────┘
                     │
      ┌──────────────┴──────────────┐   ┌────────────────────────────┐
      │ ASINEX — MOSCOW             │   │ NVIDIA — health.api.nvidia │
      │   :8000  AutoDock docking   │   │   OpenFold3 folding        │
      │   :58000 DiffDock (NIM)     │   │   MolMIM generation        │
      │   :58181 catalog + search   │   └────────────────────────────┘
      │   :5443  stock + pricing    │
      │   ⚠ goes down — the war     │
      └─────────────────────────────┘

  NOT DEPLOYED ANYWHERE: RabbitMQ · ADMET worker · GROMACS · glioblastoma
```

**Nothing in this repo performs a dock.** Both docking endpoints are thin proxies to Moscow.

## After — where everything ends up

```
  browser ─── app.pyxis-discovery.com
                     │
      ┌──────────────┴───────────────────────────────────┐
      │ 83.229.87.94 — UNCHANGED                         │
      │   static frontend only                           │
      │   /convertSTR retired once the box's copy works  │
      └──────────────┬───────────────────────────────────┘
                     │ HTTPS, cross-origin, bearer token
      ┌──────────────┴───────────────────────────────────┐
      │ AMSTERDAM BOX — Science Park 408 Unit 1.05       │
      │   Express API · Mongo · MCP server               │
      │   Tanimoto + Postgres/RDKit                      │
      │   RabbitMQ · ADMET · GROMACS · glioblastoma      │
      │   ★ AutoDock-GPU  ★ DiffDock  ★ CPU Vina         │
      │   SMILES → SDF                                   │
      │   2× RTX 5090 · 32 cores · 128 GB · RAID 1       │
      └──────────────┬───────────────────────────────────┘
                     │
      ┌──────────────┴──────────────┐   ┌────────────────────────────┐
      │ ASINEX — MOSCOW, REDUCED    │   │ NVIDIA — UNCHANGED         │
      │   :58181 catalog + search   │   │   OpenFold3 · MolMIM       │
      │   :5443  stock + pricing    │   └────────────────────────────┘
      │   (docking URLs kept valid  │
      │    as the rollback path)    │   ┌────────────────────────────┐
      └─────────────────────────────┘   │ ORACLE — reduced, NOT off  │
                                        │   CLIProxyAPI · Codex token│
                                        │   offsite dump target      │
                                        └────────────────────────────┘
```

---

## Calculations — what moves and what does not

| Calculation | Route | Before | After |
|---|---|---|---|
| **1-click docking** | `POST /api/simulation` | Asinex `:8000` — **Moscow**, AutoDock | **Box** — AutoDock-GPU, `sm_120`, on an RTX 5090 |
| **DiffDock** | `POST /api/diffdock/generate` | Asinex `:58000` — **Moscow**, NVIDIA NIM container on their GPU | **Box** — OSS DiffDock, torch cu128 |
| Classic CPU Vina | *does not exist yet* | — | **Box** — 32 cores, as the reference/second-opinion path |
| Protein folding | `POST /api/openfold3/predict` | NVIDIA hosted | **unchanged** — NVIDIA hosted |
| Molecule generation | `POST /api/generate-molecules` | NVIDIA MolMIM hosted | **unchanged** — NVIDIA hosted |
| Tanimoto / substructure / similarity | `/tanimoto/v1/*` | Oracle — 2 shared vCPU, arm64, RDKit degraded to a SQL fallback | **Box** — 32 cores, x86_64, native `rdkit-pypi`, index in page cache |
| Catalog + structure search | `/api/asinex/*`, `/api4/*` | Asinex `:58181` — **Moscow** | **unchanged for now.** Needs Asinex's compound file — a licence, not hardware. Same Moscow risk remains |
| Stock and availability | `POST /api/shop` | Asinex `:5443` | **unchanged, permanently.** No machine computes what is on their shelf |
| SMILES → SDF | inside `/api/diffdock/generate` | `83.229.87.94:8001` | **Box** — 83's copy left running until the local one is proven |
| ADMET prediction | RabbitMQ queue | **never deployed** | **Box** — first time it has ever run |
| GROMACS MD | `/api/gromacs/*` | **never deployed** | **Box** — first time, after a `-DGMX_GPU=CUDA` rebuild |
| Glioblastoma | `/api/glioblastoma/*` | **never deployed** | **Box** — first time |

### What a Pyxis user actually notices

- **Docking stops failing when Moscow is unavailable.** This is the entire point.
- **Docking gets faster**, though by an unmeasured amount — nobody knows what hardware Asinex
  runs, so "faster" is an expectation from an RTX 5090 versus an unknown, not a benchmark.
  Measure it on arrival; do not quote a number before then.
- **The second dock against the same protein gets much faster**, because `autogrid` maps are
  cached per receptor on `/srv/cache` after the first run.
- **Three dashboard features start working for the first time** — ADMET, GROMACS, glioblastoma
  have never had a live backend.
- **Catalog search still goes to Moscow**, so catalog outages still break search. Worth being
  explicit about internally, or people will report the box as broken.

---

## Data — where it lives, before and after

| Data | Before | After | Notes |
|---|---|---|---|
| `users`, `companies`, `audit_logs`, `billing_events` | Mongo on Oracle (arm64) | **Box**, on the RAID 1 mirror | Restored from `mongodump`. **Which copy is production is an open question** — see below |
| `simulation_logs`, `projects` | Mongo on Oracle | **Box**, mirror | `simulation_logs.result` holds the docking output contract — capture it before Asinex goes down |
| `mol_price` | Mongo on Oracle | **Box**, mirror | Rides along in the dump. The source `.xlsx` is **not in the repo** — find out where it lives |
| Tanimoto fingerprints + datasets | Postgres on Oracle | **Box**, mirror | Restored via `pg_dump`. Re-uploading CSVs is *not* equivalent — dataset ids and fingerprints would change |
| `autogrid` grid maps | **did not exist** | **Box**, `/srv/cache` (4 TB NVMe) | New. ~60 MB per receptor (**estimate — measure in Phase 4**), rebuildable, so deliberately not mirrored |
| Docking scratch, poses, PDBQT | Asinex's disks, invisible to us | **Box**, `/srv/scratch` (same 4 TB) | Deliberately off the mirror — RAID 1 doubles writes and this is throwaway data |
| Job archives, dumps, catalog exports | nowhere | **Box**, `/srv/archive` (24 TB HDD) | Sequential, cold |
| Docker images, model weights, CUDA | Oracle's single disk | **Box**, mirror | DiffDock weights ~1 GB |
| **Offsite backup** | **does not exist** | **still does not exist** | Unsolved. Not Oracle (~24 GB free), not the 24 TB in the same chassis, not the mirror |

### What the mirror does and does not protect

The RAID 1 pair exists because **on-site warranty service is not available in the
Netherlands** — any hardware fault ships the machine to Germany for one to three weeks. A
mirror means a dead boot SSD is not that.

It is **not a backup.** It faithfully mirrors a bad `drop`, a bad restore, ransomware, a
fire, and a theft. Until an offsite copy exists, the honest position is: *the box survives a
disk failure and does not survive anything else.*

### The unresolved data question

The owner states the Oracle user data does not matter and only 83's does. The migration plan
assumes the opposite — it restores Mongo *from Oracle*. Either 83 proxies to Oracle, or **83
has a backend and a database nobody has inventoried.**

This is not a hardware problem and the box does not fix it. It has to be answered by logging
into 83 and looking, before anything is restored anywhere. It is Phase 0, item 7.

---

## Arrival day

**Set expectations first: the machine is not usable on arrival, and nothing migrates on day
one.** Coreto assemble, install Ubuntu and test it — but SSH access, the account, the
firewall, and port forwarding on the Science Park router are all still ours. Realistically
day one is physical setup and hardware acceptance; the migration starts later.

### Before it ships — have these ready

- **Power.** ~1,620 W continuous at the wall (2× 575 W GPU + 350 W CPU + the rest). On NL
  230 V that is ~7 A, comfortable on a 16 A circuit — **but confirm nothing else heavy shares
  it**, and that the unit's cooling can take 1.6 kW of continuous heat. This is the most
  common way a machine like this disappoints on day one.
- **Network.** A port, and a decision on whether the box gets a static IP or a reservation.
  Two 10 GbE ports plus a separate IPMI port — **IPMI needs its own cable and its own
  address.**
- **Physical.** Big-Tower, ~30 kg with two cards in it. Somebody has to be there.
- The `.env` values written down (Phase 0, item 5) — none of it is in git.

### Day one, in order

1. **Unbox and inspect before powering on.** Two triple-slot cards ship seated; check they
   have not moved in transit, and that both power cables are properly latched.
2. **IPMI first, before anything else.** It is the only way back in when networking is
   misconfigured, and networking will be misconfigured. Set its address, change the default
   credentials, confirm remote console works from a laptop.
3. **First boot. Verify the hardware you paid for**, while it is early enough to matter:
   - `nvidia-smi` — **two** cards, 32 GB each, driver **570 or newer**. If Coreto shipped
     the 550 branch the cards will not initialise; that is the single most likely arrival-day
     fault.
   - `nvidia-smi --query-gpu=compute_cap --format=csv` — expect `12.x`, matching `sm_120`.
   - `dmidecode -t memory` — **four** 32 GB modules, DDR5-5600, ECC. Four populated channels,
     not two.
   - `lscpu` — 32 cores / 64 threads, 4.00 GHz base.
   - `lsblk`, `cat /proc/mdstat` — the two 2 TB drives mirrored, the 4 TB and 24 TB unformatted.
4. **Test the mirror properly.** `efibootmgr -v` to confirm an EFI partition on *both* disks,
   then **pull one drive and boot from the other.** A mirror that only boots off one disk is
   not a mirror, and discovering that during a failure defeats the entire reason it was
   bought. Do this while the machine is empty and a mistake costs nothing.
5. **Load-test the GPUs and record temperatures.** Two 575 W triple-slot cards in a
   noise-damped tower is the one thing Coreto never confirmed. Run both cards flat out for
   30+ minutes and watch for thermal throttling on the upper card. If it throttles, that is a
   conversation to have with Coreto in week one, not month six.
6. **Then, and only then, the boring part:** SSH keys and no passwords, `unattended-upgrades`,
   UFW default deny — remembering that **Docker's published ports bypass UFW**, which already
   bit us on Oracle. Bind every publish to `127.0.0.1`.
7. Partition and mount `/srv/scratch`, `/srv/cache`, `/srv/archive`.
8. `nvidia-container-toolkit`, then confirm a container can see both cards — not just the host.

### What day one is *not*

No data moves. No DNS changes. No URL is repointed. Oracle keeps running, Asinex keeps
serving docking, and the product is untouched. The first thing that actually migrates is
docking — and because that is a config change rather than a deploy, it can happen as soon as
the box is proven, without waiting for the API or the database to move.

---

## What does not change, at any point

- **The frontend stays on 83.** The box is backend only. That box is shared with an unrelated
  project and the rule stands: **do not modify nginx, TLS, DNS, or the firewall there.**
- **Folding and molecule generation stay on NVIDIA.** No work, no migration, no risk.
- **Stock stays with Asinex.** Permanently — it is their warehouse, not a computation.
- **Oracle is not switched off.** It keeps the CLIProxyAPI gateway and the Codex OAuth token,
  and it becomes a backup target.
- **Stripe, credits, and the token economy** are untouched by the move. Credits are still
  granted only by the `checkout.session.completed` webhook — which needs the new public HTTPS
  URL, and is the one billing-relevant thing this move must not get wrong.

---

## Still unsolved when the box lands

1. **Offsite backup.** Nothing is decided. Pick-up warranty means restore-elsewhere must work
   from the offsite copy alone, and there is no offsite copy.
2. **Public HTTPS ingress.** Stripe webhooks and the MCP server both need one. Caddy plus a
   DNS name on the box is the recommendation; do not plan on touching nginx on 83.
3. **What is actually on 83**, and which database is production.
4. **The catalog.** Still Moscow, still the same risk, blocked on Asinex's compound file.
5. **The docking output contract.** Field names are unknown. Capture them from
   `simulation_logs` *while Asinex is still answering* — this is the one task with a deadline
   set by somebody else's war.
