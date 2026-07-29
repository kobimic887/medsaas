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

## Read this before the phase list — the order changed

**Revised 2026-07-29, twice.** Earlier drafts planned to replace the API server, move the
database, and swap the frontend, all on arrival day. Then all of that was pushed to "later".
**Both were wrong about the sequencing.**

### Phase 5 does not depend on the box. Do it FIRST, weeks before delivery.

The server swap needs this repo's `server/index.js`, Atlas, and Asinex — **no new hardware**.
Holding it until after the box arrives was a mistake: it puts a first-ever production
deployment on the same day as unfamiliar hardware, where a failure is ambiguous between the two.

Run it early and the failure modes separate cleanly. It also stops being a migration step and
becomes an ordinary release, on a day of your choosing, with `chem_beo` still running beside it.

**Order:**

| When | What | Depends on the box? |
|---|---|---|
| Now | **0.11** — apply the `chem_beo` patch, set nothing | no |
| Now | **0.10** — `scripts/migrate-legacy-users.mjs` | no |
| Now | **0.9b** — verify response shapes route by route | no |
| Now | **4.3a** — `pg_dump` Oracle's Tanimoto Postgres, prove it restores. **Do not wait** — an unauthenticated internet-reachable `DELETE` can wipe it | no |
| Then | **PHASE 5** — this repo's server + `client/dist` take over port 5173 | **no** |
| ↳ then run on it for at least a week | | |
| Box arrives | **PHASE 1** — hardware, drivers, CUDA, storage | yes |
| | **PHASE 2** — docking engines, cut over | yes |
| | **PHASE 3** — ingress | yes |
| | **4.3b** — restore the Tanimoto dump onto the box | yes |
| | **PHASE 6** — convertSTR, ADMET, GROMACS, glioblastoma | yes |
| | **PHASE 7** — Oracle decommission, weeks later | yes |
| never | **4.1 / 4.2** — moving the production Mongo. **Dead. Atlas stays.** | — |

⚠ **"Phase 4 is dead" is wrong and dangerous shorthand — half of it is.** There are **three**
databases and they get three different answers. Do not let them collapse:

| Database | Where | What happens |
|---|---|---|
| Production Mongo — users, credits, billing, docking history | **Atlas** | **stays.** Never dumped, never moved (§4.1/4.2) |
| Tanimoto Postgres — 2,951,975 molecules | **Oracle** | **copied to the box.** Production data, only copy (§4.3) |
| Oracle's Mongo | Oracle | **discarded. Never restore from it** (hard rule 4) |

**If Phase 5 has not shipped by the time the box arrives, do not do it that day.** Fall back to
the compute-only plan below: patch `chem_beo`, repoint its env vars, swap the server later.
Both routes work; what must not happen is doing both on one day.

### Either way, hardware day itself moves compute only

Arrival day moves **compute only**:

| | Arrival day |
|---|---|
| API server | **unchanged** — whichever one is already serving, `chem_beo` or this repo's |
| Frontend | **unchanged** — not rebuilt, not swapped |
| Database | MongoDB Atlas — **not touched, not dumped, not migrated** |
| nginx / TLS / DNS / Stripe | **not touched** |
| Docking, DiffDock, Tanimoto | **repointed at the box, one setting at a time** |

**Run: Phase 1 → 2 → 3 → 4.3 → 6 → 7.** Only **4.1/4.2** are dead (the Mongo move); **4.3 is
live and mandatory** — it is the Tanimoto index. Phase 5 either shipped weeks
ago or is deferred — it is never same-day. Phase 2 is the migration; the rest is consolidation.

**How you cut docking over depends on which server is live by then:**

| If 83 is running… | Cutover is | Rollback |
|---|---|---|
| `chem_beo`, patched | `DOCKING_API_URL` / `DIFFDOCK_API_URL` / `TANIMOTO_API_BASE` in its `.env`, restart | unset, restart |
| this repo's server (Phase 5 shipped) | `ligandServiceConfig` on the company, from the admin UI | edit the fields back |

Check before you plan anything: `ss -ltnp | grep 5173` and Phase 2.5's `grep`.

**Either way the whole day's rollback is one setting and a restart.** No deploy, no data loss,
no user session broken. Nothing in Phases 1–3 or 6 is irreversible.

**The box's address is a public hostname, decided 2026-07-29.** Not a VPN — see Phase 3.1.
That also disposes of a warning this runbook used to carry, that
`assertConfiguredUrlsArePublic` would refuse the box on the new server but not the old one.
It would only ever have applied to a private or CGNAT address, and there is not going to be
one. Two independent reasons it is moot: a public hostname passes the guard, and the guard
has a single call site on the admin-UI path — the environment variables that actually carry
the cutover are never validated at all.

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
4. **Oracle's MongoDB is discarded, not merged. Never restore from it.** Production Mongo is
   **MongoDB Atlas** — *not* on 83, as an earlier version of this rule said, and not on Oracle.
   If any instruction, comment, or older document tells you to restore Mongo from Oracle, it is
   stale — stop and report it.

   ⚠ **This rule is about Mongo and nothing else.** Oracle's **Postgres** is a different
   database on the same machine, it holds **production Tanimoto data**, it is the **only copy**,
   and it **does** get copied to the box (§4.3). Do not let the two collapse into one rule in
   either direction: refusing to copy the Postgres loses 2,951,975 molecules; copying the Mongo
   overwrites production with a side project.
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
| `<DOMAIN>` | the DNS name the box answers on, for TLS. **Not for Stripe** — see below | Phase 3 |
| ~~Stripe dashboard access~~ | ⛔ **NOT NEEDED, and do not use it.** `chem_beo` keeps serving the same origin, so Stripe has nothing to repoint. Phase 3.2 says do not touch it. (Separately: **no webhook is registered at all**, so real purchases grant no credits — a live bug, not a migration step) | — |
| `.env` values | for the **box's own services** (docking, DiffDock, Tanimoto, GROMACS). The API's `.env` stays on 83 and is edited in place — three variables, Phase 2.5. Not in git, never will be | Phase 2 |

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
> - **Mongo is Atlas, not on 83.** ✅ **Settled: Atlas stays and only compute moves.** §4.1/4.2
>   are dead — **but not §4.3, the Tanimoto Postgres, which still moves.** There is no dump, no restore, and no write-freeze window. The box's IP must be
>   added to the Atlas allowlist before it can serve anything.
> - **The frontend is a Vite dev server**, proxied by nginx, with no build and no bundle. So
>   §5.0's symlink swap has no "old bundle" to preserve. ✅ **And it needs no nginx change** —
>   the "must become a static `root`" claim was wrong; run this repo's server *on* 5173 instead
>   (§5.0, inventory §6.3). The dev server's directory is the rollback: never delete it.
> - **0.10 FAILS: 49 of 50 users have no `companyId`**, and 47 have no `simulationTokens`.
>   ⚠ **Gates Phase 5, not hardware day** — `chem_beo` has no tenant filter and does not care.
>   But the 47 users **cannot run a single simulation** and never could, so fix it now:
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

**0.5 Look for where ADMET and GROMACS were deployed once — ✅ RESOLVED 2026-07-29.**

- **GROMACS: the repo IS the deployed code.** `/root/gromacs-api` on 83 was diffed against
  `services/gromacs-api`. The **Dockerfile is byte-identical**; `app.py` differs by **one
  trailing space and one missing final newline**. Nothing to recover. Config captured:
  `WORK_DIR=/data`, `MAX_UPLOAD_SIZE=104857600`, `JOB_TIMEOUT=3600`, bind mount `./data:/data`,
  `restart: unless-stopped`, `uvicorn app:app --host 0.0.0.0 --port 8000`. It is a **CPU-only
  apt build** and needs `-DGMX_GPU=CUDA` to be worth moving.
- **ADMET: never deployed anywhere.** Nothing to find. `services/admet/` is the only copy and
  it has never run against production.
- **convertSTR: source does not exist**, on 83 or anywhere. Clean-room rebuild from a
  three-line contract — [deploy/box/BRIEF-SERVICES.md](../deploy/box/BRIEF-SERVICES.md) §1.

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

**0.9b Measure the frontend delta — ⚠ Phase 5 gate. Do it while `chem_beo` is still live.** 83's bundle is
**much older** than this repo's `client/`,
which is a strict superset. Before launch day, establish what the old bundle calls that the new
one does not, and vice versa — an endpoint the old frontend uses and this server no longer
serves is a rollback that silently fails. Diff the API calls in the deployed bundle against
this repo's routes. If the deployed bundle's source is unavailable, `grep` the minified JS for
`/api/` string literals; it is crude and it is enough.

**0.10 Check the user documents against what this repo's server expects — DONE, and it FAILS.
⚠ Phase 5 gate; run it now regardless.** 49 of 50 lack `companyId`; 47 lack `simulationTokens`; one
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
  confirmed by the Asinex/Pyxis CEO and by the mangled `TORSDOF` in the stored output.

**⚠ The engine is the smaller half. Three services sit around it, and none exists yet:**

| Stage | Spec | Status |
|---|---|---|
| **Receptor prep** | fetch RCSB, drop HETATM, add `OXT`, add hydrogens, **do not minimise** | **fully determined** — DOCKING-CONTRACT §2. Heavy atoms must match RCSB at 0.0000 A |
| **Search box** | centre the grid on the centroid of the stripped co-crystal ligand (**not** waters or ions) | **determined** — §2b. Box *dimensions* and exhaustiveness are not |
| **PDBQT to SDF** | RDKit V2000, tags `MODEL TORSDO SCORE ligand_id original_smiles smiles`, exact `'>  <tag>  (1) '` spacing, one shared `<smiles>` across poses | **determined** — §3, §7 |
| **HTTP wrapper** | `POST /docking` taking `{pdbID, smiles}`, SMILES arrives URL-encoded | **determined** — §0 |

Write these against the contract before the box lands. Only the CUDA compile genuinely needs
the cards; everything above can be built and tested on any machine, against the captured
reference payload, using `scripts/verify-docking-response.mjs`.
- **OSS DiffDock** (`gcorso/DiffDock`, MIT), torch **cu128**. **Not the NIM container** — that
  requires NVIDIA AI Enterprise, which was refused, and NIM does not support GeForce.
- **AutoDock Vina** (classic, CPU) across the 32 cores, as the reference path.

### 2.3 Grid map cache

`autogrid` maps are per-receptor, CPU-bound, and cacheable. Key them by PDB ID under
`/srv/cache`. First dock against a protein pays for the maps; subsequent ligands do not.

Record the **actual** size per receptor in the state file. The ~60 MB figure in the docs is an
estimate from typical box dimensions and has never been measured.

### 2.4 Validate before cutting anything over — this is the gate, not a formality

**Run the script. It is not optional and it is not a diff you can eyeball.**

```bash
node scripts/verify-docking-response.mjs --url http://<box>:8000/docking \
  --pdbid 1cx7 --smiles 'Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C' --save candidate.json
```

Exit **0** required. It pushes the payload through both production parsers
(`/api/sanitizedminimalsdf` and the client's `parseSdfData`) and prints the pose table the
dashboard would render.

**Why a field-by-field diff is not enough.** The two parsers disagree about strictness. A
payload that is chemically perfect and passes any reasonable SDF validator will still render
**nothing** if a property tag is written `> <smiles>` instead of `>  <smiles>` — the server
drops every pose, returns **HTTP 200** with an empty body, and the user gets a receptor with no
ligands, no score, and no error anywhere. [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) §7.

Then, and only then, judge the chemistry:

- Run the same protein/ligand pairs already in `simulation_logs` and compare scores against the
  four stored reference docks. **Score parity is not expected** — different engines and builds
  differ. Field names and structure must match exactly.
- **Do not diff `result.pdb` for byte-equality.** The reference re-protonates every dock;
  1,308 of 2,601 lines differ between two runs of the same input (§2). Compare heavy atoms.
- **Red badges are normal.** The UI colours anything at or above −5 red, and every real dock
  production has ever produced scores −4.3 to −4.6. Red is not a regression.
- **Decide the `TORSDO` question** (§3): Asinex emits tag `TORSDO` with the value `"F 5"`, a
  truncation of AutoDock's `TORSDOF 5`. Reproduce the bug, or emit `<TORSDOF>` and change
  `molstar3d.jsx:52` in the same release. Not one without the other.

Delegate the chemistry judgement to a strong reasoning model with both outputs attached. Do not
delegate the plumbing check — run the script.

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
address.

**Decided 2026-07-29: no VPN, no tunnel.** Earlier drafts of this step floated WireGuard or
Tailscale. That was a suggestion in a compose-file comment which four documents then repeated
as though it were settled; it never was, and it is rejected. It adds a third-party account and
a daemon on both machines to solve a problem TLS already solves.

**The box is reached the way Asinex is reached today: a public hostname over HTTPS.**
Production already calls `https://services.asinex.com:8000/docking` across the open internet.
The box replacing it the same way is a true 1:1, and the rollback is putting the Asinex
hostname back — the same one setting this whole runbook is built around.

The shape, all of it on the box, none of it on 83:

1. Every service binds `127.0.0.1` (`BIND_ADDR` in `deploy/box/.env`, which already defaults
   to that). Nothing publishes itself.
2. Caddy on `:443` with a Let's Encrypt certificate for `<DOMAIN>`, reverse-proxying to those
   loopback ports. One certificate, one open port.
3. The host firewall admits **only 83's IP** to `:443`. That is the allowlist, and it is one
   rule.

So "not reachable from the internet unauthenticated" is satisfied by the firewall, not by a
tunnel — and the four `ligandServiceConfig` fields see an ordinary public hostname, so
`assertConfiguredUrlsArePublic` never has an opinion about it.

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

## PHASE 4 — Data. **Half dead: 4.1/4.2 are cancelled, 4.3 is mandatory.**


### 4.1 / 4.2 — ⛔ DEAD. DO NOT EXECUTE. The **Mongo** does not move.

**This kills the Mongo move only. It says nothing about §4.3, which is a different database on a
different machine and is mandatory.**

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
   correctly**, and until whatever is serving `/tanimoto/*` has been repointed — `chem_beo`'s
   `TANIMOTO_API_BASE` once the patch is applied, or `server/index.js:80`'s default if Phase 5
   has shipped. Before the patch it is a **string literal** with no config flip and no fast
   rollback, which is the single strongest reason to apply the patch early.

**Rule 4 is unaffected.** It forbids restoring *Mongo* from Oracle, and that still stands —
Oracle's Mongo is a genuine side-project copy. This is Postgres, a different database on the
same machine. Do not let the two collapse into one rule in either direction.

Note: `tonomitosql`'s Dockerfile has an ARM fallback that installs without `rdkit-pypi`. On
x86_64 it should install normally — **verify the fallback branch is not being taken silently**,
because it degrades chemistry to SQL-side validation.

---

## PHASE 5 — the server swap. **Run this BEFORE the box arrives. Never on arrival day.**

> **Revised 2026-07-29.** This phase was numbered 5 because the original plan put it after the
> hardware. **It has no dependency on the box** — it needs this repo's server, Atlas and
> Asinex, all of which exist now. So its number is a leftover, not a sequence.
>
> **Do it as its own release, weeks before delivery.** Then the box is three URL fields on a
> server that has already proven itself in production, and a failure on hardware day is
> unambiguously about the hardware.
>
> **If it has not shipped by delivery, defer it.** Do not run Phase 5 and Phase 1–3 on one day:
> a first-ever production deployment plus unfamiliar hardware makes every failure ambiguous, and
> both have their own rollback only while they are separate. Falling back costs nothing — the
> patched `chem_beo` cuts over by env var instead.
>
> **Preconditions, all runnable today:**
>
> | | Why |
> |---|---|
> | **0.11** — `chem_beo` patch applied | it is the rollback target; you want the credit fixes on *both* sides |
> | **0.10** — `scripts/migrate-legacy-users.mjs` applied, 0 users without `companyId` | this server filters `simulationTokens: {$gt: 0}` and tenant-scopes every query. Without it, 47 users get 403 on everything and new results are written where the old server cannot find them |
> | **0.9b** — response shapes verified route by route | matching paths ≠ matching payloads. This is the real gate — see §5.0 |
> | `/root/material-tailwind-dashboard-react` **left intact** | it *is* the rollback. There is no bundle to preserve; the rollback is restarting that dev server |

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

**Each half carries the other's address, so neither can drift.** `VITE_API_BASE_URL` is baked
in at *build* time — the new bundle is same-origin `/api/*`, the old dev server's code points
at `:3000`. Which API answers is a property of which frontend is being served, not of any
runtime config. So there is no window where the two halves disagree.

⚠ **The symlinked-webroot plan that used to be here is wrong for this host, and so is the
"back up the existing bundle" step. There is no bundle.** nginx does not serve files — it
proxies:

```
location /  →  proxy_pass http://localhost:5173   # a Vite DEV SERVER, not a webroot
```

**The swap is therefore which process owns port 5173** — and this needs **no nginx change**,
which matters because rule 2 forbids one:

```bash
# CUT OVER — stop Vite, then:
PORT=5173 FRONTEND_DIST=/path/to/client/dist bun server/index.js

# ROLL BACK — stop it, then, in /root/material-tailwind-dashboard-react:
npm run dev-vite-only
```

⚠ **`npm run dev` is the wrong rollback command** — corrected 2026-07-29, by running it. That
script is `concurrently "node stripe-server.cjs" "vite"`, and `stripe-server.cjs` is *already*
holding `:3001` from a shell started 2026-07-02. So `npm run dev` starts Vite and then loses its
other half to `EADDRINUSE`. There are two half-dead `concurrently` stacks on the box today for
exactly that reason: one kept `stripe-server`, the other kept `vite`. **`dev-vite-only` is the
rollback**, and `:3001` must be left alone because Vite proxies `/api` to it.

⚠ **Use `bun`, not `node`.** 83 runs **Node v18.19.1**; this repo has no `engines` floor and is
Bun-first. Bun 1.3.12 is already installed at `/usr/local/bin/bun` and the rehearsal ran on it
against real Atlas without incident. Do not discover Node 18's limits during a cutover.

**Rehearsal result, 2026-07-29:** `/root/pyxis-release-a` on port 5199, `bun index.js` +
`client/dist`, real Atlas. Connected, created indexes, served `client/dist` and `/health`, and
passed a 17-route shape comparison against `chem_beo`. Build `client/dist` **on a dev machine and
`scp` it** — Vite 8 will not run on Node 18, and building on 83 would put a Node upgrade on the
critical path for no reason.

`server/index.js` reads `PORT` (`:5368`) and serves `client/dist` via `express.static`
(`:6699`). nginx proxies to 5173 either way and never learns anything changed.

**What to preserve instead of a bundle: `/root/material-tailwind-dashboard-react` itself.** It
is the rollback, it is a **different codebase** from this repo's `client/` (Creative Tim
template lineage, not an older version), and there may be no other copy. Do not move, clean,
`git`-modify or delete it. Confirm `npm run dev` still starts it *before* you cut over — an
untested rollback is not a rollback.

**Bonus, and the reason to prefer this over any static-root variant:** the new frontend and the
new API end up on **one origin behind nginx's TLS**. That retires the internet-facing `:3000`
server with wildcard CORS and no firewall, and removes the cross-origin 401 auto-logout
problem, in the same action.

**Rehearse on 83 itself, on a spare port.** ⚠ Corrected 2026-07-29 — this used to say "rehearse
on the box", which is impossible now that Phase 5 runs *before* delivery. It does not need the
box: stand the whole stack (server + `client/dist`, same-origin) on an unused high port on 83,
against the real Atlas, with production untouched.

**This exact technique is already proven here** — it is how the `chem_beo` patch was verified
(port 3999, real Atlas, rig deleted afterwards), and it caught two bugs that `node --check`
passed. Follow the same discipline: an isolated directory, a port nothing else uses, and
**delete the rig when done** — confirm every production port is still listening before you
walk away.

Exercise: login, a dock (one that succeeds and one that fails — check the credit is refunded),
credit balance, a Stripe redirect, an invite email link, and a Deep Similarity search.

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

**None of this needs the box.** Do it weeks before delivery.

1. **0.10 clean.** If `db.users.countDocuments({companyId: {$exists: false}})` is non-zero,
   **stop** — `chargeSimulationToken` filters `simulationTokens: {$gt: 0}`, so users missing
   that field get 403 on every metered action, and `buildTenantFilter` stops matching
   newly-written results. Run `scripts/migrate-legacy-users.mjs`: dry run, read the plan, then
   `--apply --yes-i-have-a-backup`. It self-verifies and exits non-zero if it did not converge.
2. **Confirm the rollback works before you need it.** Verify `npm run dev` starts
   `/root/material-tailwind-dashboard-react`, and that the site is fine after. Ugly to discover
   at step 7.
3. Build `client/dist` with `VITE_API_BASE_URL` **unset or same-origin** — the new server serves
   both halves, so there is no cross-origin call to configure. Set `PLATFORM_NAME=Pyxis
   Discovery` (BOX-ARCHITECTURE §8) and the CORS allowlist while you are there.
4. **Rehearse on 83 on a spare port**, against real Atlas, production untouched. Exercise the
   list above. **Delete the rig; confirm all production ports still listen.**
5. **Verify response shapes route by route against `chem_beo`** — this is the real gate, and
   the only failure mode that survives everything else. `simulation_logs` first (§ above), then
   every route the deployed frontend calls (0.9b).
6. Keep the box out of it: point the new server at **Asinex**, exactly as `chem_beo` does.
   Changing the engine and the server together is the thing this whole ordering exists to avoid.
7. **Cut over: stop Vite, start the new server on 5173.** Seconds. No writes frozen, no nginx
   touched, no database changed.
8. Verify against production **immediately**, not the next morning: login, a dock that works,
   a dock that fails (credit must come back), credit balance, a Stripe redirect, an invite
   email link, Deep Similarity. Watch the logs live.
9. Leave `chem_beo` **running but idle** on `:3000` for at least a week. It is the rollback and
   it costs nothing.

**Rollback:** stop the new server, `npm run dev` the old frontend. It calls `chem_beo` on
`:3000`, which never stopped and is looking at the same database. The only thing needing
reconciliation is `simulation_logs` written in the new shape during the window — which is why
step 5 happens before the cutover and step 8 happens immediately.

Retire `chem_beo` and `:3000` only after the new server has carried real traffic for a week,
and only as a separate, deliberate change. Same reasoning as keeping the Asinex account alive
as DR. **Retiring `:3000` is itself a security fix** — internet-facing, wildcard CORS, no
firewall.

### 5.1 Running it on 83

5.1 **Run it on the host, not in Docker.** It has to bind port 5173 on 83, next to an unrelated
production project (rule 2), and its only dependencies are Node and `client/dist`. A compose
stack buys nothing here and adds a network layer between nginx and the process.

Put it under **systemd**, not `screen`. Everything Pyxis on 83 is hand-started in foreground
shells today, so **a reboot ends production until a human logs in.** A unit with
`Restart=always` fixes the longest-standing operational problem on that machine, and this is
the moment it costs nothing extra.

5.2 **The MCP server is optional and separate.** It is hard-wired to
`MEDSAAS_API_BASE: http://app:3000` on a compose network that will not exist. Point it at
whatever address the API actually has, or leave it off — nothing in the product depends on it,
and Claude Science compatibility is unverified (see "Still open", item 5).

5.3 Set, before starting:
- `PLATFORM_NAME=Pyxis Discovery` — with `companyName` unset this is the *only* brand string
  users see (BOX-ARCHITECTURE §8). Leave it and the product says "MedSaaS".
- `FRONTEND_URL`, `BASE_URL`, `PLATFORM_WEBSITE_URL` — these go into invite emails, password
  resets and Stripe redirect URLs. Wrong values are only discovered by a user.
- `MONGODB_URI` (Atlas, database `test`), `JWT_SECRET` (≥32 chars), `STRIPE_SECRET_KEY`. The
  server refuses to start without these three.

⚠ **Use a NEW `JWT_SECRET`. Do not reuse `chem_beo`'s.** Reusing it looks kind — every logged-in
user stays logged in through the cutover — and it is a trap. `buildTenantFilter`
(`server/index.js:1064`) reads `companyId` from **the token payload, not the database**:

```js
if (user?.companyId) return { companyId: user.companyId };
if (user?.username)  return { 'user.username': user.username };   // legacy fallback
```

A `chem_beo` token carries only `{username, iat, exp}`. So a reused secret means every existing
session keeps presenting a token with **no `companyId`** — for up to `JWT_EXPIRES_IN` — and
silently takes the legacy branch **even though the user migration fixed their database record.**
That branch matches the old `simulation_logs` shape, not the one this server writes: the user
still sees their old docks, never sees a new one, and the cache lookup misses, **so they are
charged again for a dock they already paid for.**

Rotating the secret invalidates every legacy token, forces one clean re-login, and every
session after that carries `companyId`. One re-login is the cheap outcome here.
- CORS allowlist: the frontend origin explicitly, **never `*`**. Same-origin makes this nearly
  moot, which is a reason to prefer it.
- `VITE_API_BASE_URL` — **leave unset.** Same-origin. It is build-time, so setting it wrongly
  bakes a bad address into the bundle and needs a rebuild to fix.

5.4 **The 401 auto-logout invariant.** The client logs the user out on any same-origin 401, so
a 401 must mean "dead session" and nothing else — authorisation is 403, validation 400, upstream
401 → 502. **The server side is done** (`956f9d9`): `upstreamProxyStatus()` maps upstream
401/403 → 502 and 429 → 503 across the NVIDIA and Tanimoto proxies. Serving both halves on one
origin removes the CORS-preflight-reads-as-401 failure entirely — the other reason to prefer it.

5.5 **Docking stays on Asinex at this point.** Set `ligandServiceConfig` to the *current* Asinex
URLs, or leave it unset so the defaults apply. Do not point it at the box here — that is
Phase 2, after the hardware exists and after this server has proven itself.

⚠ When Phase 2 does arrive: this server reads `ligandServiceConfig`, **not** the
`DOCKING_API_URL` env vars the patch added to `chem_beo`. Setting the wrong one leaves docking
in Moscow while everything looks like it worked.

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
- **Any instruction leads you to migrate the database, replace the API server, or touch
  nginx/TLS/DNS/Stripe on hardware day.** None of those is arrival-day work — Phase 5 ships
  weeks earlier or not at all
- **Phase 5 only:** `/root/material-tailwind-dashboard-react` will not start, or 0.10 is
  non-zero. Both are rollback-or-correctness gates; neither is a puzzle to work around

## Rollback by phase

| Phase | How to undo |
|---|---|
| 1 | Nothing to undo — no production traffic involved |
| 2 | Unset the variable in `chem_beo`'s `.env`, restart. Seconds. Asinex never stopped |
| 3 | Stop Caddy on the box. Nothing on 83 changed |
| 4 | **Dead phase — nothing to undo.** Atlas is untouched throughout |
| 5 | Stop the new server, `npm run dev` the old frontend on 5173. `chem_beo` on `:3000` never stopped and shares the same database. **Never arrival day** |
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
