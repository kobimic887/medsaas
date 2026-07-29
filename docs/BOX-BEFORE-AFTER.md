# The box: before, after, and arrival day

Companion to [BOX-SPEC.md](./BOX-SPEC.md) (what was bought and why) and
[COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md) (the phased sequence). This document
answers three plainer questions: **what runs where today, what runs where afterwards, and
what actually happens on the day the machine turns up.**

**Status:** planning. Nothing here has been applied.

> ## ⚠ Parts of this document are known wrong
>
> Production was inventoried on 2026-07-28 —
> [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) is authoritative where the two
> disagree. The reasoning below still holds; several **facts** do not:
>
> | This document says | Actually |
> |---|---|
> | "★ MongoDB — THE production database" on 83 | **MongoDB Atlas.** No Mongo on 83 at all. Recommendation is now to *keep* Atlas and move only compute |
> | 83 serves a "static frontend", an older bundle of this repo's `client/` | A **Vite dev server** on `:5173`, from `/root/material-tailwind-dashboard-react` — the Creative Tim template. A different lineage, not an older version. There is no bundle |
> | "the API that actually answers" sits behind nginx | `/root/chem_beo` on `:3000`, terminating **its own TLS** and bypassing nginx entirely |
> | Oracle is "NOT PRODUCTION… loses all connection to this project" | **Its Postgres serves live Tanimoto queries.** Removing it breaks the Deep Similarity page. Its *Mongo* is still a discardable side-project copy |
> | GROMACS: "no live deployment" | **Deployed on 83**, Docker, `:8000`, healthy for weeks |
> | `/convertSTR` on `83:8001` | **Down.** So `/api/diffdock/generate` is already broken in production |
> | ADMET/RabbitMQ: "no live deployment" | The **broker exists** — CloudAMQP, configured in `chem_beo/.env`. The worker does not |
>
> The "After" picture and the calculation table below are unchanged in intent. Read them as the
> destination, not as a description of the starting point.
>
> **Added 2026-07-29 — the "arrival day" narrative here is now too big.** Wherever this document
> describes arrival day as moving the backend, migrating the database, or swapping the frontend:
> it does not. **Arrival day repoints three environment variables in `chem_beo` and nothing
> else.** The API server, the frontend, the database, nginx and Stripe are all untouched.
> [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §2. The *destination* this document describes is
> still the destination — it is reached in two releases, not one.

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
      │ 83.229.87.94 — shared VPS (nginx + TLS)  ★ PROD  │
      │   static frontend                                │
      │   the API that actually answers                  │
      │   ★ MongoDB — THE production database.           │
      │     The users are here. Never inventoried.       │
      │   /convertSTR :8001  (SMILES → SDF)              │
      │   ⚠ shared with an unrelated project — hands off │
      └──────────────────────────────────────────────────┘

      ┌──────────────────────────────────────────────────┐
      │ ORACLE VPS 151.145.91.17 — NOT PRODUCTION        │
      │   a side project. deploy.yml is literally        │
      │   "Build & Deploy (non-prod)". Its Mongo, its    │
      │   app and its data do not matter and are not     │
      │   migrated. This machine leaves the project.     │
      └──────────────────────────────────────────────────┘
                     │
      ┌──────────────┴──────────────┐   ┌────────────────────────────┐
      │ ASINEX — MOSCOW             │   │ NVIDIA — health.api.nvidia │
      │   :8000  AutoDock docking   │   │   OpenFold3 folding        │
      │   :58000 DiffDock (NIM)     │   │   MolMIM generation        │
      │   :58181 catalog + search   │   │   ⚠ ONE free-tier key each │
      │   :5443  stock + pricing    │   │     — 429s under real use  │
      │   ⚠ goes down — the war     │   └────────────────────────────┘
      └─────────────────────────────┘

  NO LIVE DEPLOYMENT: RabbitMQ · ADMET · GROMACS · glioblastoma
  (ADMET and GROMACS did run somewhere once — possibly the owner's PC —
   but no record of that deployment survives. Look for it before rebuilding.)
```

**Nothing in this repo performs a dock.** Both docking endpoints are thin proxies to Moscow.

**Oracle is not part of this.** It was a side project that happened to run a full copy of the
stack. Its database is not production, its data is not migrated, and it loses all connection
to this project. Anything in an older document that restores from Oracle is wrong.

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
      │ ASINEX — MOSCOW, REDUCED    │   │ NVIDIA — key pool + backoff│
      │   :58181 catalog + search   │   │   OpenFold3 · MolMIM       │
      │   :5443  stock + pricing    │   │   local MolMIM replacement │
      │   (both temporary — to be   │   │   as the 429 failover      │
      │    moved later)             │   └────────────────────────────┘
      │   (docking URLs kept valid  │
      │    as the rollback path)    │   ┌────────────────────────────┐
      └─────────────────────────────┘   │ ORACLE — GONE from this    │
                                        │ project. Not a backup      │
                                        │ target, not a fallback.    │
                                        └────────────────────────────┘
```

**Everything runs on one chassis.** With Oracle out and 83 reduced to a static frontend, the
box is the only machine running anything. The mirror and the second GPU cover component
failure; **nothing covers the chassis.** That makes the offsite backup question — still
unanswered, and no longer able to be answered with "Oracle" — the largest open risk in the
plan.

---

## Calculations — what moves and what does not

| Calculation | Route | Before | After |
|---|---|---|---|
| **1-click docking** | `POST /api/simulation` | Asinex `:8000` — **Moscow**, AutoDock | **Box** — AutoDock-GPU, `sm_120`, on an RTX 5090 |
| **DiffDock** | `POST /api/diffdock/generate` | Asinex `:58000` — **Moscow**, NVIDIA NIM container on their GPU | **Box** — OSS DiffDock, torch cu128 |
| Classic CPU Vina | *does not exist yet* | — | **Box** — 32 cores, as the reference/second-opinion path |
| Protein folding | `POST /api/openfold3/predict` | NVIDIA hosted — **one free-tier key, no 429 handling** | NVIDIA hosted, **key pool + backoff**. Local Boltz-2 only if paid access is refused |
| Molecule generation | `POST /api/generate-molecules` | NVIDIA MolMIM hosted — **one free-tier key, no 429 handling** | NVIDIA first, **local generator on the box as the 429 failover** |
| Tanimoto / substructure / similarity | `/tanimoto/v1/*` | Oracle — 2 shared vCPU, arm64, RDKit degraded to a SQL fallback | **Box** — 32 cores, x86_64, native `rdkit-pypi`, index in page cache |
| Catalog + structure search | `/api/asinex/*`, `/api4/*` | Asinex `:58181` — **Moscow** | **Asinex for now.** Needs their compound file — a licence, not hardware. Same Moscow risk remains |
| Stock and availability | `POST /api/shop` | Asinex `:5443` | **Asinex for now — and this is temporary.** It cannot be *computed* here, but it is to be moved by other means later. Buyer has accepted the interim |
| SMILES → SDF | inside `/api/diffdock/generate` | `83.229.87.94:8001` | **Box** — 83's copy left running until the local one is proven |
| ADMET prediction | RabbitMQ queue | **no live deployment** | **Box** — first supported deployment |
| GROMACS MD | `/api/gromacs/*` | **no live deployment** | **Box** — first supported deployment, after a `-DGMX_GPU=CUDA` rebuild |
| Glioblastoma | `/api/glioblastoma/*` | **never deployed** | **Box** — first time |

**On "no live deployment":** ADMET and GROMACS *did* run somewhere at some point, possibly on
the owner's PC, but no record of that deployment survives — no compose file, no host, no logs.
**Look for it before rebuilding from scratch**; a working configuration is worth more than a
clean-room rebuild, particularly for the GROMACS CUDA build.

### What a Pyxis user actually notices

- **Docking stops failing when Moscow is unavailable.** This is the entire point.
- **Docking gets faster**, though by an unmeasured amount — nobody knows what hardware Asinex
  runs, so "faster" is an expectation from an RTX 5090 versus an unknown, not a benchmark.
  Measure it on arrival; do not quote a number before then.
- **The second dock against the same protein gets much faster**, because `autogrid` maps are
  cached per receptor on `/srv/cache` after the first run.
- **Three dashboard features get a supported backend** — ADMET, GROMACS and glioblastoma have
  no live deployment today.
- **Catalog search still goes to Moscow**, so catalog outages still break search. Worth being
  explicit about internally, or people will report the box as broken.

---

## Data — where it lives, before and after

| Data | Before | After | Notes |
|---|---|---|---|
| **`users`** and the rest of the real database | **Mongo on 83** — this is production | **Box**, on the RAID 1 mirror | The users are on 83 and move from there. **83's Mongo has never been inventoried** — collections, size, auth, how it is reached. That is the first Phase 0 task |
| Anything in Oracle's Mongo | Oracle | **discarded** | Side project, not production. Not migrated, not merged, not kept |
| `simulation_logs.result` | wherever the production API writes it | **Box**, mirror | Holds the docking output contract — capture it before Asinex goes down |
| `mol_price` | Mongo | **Box**, mirror | Rides along in the dump. The source `.xlsx` is **not in the repo** — find out where it lives |
| Tanimoto fingerprints + datasets | Postgres on Oracle | **Box**, mirror — or rebuilt | Oracle is a side project, so this may be a non-prod index. If it is, **rebuild from the source data on the box** rather than restoring it. Check before dumping |
| `autogrid` grid maps | **did not exist** | **Box**, `/srv/cache` (4 TB NVMe) | New. ~60 MB per receptor (**estimate — measure in Phase 4**), rebuildable, so deliberately not mirrored |
| Docking scratch, poses, PDBQT | Asinex's disks, invisible to us | **Box**, `/srv/scratch` (same 4 TB) | Deliberately off the mirror — RAID 1 doubles writes and this is throwaway data |
| Job archives, dumps, catalog exports | nowhere | **Box**, `/srv/archive` (24 TB HDD) | Sequential, cold |
| Docker images, model weights, CUDA | — | **Box**, mirror | DiffDock weights ~1 GB |
| **Offsite backup** | **does not exist** | **still does not exist** | Unsolved, and **now unowned** — Oracle was the placeholder answer and Oracle is leaving |

### Answered: 83's Mongo is production

This was the question marked "blocks Phase 0" in every earlier version of these documents.
**It is closed.** 83 has its own MongoDB, that is the real database, and the users are in it.
Oracle's Mongo belongs to a side project that was never production — its data is discarded,
not merged.

Two consequences:

- **Every `mongodump`/restore step that pointed at Oracle is wrong** and has been repointed.
- **83's Mongo has never been looked at.** Collections, document counts, auth, how it is
  reached, whether the schema matches what `server/index.js` expects today. That inventory is
  now the first thing in Phase 0, and it is a task on 83 — not a code question.

### What the mirror does and does not protect

The RAID 1 pair exists because **on-site warranty service is not available in the
Netherlands** — any hardware fault ships the machine to Germany for one to three weeks. A
mirror means a dead boot SSD is not that.

It is **not a backup.** It faithfully mirrors a bad `drop`, a bad restore, ransomware, a
fire, and a theft. With Oracle gone, **every service and every database in this project lives
in one chassis**, and the honest position is: *the box survives a disk failure and does not
survive anything else.* Solving the offsite copy is now the largest open risk in the plan.

---

## Getting to a shell — the part with no owner

**This is the actual gate on everything below, and nobody is assigned to it.** The owner will
not be in Amsterdam. Before any of the software below can start, somebody physically present
has to:

1. Unbox a ~30 kg Big-Tower and check the two triple-slot cards have not shifted in transit,
   and that both PCIe power cables are latched.
2. Plug it into a circuit that can carry **~1,620 W continuous** (2× 575 W GPU + 350 W CPU +
   the rest — about 7 A at 230 V, fine on a 16 A circuit, **but confirm nothing heavy shares
   it**, and that the room can shed 1.6 kW of continuous heat).
3. Cable **two** network connections: a data port, and **IPMI on its own port with its own
   address.**
4. Set the IPMI address and change its default credentials — **do this before anything else.**
   IPMI is the only way back in when the network configuration is wrong, and it will be wrong
   at least once.
5. Configure the Science Park router: a static lease or reservation for the box, and whatever
   forwarding the ingress decision requires.

**Assign a name to this.** It is a couple of hours of work by someone on site, it needs
nothing but hands and the IPMI credentials, and until it happens the box is a heavy box.
Once IPMI is up, everything below can be done from anywhere.

---

## Then: SSH is in. What now?

Roughly in this order. Nothing here touches production until step 12.

### Prove the hardware before trusting it — one hour, do not skip

Run these on the first login. It is far cheaper to find a wrong part now than after the
migration is half done, and the warranty is pick-up.

```bash
nvidia-smi                                              # two cards, 32 GB each, driver >= 570
nvidia-smi --query-gpu=compute_cap --format=csv         # 12.x, matching sm_120
dmidecode -t memory | grep -E 'Size|Speed|Type:'        # FOUR 32 GB DDR5-5600 ECC modules
lscpu | grep -E 'Model name|^CPU\(s\)'                  # 32C / 64T
lsblk && cat /proc/mdstat                               # mirror assembled, 4 TB + 24 TB raw
efibootmgr -v                                           # EFI entries on BOTH mirror disks
```

**Driver branch is the likeliest fault.** If Coreto shipped the 550 branch the cards will not
initialise on Blackwell — replace it before doing anything else.

Then two tests that need doing while the machine is empty:

- **Pull one mirror disk and boot from the other.** A mirror that only boots off one disk is
  not a mirror. Doing this later means doing it with the production database on it.
- **Load both GPUs flat out for 30+ minutes** and watch the upper card for thermal
  throttling. Two triple-slot 575 W cards in a noise-damped tower is the one thing Coreto
  never confirmed. If it throttles, raise it in week one, not month six.

### Base platform

6. SSH keys only, passwords off. `unattended-upgrades`. UFW default deny.
7. **Remember Docker's published ports bypass UFW** — this already bit us on Oracle, where
   `3000` and `8080` were internet-reachable behind a default-deny firewall. Bind every
   publish to `127.0.0.1` and let the reverse proxy be the only listener.
8. Partition and mount `/srv/scratch`, `/srv/cache`, `/srv/archive`.
9. `nvidia-container-toolkit`, then confirm a **container** sees both cards — not just the host.

### First real workload: docking

Do docking before the database move, not after. It is the reason the machine exists, and
because the cutover is a config change rather than a deploy it carries almost no risk.

10. Build **AutoDock-GPU** for `sm_120` and **OSS DiffDock** on torch cu128. Stand up the
    `autogrid` map cache on `/srv/cache`.
11. **Validate against the captured contract** — [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md),
    captured 2026-07-28 while Asinex still answered. Field names and structure must match
    exactly; three consumers read them by name. Scores need not match — different engines and
    builds differ. **The receptor PDB is not byte-stable**, so the test cannot be a diff.
12. **Cut over.** ⚠ Corrected 2026-07-29: **not** `ligandServiceConfig`, and not per company —
    production runs `chem_beo`, which has no such field. Set `DOCKING_API_URL`, then
    `DIFFDOCK_API_URL`, then `TANIMOTO_API_BASE` in its `.env`, **one at a time with a restart
    and a check between each**. Catalog and stock stay on Asinex. Roll back by unsetting.
    The env vars exist only because of [`deploy/chem_beo/`](../deploy/chem_beo/) — apply that
    patch first or there is no cutover at all.

At this point docking no longer depends on Moscow — which is the whole project — and nothing
else has moved. **Arrival day ends here.** Steps 13–15 below are a later, separate release.

### Then the rest, in dependency order

13. Ingress (Caddy plus a DNS name), then **re-register the Stripe webhook** against the new
    URL and verify a real `checkout.session.completed` actually grants credits. Credits are
    granted *only* by that webhook.
14. Mongo on the box, restored **from 83** — not from Oracle. Postgres and the Tanimoto
    index.
15. The Express API and the MCP server together — the MCP server is hard-wired to
    `MEDSAAS_API_BASE: http://app:3000` on the compose network, so it follows the app or it
    breaks.
16. Rebuild `/convertSTR` locally, repoint `SDF_CONVERTER_URL`, **leave 83's copy running**
    until the local one is proven.
17. CORS, `FRONTEND_URL`/`BASE_URL`, and `VITE_API_BASE_URL` for the 83 build — the dashboard
    is about to start calling a different origin. Mind the 401 auto-logout invariant: a CORS
    preflight failure must not read as "dead session".
18. First-time deployments: RabbitMQ, ADMET, GROMACS (CUDA rebuild), glioblastoma. **Rotate
    `chemtest_tech_private.key` before the glioblastoma image goes anywhere** — it is
    committed to the repo and baked into the image.
19. **Decommission this project off Oracle — last, and only once the box is proven.**

### Oracle cleanup — after the migration, not before

Oracle keeps running as the owner's own machine. What leaves is **this project**. Five
containers, removed in this order, and **not one of them before its replacement has been
serving real traffic for a while**:

| Order | Container | Remove when |
|---|---|---|
| 1 | `medsaas-app-1` | Immediately — it is a defunct non-prod copy nobody uses |
| 2 | `medsaas-mcp-server-1` | Once the box's MCP server is reachable and Claude Science has connected to it |
| 3 | `medsaas-mongo-1` | Once the box's Mongo is live. Its data is **not** migrated — it is a side-project database |
| 4 | `tonomitosql-api-1` | Once `/tanimoto/v1/*` on the box has answered real queries |
| 5 | `tonomitosql-db-1` | **Last.** Take a final `pg_dump` to `/srv/archive` on the box before removing it, even though the index is being rebuilt rather than restored — it costs nothing and it is the only copy |

Then: remove the `deploy.yml` target, the deploy key, and any GitHub Actions secret pointing
at `151.145.91.17`, and drop `TANIMOTO_API_BASE`'s Oracle default from `server/index.js:80`
(it currently hardcodes `http://151.145.91.17:8000` as the fallback — leave that in and a
missing env var silently sends Tanimoto traffic back to a decommissioned host).

**Do not touch** CLIProxyAPI, the Codex OAuth token, Crafty, or anything else on that box.
Those are the owner's separate tooling and are not part of this project. Ops notes for the
machine live in `~/projects/oracle`, not here.

**Sequencing rule:** rebuild on the box, verify against real traffic, *then* remove from
Oracle. Nothing is deleted to make room for something — the box has 24 TB.

### What none of this does on day one

No data moves. No DNS changes. No user notices anything. Asinex keeps serving docking until
step 12, and 83 keeps serving the frontend and the database until step 14.

---

## The NVIDIA rate limit — the other single point of failure

Folding and molecule generation are on **one free-tier key each**
(`NVIDIA_OPENFOLD_API_KEY`, `NVIDIA_MOLMIM_API_KEY`), and the free tier runs out fast under
real use. Worse, **neither route handles a 429 at all**: `server/index.js:287` and `:333`
both do `error.response?.status || 500`, so NVIDIA's rate-limit response is relayed straight
to the user with no retry, no backoff, and no queue. One burst of activity and two dashboard
features simply stop working.

Three things, in order of value:

**1. Handle the 429 — do this regardless of everything else.** It is the cheapest fix
available and it helps under every scenario. Both keys are already separate env vars, so
widen each to a comma-separated pool, pick the least-recently-429'd key, back off
exponentially, and open a circuit breaker to the failover when the whole pool is cooling
down. Sixty lines or so, and it converts a hard failure into a wait.

**2. Find out what paid access costs. Nobody has asked.** The free credits are a trial, not a
product — if folding matters to Pyxis users, paying for it is the honest answer, and it has
never been priced. Note that NVIDIA AI Enterprise (refused earlier on cost) is the licence for
**self-hosting** NIM containers, which is not obviously the same product as hosted API access.
Ask before assuming the answer.

**Do not create extra accounts to get more free keys.** It is against build.nvidia.com's terms
and the failure mode is every key revoked at once, at whatever moment you are most exposed.

**3. Self-host as failover — but only the cheap half.**

| Feature | Self-host? | Why |
|---|---|---|
| **Molecule generation** (MolMIM) | **Yes — do this** | Small model, no MSA, fits one 5090 comfortably. A local generator (REINVENT4 or similar) behind the circuit breaker turns a 429 into "slightly different results" instead of an error |
| **Protein folding** (OpenFold3) | **Not yet** | Needs an MSA, which is the single largest engineering item on the whole project — the ~900 GB ColabFold database build that was deliberately cut from this box's scope |

If folding ever does come in-house, scope it as **Boltz-2 with a remote MSA server**, not
OpenFold3 with local databases — that is the difference between days and weeks. Two honest
caveats: it swaps the NVIDIA dependency for the ColabFold MSA server (also free, also
rate-limited, also somebody else's academic infrastructure), and **32 GB of VRAM sits right
at OpenFold3's working-set floor**, which is itself an argument for Boltz-2 over OpenFold3
locally. Verify the remote-MSA capability before writing it into a plan.

The framing that makes this easy: the old comparison was *"NVIDIA is faster than we can be."*
Still true. The new comparison is *"NVIDIA returns 429 and the feature is dead."* A slow local
fold beats a hard failure — but only where standing it up is cheap, which is generation and
not folding.

---

## What does not change, at any point

- **The frontend stays on 83.** The box is backend only. That box is shared with an unrelated
  project and the rule stands: **do not modify nginx, TLS, DNS, or the firewall there.**
- **Folding stays on NVIDIA** unless they price paid access out of reach.
- **Stripe, credits, and the token economy** are untouched by the move. Credits are still
  granted only by the `checkout.session.completed` webhook — which needs the new public HTTPS
  URL, and is the one billing-relevant thing this move must not get wrong.

## What changes that these documents used to say otherwise about

- **Oracle leaves entirely.** Earlier versions kept it as a reduced host and a backup target.
  It was a side project, never production. It loses all connection to this project, its data
  is not migrated, and the defunct medsaas app on it gets removed. Whatever else the owner
  runs there is their own concern.
- **83's Mongo is production.** Earlier versions restored from Oracle. Wrong.
- **Stock is temporary, not permanent.** It cannot be *computed* on the box — that part stands
  — but it is to be moved off Asinex later by other means. The buyer has accepted the interim.

---

## Still unsolved when the box lands

1. **Who physically sets it up.** No owner assigned. Blocks literally everything else.
2. **Offsite backup.** Nothing decided, and **no longer answerable with "Oracle"**. Every
   service and database in the project now lives in one chassis with pick-up warranty.
3. **Public HTTPS ingress.** Stripe webhooks and the MCP server both need one. Caddy plus a
   DNS name on the box is the recommendation; do not plan on touching nginx on 83.
4. **What is in 83's Mongo.** Now known to be production; still never inventoried.
5. **NVIDIA paid access pricing** — unasked, and it decides whether local folding is ever a
   project.
6. **The catalog and stock.** Both still Moscow, both to be moved eventually, neither blocked
   on hardware.
7. **The docking output contract.** Field names are unknown. Capture them from
   `simulation_logs` *while Asinex is still answering* — this is the one task with a deadline
   set by somebody else's war.
