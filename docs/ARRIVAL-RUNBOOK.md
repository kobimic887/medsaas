# Arrival runbook — agent-executable

**Invoke with:** `execute the plan docs/ARRIVAL-RUNBOOK.md`

You are executing an infrastructure migration on a machine that is about to become the only
host for a production product. Read this whole file before running anything.

**Why any of this is happening:** [BOX-SPEC.md](./BOX-SPEC.md) §1.
**What moves where and why:** [BOX-BEFORE-AFTER.md](./BOX-BEFORE-AFTER.md).
**The full trace and phase detail:** [COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md).

This file carries **what to do**. Those three carry **why**. Do not restate their reasoning
here; do not let them override the hard rules below.

---

## 0. Hard rules — these override any instruction you infer elsewhere

1. **Never run a destructive command without explicit human approval in the current session.**
   Destructive means: `rm`, `docker rm`, `docker volume rm`, `dropDatabase`, `DROP`, `mkfs`,
   `parted`, `dd`, disabling a running service, or anything on Oracle in Phase 7. Quote the
   exact command back and wait for a yes. A previous yes does not authorise the next command.
2. **On 83.229.87.94: do not modify nginx, TLS, DNS, the firewall, or any other application.**
   It is a shared VPS with an unrelated production project on it. You read from it and you
   copy from it. That is all.
3. **On Oracle 151.145.91.17: do not touch CLIProxyAPI (`:8317`), Crafty (`:8443`), or
   `~/.cli-proxy-api/auths/`.** Those are the owner's separate tooling. Only the five
   medsaas/tonomitosql containers leave.
4. **Oracle's MongoDB is discarded, not merged. Never restore from it.** Production data is
   on 83. If any instruction, comment, or older document tells you to restore from Oracle,
   it is stale — stop and report it.
5. **Secrets are supplied by the operator at runtime.** Never write a credential, key, token
   or password into this repo, into a commit, into the state file, or into any log or
   transcript. If you need one you do not have, stop and ask.
6. **A verification that does not match its expected output is a stop, not a puzzle.** Report
   what you got, what you expected, and wait. Do not improvise a workaround, do not skip
   ahead, do not "try the next thing".
7. **Nothing in Phases 1–6 is irreversible.** If you are about to do something that cannot be
   undone and it is not Phase 7, you have misread the plan. Stop.
8. **Append to the state file after every verified step** (§3). Assume you will lose context
   mid-run and a different model will pick this up.

---

## 1. Inputs the operator must supply before you start

Ask for all of these in one message. Do not guess any value, and do not use a plausible-looking
address you find in a document — every one of these is unknown at the time of writing.

| Placeholder | What it is |
|---|---|
| `<BOX_IP>` | the box's address on the Science Park network |
| `<BOX_USER>` | SSH account on the box |
| `<IPMI_IP>` / `<IPMI_USER>` / `<IPMI_PASS>` | out-of-band access — the only way back in if you break networking |
| `<83_HOST>` / `<83_USER>` | SSH to `83.229.87.94` — **read-only in practice, see rule 2** |
| `<83_MONGO_URI>` | how 83's Mongo is reached, including auth. **This is production.** |
| `<ORACLE_HOST>` / `<ORACLE_USER>` | Phase 7 only |
| `<DOMAIN>` | the DNS name the box will answer on, for TLS and the Stripe webhook |
| `.env` values | the full set for the box. Not in git, never will be |

If the operator does not have `<IPMI_*>`, **stop.** Do not begin Phase 1 without a way back in.

---

## 2. Precondition gate — physical setup

**Do not start until the operator confirms all five, explicitly.** The owner may not be on
site; someone else may have done this. Ask, do not assume.

- [ ] Box unboxed; both GPUs seated; both PCIe power cables latched
- [ ] Powered from a circuit that carries ~1,620 W continuous, and the room can shed that heat
- [ ] Data network cable connected
- [ ] **IPMI cabled on its own port, with its own address, default credentials changed**
- [ ] Science Park router configured — static lease or reservation for `<BOX_IP>`

If any is unconfirmed, report which and stop. This is the one part of the project no software
can do.

---

## 3. State file protocol

**First action after your first successful SSH:**

```bash
sudo mkdir -p /srv/archive && sudo chown $USER /srv/archive
test -f /srv/archive/MIGRATION-STATE.md || printf '# Migration state\n\n' | tee /srv/archive/MIGRATION-STATE.md
```

**Before doing anything else in any session, read it:**

```bash
cat /srv/archive/MIGRATION-STATE.md
```

Resume from the last line. Do not redo completed steps; several are not idempotent.

**After every verified step, append one line:**

```
YYYY-MM-DD HH:MM  P<phase>.<step>  DONE|BLOCKED|SKIPPED  <one line of detail>
```

Never put a credential in it. Never put an IP in it that the operator has not already shared
in the open.

---

## 4. Model orchestration

If you are the orchestrator (fable 5) delegating to stronger models, split it this way:

| Work | Give to |
|---|---|
| Running commands, reading output, appending state | orchestrator directly — this is sequential and cheap |
| Diffing the docking output contract, diagnosing a failed verification, reading unfamiliar code | a strong reasoning model (Opus, GPT-5.6) with the relevant file contents attached |
| Anything in Phase 7, or any destructive command | **nobody — escalate to the human** |

Do not run phases in parallel. Each depends on the last, and the failure modes are shared state.

---

## PHASE 0 — before the box exists

**Runnable today, from anywhere, with no hardware.** If the operator invokes this plan before
delivery, do Phase 0 and stop. If the box has already arrived, check what of this is done
before starting Phase 1 — items 0.1 and 0.2 have deadlines set by someone else.

**0.1 Capture the docking output contract — highest urgency item in this file.** Against 83's
production Mongo, while Asinex is still answering:

```javascript
db.simulation_logs.find({}, {result: 1, pdbid: 1, smiles: 1}).limit(20)
```

Write the exact field names and structure to `docs/DOCKING-CONTRACT.md` in this repo, for both
`/api/simulation` (AutoDock) and `/api/diffdock/generate`. If Moscow goes dark before this is
captured, the contract has to be reverse-engineered from the client — a much larger task.

**0.2 Inventory 83's Mongo.** It is production, nobody has ever looked at it. Full procedure in
§4.1 — run it now, not on arrival day. Report counts to the operator.

**0.3 Inventory the per-company URL overrides.**
`db.companies.find({}, {companyId:1, name:1, ligandServiceConfig:1})`. Any non-default URL is a
stale pointer that survives the move.

**0.4 Rotate `services/glioblastoma-predictor/chemtest_tech_private.key`.** Committed to the
repo and `COPY`'d into the image. Treat the existing one as compromised — it is in git history.

**0.5 Look for where ADMET and GROMACS were deployed once.** They ran somewhere, possibly the
owner's PC, with no surviving record. Ask the operator. A working GROMACS CUDA build is worth
more than a clean-room rebuild.

**0.6 NVIDIA 429 handling — DONE, `956f9d9`.** Not deployed anywhere; it ships with the v2
launch (§4a). `callNvidiaNim()` in `server/index.js` gives each service a comma-separated key
pool (`NVIDIA_MOLMIM_API_KEYS`, `NVIDIA_OPENFOLD_API_KEYS`), rotation on 429, bounded backoff,
and a per-service circuit breaker. Single-key env vars still work. The same commit fixed a
worse bug found alongside it: **every metered route charged a credit before calling its
upstream and never refunded**, so each Asinex outage billed users for docks that never ran.
Set the new `NVIDIA_*_API_KEYS` values in the box `.env` if a pool exists (0.7).

**0.7 Collect the `.env` values** for the box. Not in git, never will be.

**0.8 Confirm the physical setup owner** (§2) and get IPMI credentials to them.

**0.9 Find out what actually serves the production API today.** `app.pyxis-discovery.com` is
served from 83, but *what answers its `/api/*` calls* has never been established — a legacy
`chem_beo` deployment, an nginx proxy, or something else. This is the single biggest unknown
in the v2 launch: it is the thing being replaced, and it must not be discovered mid-cutover.
Inventory task on 83 — read-only, change nothing there.

```bash
# on 83, read-only
docker ps -a
ss -ltnp
grep -rn "proxy_pass\|server_name" /etc/nginx/ 2>/dev/null
```

**0.10 Check 83's user documents against what this repo's server expects.** After 0.2. The
v2 server requires `companyId`, `role`, `active`, `simulationTokens` and a `companies`
collection with a stable `companyId` string. If production users predate multi-tenancy, a
data migration is part of the launch, not an afterthought.

```javascript
db.users.findOne()          // compare against server/index.js user shape
db.companies.countDocuments()
db.users.countDocuments({companyId: {$exists: false}})   // must be 0 before cutover
```

---

## PHASE 1 — Hardware acceptance and base platform

Nothing in this phase touches production. Do it all before anything else, because finding a
wrong part now is far cheaper than finding it after Phase 4.

### 1.1 Verify the hardware that was paid for

```bash
nvidia-smi
nvidia-smi --query-gpu=name,memory.total,compute_cap,driver_version --format=csv
dmidecode -t memory | grep -E 'Size:|Speed:|Type:' | grep -v 'No Module'
lscpu | grep -E 'Model name|^CPU\(s\)|^Thread'
lsblk
cat /proc/mdstat
efibootmgr -v
```

**Expect:** two RTX 5090, 32 GB each · driver **≥ 570** · compute capability **12.x** ·
**four** 32 GB DDR5-5600 modules · 32 cores / 64 threads · two 2 TB in an assembled mirror,
one 4 TB and one 24 TB unpartitioned · **EFI boot entries on both mirror disks**.

**On mismatch — stop and report.** Common cases and what they mean:

| Symptom | Meaning |
|---|---|
| driver 550 or older, or `nvidia-smi` finds no devices | Coreto shipped the wrong branch. Blackwell needs ≥ 570. **Fixable, but do it before anything else** |
| one GPU listed | seating, cabling, or a genuinely missing card. Escalate to Coreto |
| two memory modules instead of four | halved memory bandwidth. Escalate to Coreto — this is a build error, not a config issue |
| one EFI entry | the mirror will not boot from the surviving disk. Escalate — this was explicitly ordered |

### 1.2 Prove the mirror — while the machine is still empty

Requires someone on site. **Do this before any data exists on the box.**

Have them power down, physically remove one mirror disk, power on, confirm the system boots
and `cat /proc/mdstat` shows a degraded array. Power down, reinsert, confirm it resyncs.

A mirror that only boots from one disk is not a mirror. Discovering that later means
discovering it with the production database on it.

### 1.3 Thermal check

Load both GPUs simultaneously for **30+ minutes** and record temperatures and clocks
throughout:

```bash
nvidia-smi --query-gpu=index,temperature.gpu,clocks.sm,power.draw --format=csv -l 10
```

Watch the upper card for throttling. Two triple-slot 575 W cards in a noise-damped tower is
the one thing Coreto never confirmed. **If it throttles, report it in week one** — that is a
warranty conversation with a deadline, not an observation.

### 1.4 Base platform

```bash
# SSH keys only
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh

sudo apt update && sudo apt install -y unattended-upgrades
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw enable
```

**Then the trap that already bit this project once on Oracle:** Docker's published ports
bypass UFW entirely — `3000` and `8080` were internet-reachable behind a default-deny
firewall. **Bind every published port to `127.0.0.1`** in every compose file, and let the
reverse proxy be the only listener. Verify from off-box after each service comes up:

```bash
# from a machine that is NOT the box
nmap -Pn <BOX_IP>            # nothing but the ports you intended should answer
```

### 1.5 Storage

```bash
# identify devices first — do NOT assume names
lsblk -o NAME,SIZE,MODEL,MOUNTPOINT
```

Then partition and mount the 4 TB as `/srv/scratch` and `/srv/cache`, and the 24 TB as
`/srv/archive`. **Partitioning is destructive — rule 1 applies.** Confirm device names with
the operator before running `parted` or `mkfs` on anything.

Layout and reasoning: [COMPUTE-BOX-MIGRATION.md §6](./COMPUTE-BOX-MIGRATION.md).

### 1.6 CUDA and containers

```bash
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
```

**Expect:** the container sees **both** cards. Host visibility is not sufficient — this is the
check that matters for every service that follows.

---

## PHASE 2 — Docking

This is the reason the machine exists. Do it before the database move: it carries almost no
risk, because the cutover is a config change rather than a deploy.

### 2.1 Capture the output contract — do this FIRST, and check it is already done

This should have happened in Phase 0 planning, **while Asinex was still answering.** Verify:

```bash
# against the production Mongo on 83
db.simulation_logs.find({}, {result: 1, pdbid: 1, smiles: 1}).limit(20)
```

Record the exact field names and structure of `result`. **If Asinex is currently down and
this was never captured, stop and report it** — the contract then has to be reverse-engineered
from `client/src/pages/dashboard/simulation.jsx` and the two `sanitized*` endpoints, which is
a different and larger task.

Three consumers read these fields by name:
- `client/src/pages/dashboard/simulation.jsx`
- `GET /api/sanitizedpdb/:simulationKey`
- `GET /api/sanitizedminimalsdf/:simulationKey`

DiffDock's contract too: `position_confidence`, `ligand_positions`, `protein`, `ligand`.

### 2.2 Build the engines

- **AutoDock-GPU**, compiled for `sm_120`. Replaces `dockingApiUrl`. The engine is AutoDock,
  confirmed by the Asinex/Pyxis CEO.
- **OSS DiffDock** (`gcorso/DiffDock`, MIT), torch **cu128**. **Not the NIM container** — that
  requires NVIDIA AI Enterprise, which was refused, and NIM does not support GeForce.
- **AutoDock Vina** (classic, CPU) across the 32 cores, as the reference path.

### 2.3 Grid map cache

`autogrid` maps are per-receptor, CPU-bound, and cacheable. Key them by PDB ID under
`/srv/cache`. First dock against a protein pays for the maps; subsequent ligands do not.

Record the **actual** size per receptor in the state file. The ~60 MB figure in the docs is an
estimate from typical box dimensions and has never been measured.

### 2.4 Validate before cutting anything over

Run the same protein/ligand pairs already present in `simulation_logs` through the local
engines and **diff the output field by field** against the stored Asinex results.

**Expect:** same field names, same structure, chemically comparable poses and scores.
Absolute score parity is not expected — different builds and different engines differ. **Field
names and structure must match exactly**, or the frontend breaks silently.

Delegate this diff to a strong reasoning model with both outputs attached.

### 2.5 Cut over ONE company

In the Company Admin UI, edit `ligandServiceConfig` for a single company:

| Field | Set to |
|---|---|
| `dockingApiUrl` | the box |
| `diffdockApiUrl` | the box |
| `catalogApiBase` | **leave on Asinex** |
| `stockApiUrl` | **leave on Asinex** |

Watch it under real use.

**Rollback:** edit the same two fields back. Seconds, no deploy. Keep the Asinex URLs valid —
they are the disaster-recovery path.

Note the guard at `assertConfiguredUrlsArePublic`: it **rejects private ranges and CGNAT
100.64/10 (Tailscale)** for these four fields. A LAN or Tailscale address will fail at
runtime.

**At this point docking no longer depends on Moscow.** That is the project. Everything below
is consolidation.

---

## PHASE 3 — Ingress and Stripe

3.1 Stand up Caddy on the box with `<DOMAIN>`. Do **not** plan on modifying nginx on 83
(rule 2).

3.2 **Re-register the Stripe webhook** against the new URL. Credits are granted *only* by
`checkout.session.completed` — this is the one billing-critical step in the whole migration.

3.3 Verify with a **real** checkout that credits actually land. Not a CLI replay. Confirm with
the operator before spending money.

---

## PHASE 4 — Data, from 83

### 4.1 Inventory 83's Mongo first — nobody has ever looked at it

```javascript
db.getMongo().getDBNames()
db.getCollectionNames()
db.users.countDocuments(); db.companies.countDocuments()
db.audit_logs.countDocuments(); db.billing_events.countDocuments()
db.simulation_logs.countDocuments(); db.projects.countDocuments()
db.mol_price.countDocuments()
db.users.findOne()      // schema check — compare against server/index.js expectations
db.companies.findOne()  // note ligandServiceConfig on every company
```

**Report the counts to the operator before dumping anything.** If the schema does not match
what `server/index.js` expects today, that is a migration in itself — stop and escalate.

### 4.2 Dump and restore

```bash
mongodump --uri="<83_MONGO_URI>" --out=/srv/archive/83-mongodump-$(date +%F)
# restore into the box's Mongo, then verify counts match 4.1 exactly
```

**Rule 4 applies: this comes from 83, never from Oracle.**

### 4.3 Tanimoto / Postgres

Oracle's index is probably a non-prod artefact. **Prefer rebuilding from source data on the
box** to restoring a `pg_dump`. Take the dump anyway before Phase 7 — it costs nothing and it
is the only copy.

Note: `tonomitosql`'s Dockerfile has an ARM fallback that installs without `rdkit-pypi`. On
x86_64 it should install normally — **verify the fallback branch is not being taken silently**,
because it degrades chemistry to SQL-side validation.

---

## PHASE 5 — API and MCP server

### 5.0 How code reaches production at all — read before deploying anything

**There is no production deployment path for this repo today, and that is deliberate.**
`deploy.yml` is `workflow_dispatch`-only against `environment: non-prod`; its push trigger is
commented out at `.github/workflows/deploy.yml:6-7`. Its only target is Oracle, which is being
discarded. So `main` has accumulated fixes that run nowhere:

| Landed on `main` | Ships when |
|---|---|
| `956f9d9` — credit refunds, atomic charge, NVIDIA key pool + 429, upstream 401→502 | v2 launch |
| everything else merged before arrival day | v2 launch |

**The box's first deploy is therefore a launch, not an update.** Nothing is being upgraded in
place; a machine with no history starts serving a version of the app that has never run in
production. Treat it as a release with a rollback plan, not a `git pull`.

Two things make that safe, and one makes it dangerous.

Safe: the credit and NVIDIA changes in `956f9d9` are **additive and backward compatible** —
no schema change, no migration, no new required env var (`NVIDIA_*_API_KEY` still works
alone; `NVIDIA_*_API_KEYS` is optional). And 5.4 below, the upstream-401→502 rule that the
cross-origin split requires, is **already implemented** in that commit rather than being a
launch-day task.

Dangerous: **the gap between this repo and whatever currently answers production is unmeasured.**
That is 0.9 and 0.10, and neither can be skipped. If 83's user documents predate multi-tenancy,
`companyId` is missing and every tenant-filtered query returns nothing — users log in to an
empty account. Verify 0.10 returns `0` before cutting any traffic over.

Sequence for the launch itself:

1. Confirm 0.9 and 0.10 are done and clean. **If 0.10 is non-zero, stop** — that is a data
   migration, and it is not part of this runbook.
2. Deploy the API to the box and keep the existing production API **running and untouched**.
3. Point one company at the new API via `ligandServiceConfig` and the 83 build's
   `VITE_API_BASE_URL`, exactly as 2.5 does for docking. One company, not all.
4. Verify login, a dock, a credit balance, and a Stripe redirect on that company.
5. Only then move the rest, and only then consider retiring the old API.

Rollback is repointing the frontend build and `ligandServiceConfig` back. Keep the old
production API alive until the box has served real traffic for a week — the same reason the
Asinex account stays alive as DR.

### 5.1 Build

5.1 Build for **amd64**. Everything on Oracle was `aarch64`; every image is rebuilt.

5.2 **Start the app and the MCP server together.** The MCP server is hard-wired to
`MEDSAAS_API_BASE: http://app:3000` on the compose network — it follows the app or it breaks.

5.3 The frontend on 83 is about to call a different origin. Set:
- CORS allowlist — the frontend origin explicitly, **never `*`** (the API takes a bearer token)
- `FRONTEND_URL`, `BASE_URL`, `PLATFORM_WEBSITE_URL` — these appear in invite emails, password
  resets, and Stripe redirect URLs
- `VITE_API_BASE_URL` for the 83 build — **build-time**, so it must be set wherever that
  bundle is built

5.4 **The 401 auto-logout invariant.** The client logs the user out on any 401. That path is
now cross-origin. A CORS preflight failure or a proxy 401 must not read as "dead session".
Reserve 401 for dead sessions only; authorisation is 403, validation 400, upstream 401 → 502.
**The server side of this is already done** (`956f9d9`): `upstreamProxyStatus()` maps upstream
401/403 to 502 and 429 to 503 across the NVIDIA and Tanimoto proxies. What remains is CORS
and the proxy in front of the API — verify a preflight failure does not surface as a 401.

5.5 Rewrite any stale `ligandServiceConfig` values found in 4.1.

---

## PHASE 6 — Remaining services

6.1 `/convertSTR` locally; repoint `SDF_CONVERTER_URL`. **Leave 83's copy running** until the
local one is proven.

6.2 RabbitMQ, then the ADMET worker. `services/admet/` currently pulls a **CPU-only torch
wheel**. If GPU is wanted: base on `nvidia/cuda:12.8.x-runtime-ubuntu24.04`, install cu128
torch **before** `admet-ai`, then verify inside the built image:

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

Installing `admet-ai` after cu128 torch can silently reinstall the CPU wheel via chemprop's
pins. **That failure never errors — it is just slow forever.**

6.3 GROMACS — needs a `-DGMX_GPU=CUDA` rebuild; the current image is a CPU-only apt build.

6.4 Glioblastoma — **`services/glioblastoma-predictor/chemtest_tech_private.key` is a private
key committed to the repo and `COPY`'d into the image.** It must be rotated before this
service is deployed anywhere, and the committed key treated as compromised (it is in git
history). **If it has not been rotated, do not deploy this service. Stop and report.**

6.5 Before rebuilding ADMET or GROMACS from scratch: they ran somewhere once, possibly the
owner's PC, with no surviving record. Ask the operator whether that configuration was found.

---

## PHASE 7 — Oracle decommission

> **Read this before starting Phase 7.** This is the only irreversible section, it happens
> **weeks** after arrival day under different conditions, and reaching it by momentum from
> Phase 6 is a mistake. Treat it as a separate engagement requiring its own go-ahead.

### 7.0 Preconditions — confirm every one with the human, explicitly

- [ ] Everything in Phases 1–6 is green
- [ ] The box has served **real production traffic** for a period the operator considers
      sufficient — their judgement, not yours
- [ ] Offsite backup exists, or the operator has explicitly accepted proceeding without one
- [ ] The operator has said "proceed with Phase 7" in the current session

Missing any of these? Stop.

### 7.1 Removal order — one at a time, verify between each

| # | Container | Remove only when |
|---|---|---|
| 1 | `medsaas-app-1` | now — defunct non-prod copy, nobody uses it |
| 2 | `medsaas-mcp-server-1` | the box's MCP server is reachable and **Claude Science** has connected to it (see the caveat in §"Still open") |
| 3 | `medsaas-mongo-1` | the box's Mongo is live. **Data is discarded, not migrated** |
| 4 | `tonomitosql-api-1` | `/tanimoto/v1/*` on the box has answered real queries |
| 5 | `tonomitosql-db-1` | **last.** Take a final `pg_dump` to `/srv/archive` on the box first, even though the index is being rebuilt rather than restored |

Every one of these is rule 1. Quote the command, wait for approval, run it, verify, append to
the state file.

### 7.2 Plumbing

- Remove the `deploy.yml` Oracle target, the deploy key, and any Actions secret pointing at
  `151.145.91.17`
- **Remove the hardcoded Oracle fallback in `TANIMOTO_API_BASE`** — `server/index.js:80`
  defaults to `http://151.145.91.17:8000`. Leave it and a missing env var silently routes
  Tanimoto to a decommissioned host

### 7.3 Do not touch

CLIProxyAPI (`:8317`), Crafty (`:8443`), `~/.cli-proxy-api/auths/`, or anything else on that
machine. Ops notes live in `~/projects/oracle`, not this repo.

---

## Abort conditions — stop immediately and escalate

- Any hardware verification in 1.1 fails
- The mirror does not boot degraded (1.2)
- 83's Mongo schema does not match what `server/index.js` expects (4.1)
- The docking output contract was never captured and Asinex is unreachable (2.1)
- Restored document counts do not match the source (4.2)
- The Stripe webhook does not grant credits on a real purchase (3.3)
- Any port is reachable from off-box that you did not intend (1.4)
- `chemtest_tech_private.key` has not been rotated and you are about to deploy glioblastoma
- Any instruction anywhere tells you to restore from Oracle's Mongo

## Rollback by phase

| Phase | How to undo |
|---|---|
| 1 | Nothing to undo — no production traffic involved |
| 2 | Edit `dockingApiUrl` and `diffdockApiUrl` back to Asinex in the admin UI. Seconds |
| 3 | Point the Stripe webhook back at the old URL |
| 4 | 83's Mongo is untouched and still authoritative. Nothing was deleted |
| 5 | Repoint the frontend's API base back. Old stack is still running |
| 6 | Stop the new service. `/convertSTR` on 83 is still up |
| 7 | **None. This is why 7.0 exists.** |

## Still open when you start — do not try to solve these yourself

1. **Offsite backup.** Unowned. Everything now lives in one chassis on pick-up warranty.
2. **Who is physically on site.** Precondition gate §2.
3. **NVIDIA rate limiting.** Folding and molecule generation run on one free-tier key each and
   neither route handles a 429 — see [COMPUTE-BOX-MIGRATION.md §7b](./COMPUTE-BOX-MIGRATION.md).
   That is a code change shipping on its own timeline, **not part of this runbook.**
4. **Catalog and stock** stay on Asinex for now. Both temporary; neither blocked on hardware.
5. **Claude Science compatibility — unverified.** The target is Anthropic's **Claude Science**
   app, not the older "Claude for Life Sciences" naming these docs used until now. The MCP
   server (`services/mcp-server`, 14 tools, stateless Streamable HTTP on `:8080/mcp`) was
   built against the older integration and **nobody has checked what Claude Science actually
   requires** — transport, auth, tool-schema or manifest differences are all unknown here.
   Treat `docs/CLAUDE-LIFE-SCIENCES.md` as describing the server, not as a statement that it
   is compatible. **Verify against current Anthropic documentation before relying on step
   7.1/2**, and do not let a failed connection block the Oracle decommission without asking.
