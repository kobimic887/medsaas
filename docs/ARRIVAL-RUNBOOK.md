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

## What arrival day is — read this before the phase list

**Revised 2026-07-29.** Earlier drafts of this runbook planned to replace the API server, move
the database, and swap the frontend bundle, all on arrival day. **That is no longer the plan**
and those steps are marked dead where they appear. Decision:
[BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §2.

Arrival day moves **compute only**:

| | Arrival day |
|---|---|
| API server | `chem_beo` on 83, patched — **unchanged, not replaced** |
| Frontend | the existing bundle on 83 — **not rebuilt, not swapped** |
| Database | MongoDB Atlas — **not touched, not dumped, not migrated** |
| nginx / TLS / DNS / Stripe | **not touched** |
| Docking, DiffDock, Tanimoto | **repointed at the box, one environment variable at a time** |

**Run: Phase 1 → 2 → 3 → 6 → 7.** Phase 4 and Phase 5 are **dead for arrival day** and say so
at their heads. Phase 2 is the migration; the rest is consolidation.

**The prerequisite is `deploy/chem_beo/01-fixes-and-config.patch`**, applied and deployed
*before* the box arrives. Without it every address in production is a hardcoded string literal
and there is no cutover and no rollback — only source edits on a live server. Verify with
Phase 2.5's `grep` before you plan anything.

**Rollback for the entire day is: unset the variable, restart `chem_beo`.** No deploy, no data
loss, no user session broken. Nothing in Phases 1–3 or 6 is irreversible.

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
address you find in a document.

**Updated 2026-07-28 against the real production inventory** — the previous list asked for a
Mongo on 83 that does not exist and deferred Oracle to Phase 7, which is too late.
[PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) is the source for why each of these
is needed.

| Placeholder | What it is | Needed by |
|---|---|---|
| `<BOX_IP>` | the box's address on the Science Park network | Phase 1 |
| `<BOX_USER>` | SSH account on the box | Phase 1 |
| `<IPMI_IP>` / `<IPMI_USER>` / `<IPMI_PASS>` | out-of-band access — the only way back in if you break networking | Phase 1 |
| `<83_HOST>` / `<83_USER>` | SSH to `83.229.87.94` — **read-only in practice, see rule 2** | Phase 0 |
| `<ATLAS_URI>` | the production database connection string. **It is MongoDB Atlas, not on 83** — the old `<83_MONGO_URI>` placeholder was wrong. Database name is `test` | Phase 0 |
| **Atlas allowlist access** | an account that can add the box's IP to the Atlas network allowlist. **Nothing on the box can reach the database until this is done** ([[atlas-tls-rejection]]) | Phase 4 |
| `<ORACLE_HOST>` / `<ORACLE_USER>` | ⚠ **not Phase 7 only.** Oracle's Postgres serves production Tanimoto and holds the only copy of a 2,951,975-molecule index. Needed in **Phase 4** to take the `pg_dump` | Phase 4 |
| `<DOMAIN>` | the DNS name the box will answer on, for TLS and the Stripe webhook | Phase 3 |
| Stripe dashboard access | to **register** the webhook. There is no webhook registered today — this is a first-time setup, not a repoint | Phase 3 |
| `.env` values | the full set for the box. Not in git, never will be | Phase 5 |

If the operator does not have `<IPMI_*>`, **stop.** Do not begin Phase 1 without a way back in.

**Two things to tell the operator in the same message, because they need action independent of
this plan:** there is a live GitHub token in `/root/chem_beo/.git/config` that should be revoked,
and an unauthenticated `DELETE` route that can destroy the Tanimoto index. Both are
[PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) §8.

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

> ## 🛑 STOP — read [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) first
>
> Production was inventoried on 2026-07-28 and it is **not** what the rest of this runbook
> assumed. Items 0.1, 0.2, 0.9, 0.9b and 0.10 are **done** — their findings are in that file,
> and three of them invalidate steps written below:
>
> - **Mongo is Atlas, not on 83.** ✅ **Settled: Atlas stays and only compute moves.** Phase 4
>   is dead. There is no dump, no restore, and no write-freeze window. The box's IP must be
>   added to the Atlas allowlist before it can serve anything.
> - **The frontend is a Vite dev server**, proxied by nginx, with no build and no bundle. So
>   §5.0's symlink swap has no "old bundle" to preserve, and serving a static build **requires
>   an nginx change on 83** — the one thing the standing rule forbids without the owner.
>   ✅ **Not a critical path any more**: arrival day does not touch the frontend at all. It
>   becomes a blocker only for the Phase 5 release, which has no deadline. Still raise it.
> - **0.10 FAILS: 49 of 50 users have no `companyId`**, and 47 have no `simulationTokens`.
>   ⚠ **This gates the Phase 5 release, not arrival day** — `chem_beo` has no tenant filter and
>   does not care. But the 47 users with no `simulationTokens` **cannot run a single
>   simulation** and never could, and that is worth fixing on its own:
>   `scripts/migrate-legacy-users.mjs`.
> - **Oracle serves production.** `chem_beo` proxies all eight `/tanimoto/*` routes to
>   `151.145.91.17:8000`, hardcoded, and the Deep Similarity page calls them. **Phase 7 as
>   written breaks a live feature.** Its Postgres is production data, not a disposable index.
>   Rule 4 is unchanged — that is about *Mongo*, and it still holds.
>
> Also: `/convertSTR` on `:8001` is already **down**, so DiffDock is already broken; GROMACS
> **is** deployed on 83 and its working config should be captured; everything Pyxis on 83 runs
> in **hand-started `screen` sessions** with no restart policy, so a reboot ends production
> until a human logs in; and there is **a live GitHub token in `/root/chem_beo/.git/config`**
> plus a **frontend-callable credit-minting route** — see that file's §8 before anything else.

**0.1 Capture the docking output contract — DONE 2026-07-28,** see
[DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md). Four records existed; the format is fully
determined and `TORSDO` in the SDF independently confirms AutoDock. Remaining gap: **no failed
dock was ever stored**, so the Asinex *error* shape is still uncaptured. If Asinex is still
reachable, run a few deliberate failures (bad SMILES, unknown PDB ID) and append them.
Original instruction, kept for reference: Against 83's
production Mongo, while Asinex is still answering:

```javascript
db.simulation_logs.find({}, {result: 1, pdbid: 1, smiles: 1}).limit(20)
```

Write the exact field names and structure to `docs/DOCKING-CONTRACT.md` in this repo, for both
`/api/simulation` (AutoDock) and `/api/diffdock/generate`. If Moscow goes dark before this is
captured, the contract has to be reverse-engineered from the client — a much larger task.

**0.2 Inventory production Mongo — DONE 2026-07-28.** It is **Atlas**, not on 83; database name
`test`; 50 users, 1 company, 4 simulation_logs, 2 audit_logs, 0 billing_events. See
[PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) §4.

**0.3 Inventory the per-company URL overrides — DONE, and the answer is "there are none."**
`ligandServiceConfig` is a field only *this repo's* server reads; `chem_beo` has never written
or read it. The single company in Atlas has no such field. Nothing to inventory, and nothing
stale survives the move. Relevant again only at the Phase 5 release.

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

**0.9 Inventory 83's backend — confirmed to exist, never described.** The owner has confirmed
83 runs **both** the frontend and a backend answering its `/api/*`, and that the backend moves
to the box. What that backend *is* — which repo, which version, which Mongo, which env — has
never been written down. It is the thing being replaced; it must not be discovered
mid-cutover. Read-only inventory, change nothing on 83.

```bash
# on 83, read-only
docker ps -a                                   # names, images, uptime
ss -ltnp                                       # what listens where
grep -rn "proxy_pass\|root\|server_name" /etc/nginx/ 2>/dev/null   # read, do not edit
```

Record: the backend's repo and commit if determinable, its Mongo URI and whether the DB is
containerised or on the host, its `.env` keys (**names only — never values into any file**),
and the webroot path the frontend is served from. That last one is what §5.0 flips.

**0.11 Apply the `chem_beo` patch — THE prerequisite for arrival day. Do this first.**
[`deploy/chem_beo/`](../../deploy/chem_beo/). Written, applies cleanly against `index.js` as
deployed on 83 at 2026-07-28, and **verified by running it** against the real Atlas database on
an isolated port — a failed dock returned 502 with the balance unchanged at `99999`.

It does four things, all independent of the box:

1. Lifts all five Asinex addresses and the eight Oracle Tanimoto call sites into environment
   variables, **defaulting to today's values**. This is what makes the cutover a variable and
   the rollback an unset. Without it, arrival day is source edits on a live server.
2. Makes the credit charge atomic and refunds it when the work fails.
3. Closes the five routes that spend money or destroy data — including the open
   `/api/generate-molecules` that is the actual cause of the NVIDIA rate-limiting, and the
   unauthenticated `DELETE` that can wipe 2,951,975 molecules.
4. Makes signup produce an account that can actually run a simulation.

**Deploy it and set nothing.** Defaults reproduce current behaviour exactly, so this is a
restart rather than a change — which is the point of doing it weeks early rather than under a
maintenance window. Read `deploy/chem_beo/README.md` for what it deliberately does *not* fix.

**0.9b Measure the frontend delta — ⚠ Phase 5 gate, not arrival day.** 83's bundle is
**much older** than this repo's `client/`,
which is a strict superset. Before launch day, establish what the old bundle calls that the new
one does not, and vice versa — an endpoint the old frontend uses and this server no longer
serves is a rollback that silently fails. Diff the API calls in the deployed bundle against
this repo's routes. If the deployed bundle's source is unavailable, `grep` the minified JS for
`/api/` string literals; it is crude and it is enough.

**0.10 Check the user documents against what this repo's server expects — DONE, and it FAILS.
⚠ Phase 5 gate, not arrival day.** 49 of 50 lack `companyId`; 47 lack `simulationTokens`; one
has it as a *string*, and `$inc` on a string is a MongoDB error, not a coercion. Fix with
`scripts/migrate-legacy-users.mjs` (idempotent, dry-run by default). The 47-user credit failure
is worth fixing now regardless — those accounts have never been able to run anything.

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

✅ **Already done, 2026-07-28 — [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md).** Captured from
production while Asinex was still answering. Read it; do not re-derive it.

If you want to confirm against the source (**Atlas**, database `test` — not a Mongo on 83):

```bash
db.simulation_logs.find({}, {result: 1, pdbid: 1, smiles: 1}).limit(20)
```

**Two traps the contract records and a naive acceptance test will hit:**

- **The receptor PDB is not byte-stable.** 1,308 of 2,601 lines differ between two docks of the
  same input — hydrogens are re-placed stochastically each run. **The acceptance test cannot be
  a diff.**
- **SMILES are stored URL-encoded**, and the cache key matches the encoded form. Re-encoding
  differently is a silent cache miss, which charges the user twice.

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

### 2.5 Cut over — one environment variable at a time

⚠ **Corrected 2026-07-29. This step used to say "edit `ligandServiceConfig` in the Company
Admin UI." That UI does not exist in production.** `ligandServiceConfig` is a feature of *this
repo's* server, which is not what ships (BOX-ARCHITECTURE §2). Production runs `chem_beo`,
which had every address as a hardcoded string literal — until
[`deploy/chem_beo/01-fixes-and-config.patch`](../../deploy/chem_beo/) turned them into
environment variables. **The patch is the prerequisite for this entire phase.**

Confirm it is applied before going further:

```bash
grep -c 'process.env.DOCKING_API_URL' /root/chem_beo/index.js   # expect >= 1
```

If that is `0`, stop. Apply the patch (`deploy/chem_beo/README.md`) and restart first.

Then, in `chem_beo`'s `.env`, **one variable, then restart, then verify, then the next:**

| Order | Variable | Set to | Leave alone |
|---|---|---|---|
| 1 | `DOCKING_API_URL` | the box | |
| 2 | `DIFFDOCK_API_URL` | the box | |
| 3 | `TANIMOTO_API_BASE` | the box | |
| — | | | `ASINEX_CATALOG_BASE`, `STOCK_API_URL` — **stay on Asinex.** The catalog needs their compound file for licensing reasons and live stock cannot be self-hosted at any price |

**Rollback:** unset the variable, restart. Seconds, no deploy, no database change. Keep the
Asinex URLs valid — they are the disaster-recovery path, and the box has a 1–3 week repair time
(BOX-SPEC §3).

**Verify between each**, and verify the *credit* behaviour too, not just the response: run one
dock that succeeds and one against a nonsense PDB ID. The failing one must return 502 and leave
the balance unchanged. That is the patch's headline fix and it is the thing most likely to
regress under a new upstream.

**At this point docking no longer depends on Moscow.** That is the project. Everything below
is consolidation.

---

## PHASE 3 — Ingress

3.1 Stand up Caddy on the box with `<DOMAIN>`. Do **not** plan on modifying nginx on 83
(rule 2).

**The box's services must not be reachable from the internet unauthenticated.** They are
docking and search engines on a €24,727 machine, and `chem_beo` reaches them from a fixed
address. Bind them to a private path — WireGuard, a Tailscale tunnel, or an allowlist for 83's
IP — before any of them answers a public request. ⚠ **But note the interaction with Phase 5:**
this repo's `assertConfiguredUrlsArePublic` **rejects private ranges and CGNAT 100.64/10
(Tailscale)** for the four `ligandServiceConfig` fields. `chem_beo` has no such guard, so a
private address works on arrival day and would need addressing at the Phase 5 release.

3.2 **Stripe: nothing to do on arrival day.** ⚠ Corrected 2026-07-29. This step used to say
"re-register the webhook against the new URL." There is no new URL — `chem_beo` keeps serving
`app.pyxis-discovery.com` and Stripe keeps pointing at exactly what it points at now. **Do not
touch the Stripe configuration.** It is the one billing-critical surface and arrival day gives
it no reason to change.

The webhook *does* need attention at the **Phase 5** release, and separately there is a
standing finding that **no webhook is registered at all**, so real purchases grant no credits
([STRIPE_LIVE_CUTOVER.md](./STRIPE_LIVE_CUTOVER.md)). That is a live bug and a separate job —
not a migration step, and not to be fixed under a maintenance window.

---

## PHASE 4 — Data


### 4.1 / 4.2 — ⛔ DEAD. DO NOT EXECUTE. The database does not move.

**Removed 2026-07-29.** These steps told you to inventory "83's Mongo" and `mongodump` it into
"the box's Mongo". Both halves are wrong:

- **There is no Mongo on 83.** The production database is **MongoDB Atlas**
  ([PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) §4). The `<83_MONGO_URI>`
  placeholder these steps used does not exist and §1 already says so.
- **The box does not get a Mongo.** Atlas stays
  ([BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §4). Putting the only copy of the user and
  billing data on the machine with a 1–3 week repair time and no offsite backup is the largest
  risk anyone proposed in this project.

The inventory these steps asked for **has already been done** — 50 users, 1 company, 4
`simulation_logs`, full schema check, in PRODUCTION-83-INVENTORY §4 and §5. Do not redo it.

**Consequence: there is no data window, no write freeze, and no dump/restore on arrival day.**
Both `chem_beo` and the box talk to the same Atlas cluster throughout. If any instruction leads
you toward migrating the database, you have misread the plan — hard rule 7 applies. Stop.

The one prerequisite that *is* real: **add the box's IP to the Atlas network allowlist.**
Nothing on the box reaches the database until that is done, and the symptom is a TLS alert 80.

### 4.3 Tanimoto / Postgres — ❌ CORRECTED, this is production data

**Superseded text, kept so the change is visible:** *"Oracle's index is probably a non-prod
artefact. Prefer rebuilding from source data on the box to restoring a `pg_dump`."*

That was wrong. Oracle's Postgres answers live user traffic:
`browser → :3000 chem_beo → 151.145.91.17:8000 tonomitosql → Postgres/RDKit`, from the Deep
Similarity page. The eight proxy routes are hardcoded in `chem_beo/index.js:196-439`.
Details in [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) §7.

So:

1. **Take the `pg_dump` first, before touching anything on Oracle**, and verify it restores.
   It is production data and the only copy. Queried live, the index holds **2,951,975
   molecules**, built from **`molsd4.csv`**, indexed **2026-03-12**.
2. Restore it on the box. Rebuilding from source is **not** an available fallback: nobody knows
   where `molsd4.csv` is, or whether it still exists. **Ask the operator early whether that file
   survives anywhere.** If it does, a rebuild is a cross-check worth having — compare row counts
   and a handful of known queries against the restored index. If it does not, the dump is the
   only thing standing between the project and losing three million indexed molecules.
   ⚠ Note also that an **unauthenticated internet-reachable `DELETE`** currently proxies to this
   dataset (PRODUCTION-83-INVENTORY.md §8, row 3b) — which is why the dump should be taken now
   rather than on arrival day.
3. **Do not remove either `tonomitosql` container until the box has answered the same queries
   correctly**, and until whatever is serving `/tanimoto/*` has been repointed. Today that is
   `chem_beo`, where the URL is a **string literal** — there is no config flip and no fast
   rollback.

**Rule 4 is unaffected.** It forbids restoring *Mongo* from Oracle, and that still stands —
Oracle's Mongo is a genuine side-project copy. This is Postgres, a different database on the
same machine. Do not let the two collapse into one rule in either direction.

Note: `tonomitosql`'s Dockerfile has an ARM fallback that installs without `rdkit-pypi`. On
x86_64 it should install normally — **verify the fallback branch is not being taken silently**,
because it degrades chemistry to SQL-side validation.

---

## PHASE 5 — ⛔ NOT ARRIVAL DAY. Server swap, weeks later, as its own release.

> **Read this before you execute one line of it.** Revised 2026-07-29.
>
> **Arrival day does not replace the API server and does not rebuild the frontend.** 83 keeps
> running `chem_beo`, patched ([`deploy/chem_beo/`](../../deploy/chem_beo/)) — the same process,
> the same bundle, the same origin, the same database. The cutover is environment variables,
> and it already happened in **Phase 2**. Decision and reasoning:
> [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §2.
>
> **If you are executing this runbook on arrival day: Phase 4 and Phase 5 are both dead. Go
> from Phase 3 straight to Phase 6.** Phase 2 is the migration; 6 and 7 are consolidation.
>
> Everything below is the plan for the **later** release that swaps `chem_beo` for this repo's
> `server/index.js` + `client/dist`. It is kept because it is correct *for that release* and it
> is the hardest part of the project to think through. It runs after the box has carried real
> docking traffic for at least a week, under its own change window, with its own approval.
>
> **Its preconditions, none of which gate arrival day:** `scripts/migrate-legacy-users.mjs`
> applied (Phase 0.10 clean), response shapes verified route by route against `chem_beo`, and
> the current 83 bundle backed up and proven readable.

### 5.0 The launch is two deployments, and they are one release

This is the part with the most ways to go wrong. Read it before deploying anything.

**Today, 83 runs both halves:** the frontend *and* a backend answering its `/api/*`. The
frontend bundle there is **much older than this repo's `client/`** — this repo is a strict
superset. This release changes both halves at once:

| Half | From | To |
|---|---|---|
| Backend | `chem_beo` on 83 | **this repo's `server/index.js`, on 83** |
| Frontend | 83, old bundle | **83, this repo's `client/dist`** |

**Atlas is unchanged on both sides, and so is the box.** Same database, same docking URLs. The
only thing moving is which process answers `/api/*` and which bundle calls it.

**The two halves cannot move independently.** The old bundle talks to the old backend; the new
bundle talks to the new one. Deploy the new frontend first and it calls an API that isn't
serving yet. Deploy the new backend first and the old frontend keeps calling `chem_beo` as
though nothing happened. Neither half is useful alone, and a half-done cutover is the one state
with no clean rollback.

**There is no production deployment path for this repo today, and that is deliberate.**
`deploy.yml` is `workflow_dispatch`-only against `environment: non-prod`; its push trigger is
commented out at `.github/workflows/deploy.yml:6-7`. Its only target is Oracle, which is being
discarded. So everything on `main` — `956f9d9`'s credit refunds, atomic charge, NVIDIA key
pool, upstream 401→502 — runs nowhere until this release. **Some of it, but not all, was
back-ported into the `chem_beo` patch:** the atomic charge and the refund, and the *cause* of
the NVIDIA rate-limiting (an open `/api/generate-molecules`). The key pool, the 429 rotation,
the circuit breaker and `upstreamProxyStatus()` ship only here. **This is a launch, not an
update:** a version that has never carried production traffic starts carrying all of it. Treat
it as a release with a rehearsal and a rollback, not a `git pull`.

#### What makes it survivable

**The bundle carries the API address.** `VITE_API_BASE_URL` is baked in at *build* time. So
the new bundle points at the new server and the old bundle points at `chem_beo`, as a property
of the files themselves. That turns the whole cutover into **one atomic action — swapping which
bundle 83 serves** — and the rollback into swapping it back. No config to coordinate, no
window where the two halves disagree. Run the new server on a spare port so both are live at
once; `chem_beo` is the rollback and it never stops.

Use a symlinked webroot so the swap is atomic and reversible:

```bash
# on 83 — file operations in the webroot only.
# DO NOT touch nginx config, TLS, DNS, or the firewall. If the webroot is not
# already a symlink, making it one is an nginx-adjacent change: ask the owner first.
/var/www/pyxis/releases/2026-xx-xx-v2/     # new bundle, uploaded ahead of time
/var/www/pyxis/releases/legacy/            # the CURRENT bundle, copied and kept
/var/www/pyxis/current -> releases/legacy  # flip this, and only this

ln -sfn /var/www/pyxis/releases/2026-xx-xx-v2 /var/www/pyxis/current   # cut over
ln -sfn /var/www/pyxis/releases/legacy        /var/www/pyxis/current   # roll back
```

**Back up the existing bundle before anything else.** It is the rollback, it predates this
repo, and there may be no other copy of it. Verify the backup is readable before proceeding.

**Rehearse the whole thing on the box first.** The box can serve the frontend itself —
`server/index.js` serves `client/dist` when `FRONTEND_DIST` is set, which is exactly what the
root `Dockerfile` builds. So run the new frontend against the new backend, same-origin, on the
box, pointed at a **copy** of the database, and exercise login, a dock, credits, and Stripe
before 83 is touched at all. This is the only place a full rehearsal is possible without a
vhost on 83, which the no-nginx rule forbids.

#### There is no data window — ✅ corrected 2026-07-29

**Superseded text, kept so the change is visible:** *"Users write to 83's Mongo continuously. A
`mongodump` taken at T is stale by T+1… announce a short freeze."*

That described a database migration, and there is no database migration. **Both servers use the
same Atlas cluster** — before, during, and after. No dump, no restore, no freeze, no divergence,
and the users/credits collections are never at risk. See §4.1/4.2 and
[BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §4.

**What replaces it as the real risk: response shapes.** Both servers write `simulation_logs`,
and they write it in **two different shapes** — `chem_beo` nests `user: {username, …}` while
this repo writes `username` at the top level
([DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) §1). So documents written by the new server may
not be found by the old one after a rollback, and vice versa. Verify shape parity route by
route **before** the flip, and treat any divergence as a stop.

#### Sequence

1. **0.9 and 0.10 clean.** If 0.10 is non-zero, **stop** — `chargeSimulationToken` filters
   `simulationTokens: {$gt: 0}`, so users missing that field get 403 on every metered action,
   and `buildTenantFilter` stops matching newly-written results. Run
   `scripts/migrate-legacy-users.mjs`. **This gates only this release, not arrival day.**
2. New server running and healthy on a spare port, against Atlas. **`chem_beo` still running
   and untouched.** Same docking URLs as `chem_beo` — the box does not change here.
3. Build `client/dist` with `VITE_API_BASE_URL` pointing at the new server. Rehearse.
4. Verify response shapes route by route against `chem_beo`, especially `simulation_logs`.
5. Copy the current 83 bundle to `releases/legacy`. **Verify it is readable.**
6. Upload the new bundle to `releases/`. Do not flip yet.
7. **Flip the symlink.** This is the cutover. Seconds, and no writes are frozen.
8. Verify against production immediately: login, a dock, credit balance, a Stripe redirect,
   invite email links. Watch the new server's logs live.
9. Leave `chem_beo` **running but idle** for at least a week. It is the rollback and it costs
   nothing to leave alone.

**Rollback:** flip the symlink back. The old bundle points at `chem_beo`, which never stopped
and which is looking at the same database. The only thing needing reconciliation is
`simulation_logs` documents written in the new shape during the window — which is why step 4
happens before the flip and step 8 happens immediately, not the next morning.

Retire `chem_beo` only after the new server has carried real traffic for a week, and only as a
separate, deliberate change. Same reasoning as keeping the Asinex account alive as DR.

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

5.5 Set `ligandServiceConfig` on the company to the box's docking URLs — this repo's server
reads it and does **not** read the `DOCKING_API_URL` env vars the patch added to `chem_beo`.
Getting this wrong sends docking back to Moscow the moment the new server takes over. There is
nothing stale to clean up: the single company has no such field today (0.3).

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

> ### ❌ 7.0b — the machine is not what this phase assumed
>
> This phase was written believing Oracle was entirely a side project. **Two of its five
> containers serve production.** `tonomitosql-api-1` and `tonomitosql-db-1` answer the Deep
> Similarity page today, via eight hardcoded proxy routes in `chem_beo`
> ([PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) §7).
>
> Add a precondition, at the top of 7.0:
>
> - [ ] **`/tanimoto/*` no longer resolves to `151.145.91.17` from anywhere.** Whatever serves
>       those routes has been repointed at the box, and the repoint has been verified from a
>       browser — not just from a shell on the box.
>
> Until that is true, Phase 7 does not start. The three `medsaas-*` containers remain
> discardable; the two `tonomitosql-*` ones are a service migration, not a cleanup.

### 7.1 Removal order — one at a time, verify between each

| # | Container | Remove only when |
|---|---|---|
| 1 | `medsaas-app-1` | now — defunct non-prod copy, nobody uses it |
| 2 | `medsaas-mcp-server-1` | the box's MCP server is reachable and **Claude Science** has connected to it (see the caveat in §"Still open") |
| 3 | `medsaas-mongo-1` | the box's Mongo is live. **Data is discarded, not migrated** |
| 4 | `tonomitosql-api-1` | ⚠ **production.** `/tanimoto/v1/*` on the box has answered real queries **and** nothing routes to `151.145.91.17` any more (7.0b) |
| 5 | `tonomitosql-db-1` | ⚠ **production data.** **Last.** A verified `pg_dump` restore already exists on the box (§4.3) — this is the only copy, and it is not being rebuilt from source |

Every one of these is rule 1. Quote the command, wait for approval, run it, verify, append to
the state file.

### 7.2 Plumbing

- Remove the `deploy.yml` Oracle target, the deploy key, and any Actions secret pointing at
  `151.145.91.17`
- **Remove the hardcoded Oracle default in `TANIMOTO_API_BASE`** — `server/index.js:80`
  defaults to `http://151.145.91.17:8000`. ❌ The original note here called this a pointer to a
  "decommissioned host"; it points at the **live** service. Set `TANIMOTO_API_BASE` explicitly
  in the box's `.env` first, prove `/tanimoto/*` works from it, and only then delete the default
  — in that order. Removing it while it is still the thing answering is how this breaks
- `chem_beo` has **no equivalent knob** — its Oracle URL is a string literal at eight call
  sites. If `chem_beo` is still serving anything at this point, repointing it is a code edit and
  a restart on 83, not a config change

### 7.3 Do not touch

CLIProxyAPI (`:8317`), Crafty (`:8443`), `~/.cli-proxy-api/auths/`, or anything else on that
machine. Ops notes live in `~/projects/oracle`, not this repo.

---

## Abort conditions — stop immediately and escalate

- Any hardware verification in 1.1 fails
- The mirror does not boot degraded (1.2)
- **The `chem_beo` patch is not applied** — 2.5's `grep` returns `0`. Without it there is no
  cutover and no rollback, only source edits on a live server. Stop and apply it
- **You are about to remove, stop or repoint anything on Oracle and `/tanimoto/*` still
  resolves there** (7.0b) — that is live user traffic
- **A dock that fails does not refund the credit** (2.5). The patch is either not applied or
  has regressed against the new upstream
- **A dock that succeeds returns a payload that does not match
  [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md)** field-for-field. Names and structure must
  match exactly or the frontend breaks silently — scores need not
- Any port on the box is reachable from off-box that you did not intend (1.4, 3.1)
- `chemtest_tech_private.key` has not been rotated and you are about to deploy glioblastoma
- Any instruction anywhere tells you to restore from Oracle's Mongo
- **Any instruction leads you to migrate the database, rebuild the frontend, replace the API
  server, or touch nginx/TLS/DNS/Stripe.** None of those is arrival-day work

## Rollback by phase

| Phase | How to undo |
|---|---|
| 1 | Nothing to undo — no production traffic involved |
| 2 | Unset the variable in `chem_beo`'s `.env`, restart. Seconds. Asinex never stopped |
| 3 | Stop Caddy on the box. Nothing on 83 changed |
| 4 | **Dead phase — nothing to undo.** Atlas is untouched throughout |
| 5 | **Not arrival day.** For that release: flip the webroot symlink back; `chem_beo` is still running against the same database |
| 6 | Unset `SDF_CONVERTER_URL` etc. and restart. 83's copies are still up |
| 7 | **None. This is why 7.0 exists.** |

## Still open when you start — do not try to solve these yourself

1. **Offsite backup.** Unowned. Everything now lives in one chassis on pick-up warranty.
2. **Who is physically on site.** Precondition gate §2.
3. **NVIDIA rate limiting — partly addressed, partly not.** The *cause* is fixed by the
   `chem_beo` patch: `POST /api/generate-molecules` was open to the internet, so anyone could
   spend the quota. The *resilience* — key pool, rotation on 429, backoff, circuit breaker — is
   in this repo's `callNvidiaNim()` and **ships only at the Phase 5 release.** Until then a
   genuine 429 still surfaces as a failure. Folding and generation stay on NVIDIA's hosted NIM
   permanently; the box never runs them.
4. **Catalog and stock** stay on Asinex for now. Both temporary; neither blocked on hardware.
5. **Claude Science compatibility — unverified.** The target is Anthropic's **Claude Science**
   app, not the older "Claude for Life Sciences" naming these docs used until now. The MCP
   server (`services/mcp-server`, 14 tools, stateless Streamable HTTP on `:8080/mcp`) was
   built against the older integration and **nobody has checked what Claude Science actually
   requires** — transport, auth, tool-schema or manifest differences are all unknown here.
   Treat `docs/CLAUDE-LIFE-SCIENCES.md` as describing the server, not as a statement that it
   is compatible. **Verify against current Anthropic documentation before relying on step
   7.1/2**, and do not let a failed connection block the Oracle decommission without asking.
