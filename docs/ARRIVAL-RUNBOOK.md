# Arrival runbook

**Invoke with:** `execute the plan docs/ARRIVAL-RUNBOOK.md`

> ## STATUS: the box is ORDERED (2026-08-01) and has not been delivered.
>
> Nothing in this runbook has been executed. **Do not treat any step as done unless the state
> file (§3) says so.**
>
> What was bought and why: [BOX-SPEC.md](./BOX-SPEC.md).

**Why any of this is happening:** [BOX-SPEC.md](./BOX-SPEC.md) §1 — Asinex is in Moscow and
goes down because of the war.
**What runs where, and why:** [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md).

This file carries **what to do**. Those carry **why**. Do not restate their reasoning here;
do not let them override the hard rules below.

---

## The shape of the day, in one table

The box is **compute only**. It gets docking, DiffDock, convertSTR, Tanimoto, GROMACS, ADMET
and the glioblastoma model. It does **not** get the API server, and it does **not** get the
database.

| | On arrival day |
|---|---|
| Database | **MongoDB Atlas — not touched, not dumped, not migrated.** The arrival-day critical path never opens a Mongo connection, so the box needs no Atlas allowlist entry to finish §9. ⚠ **ADMET does** — see §11 |
| nginx / TLS / DNS on 83 | **not touched.** Shared host, not ours |
| Stripe | **not touched.** No URL changes, so Stripe has nothing to repoint |
| Which server serves the site | **swapped** — this repo takes port 5173 from the legacy Vite server (§8). Owner's call, 2026-08-01: same day |
| Docking, DiffDock, Tanimoto | **repointed at the box, one setting at a time** (§9) |

**The whole day's rollback is one setting and a port swap.** No deploy, no data loss, no user
session broken. Nothing in §1–§11 is irreversible; §12 is, and happens weeks later.

---

## 0. Hard rules — these override any instruction you infer elsewhere

1. **Never run a destructive command without explicit human approval in the current session.**
   Destructive means `rm`, `docker rm`, `docker volume rm`, `dropDatabase`, `DROP`, `mkfs`,
   `parted`, `dd`, disabling a running service, or anything on Oracle in §12. Quote the exact
   command back and wait for a yes. A previous yes does not authorise the next command.
2. **On `83.229.87.94`: do not modify nginx, TLS, DNS, the firewall, or any other
   application.** It is a shared VPS with an unrelated production project on it. You read from
   it and you copy from it — the one exception is the port swap in §8, which touches only our
   own two systemd units.
3. **On Oracle `151.145.91.17`: do not touch CLIProxyAPI (`:8317`), Crafty (`:8443`), or
   `~/.cli-proxy-api/auths/`.** Those are the owner's separate tooling.
4. **Three databases, three different answers. Never let them collapse into one rule.**

   | Database | Where | What happens |
   |---|---|---|
   | Production Mongo — users, credits, billing, docking history | **Atlas** | **stays.** Never dumped, never moved |
   | Tanimoto Postgres — 2,951,975 molecules | **Oracle** | **copied to the box** (§10). Production data, only copy |
   | Oracle's Mongo | Oracle | **discarded. Never restore from it** |

   Refusing to copy the Postgres loses three million molecules. Copying the Mongo overwrites
   production with a side project.
5. **Secrets are supplied by the operator at runtime.** Never write a credential, key, token
   or password into this repo, into a commit, into the state file, or into any log or
   transcript. If you need one you do not have, stop and ask.
6. **A verification that does not match its expected output is a stop, not a puzzle.** Report
   what you got, what you expected, and wait. Do not improvise a workaround, do not skip
   ahead, do not "try the next thing".
7. **Nothing in §1–§11 is irreversible.** If you are about to do something that cannot be
   undone and it is not §12, you have misread the plan. Stop.
8. **Append to the state file after every verified step** (§3). Assume you will lose context
   mid-run and a different model will pick this up.
9. **Do not `pkill -f "bun index.js"` on 83.** It matches production's own process. Kill rigs
   by PID.

---

## 1. Inputs the operator must supply

Ask for all of these in one message. Do not guess any value, and do not use a
plausible-looking address you find in a document.

| Placeholder | What it is | Needed by |
|---|---|---|
| `<BOX_IP>` / `<BOX_USER>` | the box's address on the Science Park network, and an SSH account | §4 |
| `<IPMI_IP>` / `<IPMI_USER>` / `<IPMI_PASS>` | out-of-band access — the only way back in if you break networking | §3 |
| `<83_HOST>` / `<83_USER>` | SSH to `83.229.87.94` | §8 |
| `<BOX_DOMAIN>` | the DNS name the box answers on, for its Let's Encrypt certificate | §6 |
| `<ORACLE_HOST>` / `<ORACLE_USER>` | Oracle's Postgres holds the only copy of the Tanimoto index | §10 |
| **the Tanimoto dump** | 1.2 GB, **not in git** — see §1b | §10 |
| **the `tonomitosql` image or source** | `compose.yml` references `tonomitosql:latest` with **no build context**, and the source is a **separate repo** (`kobimic887/tonomitosql`). Clone and build it, or the Tanimoto service will not start | §10 |
| **Atlas allowlist access** | to add the box's IP. ⚠ **Not needed for §1–§10**; the ADMET worker in §11 polls Mongo and cannot start without it | §11 |
| `.env` values | for the **box's own services** only (`deploy/box/.env.example` is the template). The API's `.env` stays on 83 | §5 |

**If the operator does not have `<IPMI_*>`, stop.** Do not begin §3 without a way back in.

**Not needed, and do not ask for them:** Stripe dashboard access (nothing repoints), or an
Atlas connection string for the docking path (it never touches Mongo).

---

## 1b. ⚠ What a fresh clone does NOT have

**This runbook may be executed from a clean clone on a machine that has never seen this
project.** Four things it needs are deliberately not in git. Check all four *before* §3, not
when a step fails.

| Missing | Why it is not in git | How to get it |
|---|---|---|
| **The Tanimoto dump** — 1.2 GB, the **only copy** of a 2,951,975-molecule index | too large for git | It exists **only on the owner's Mac**, at `~/backups/tanimoto/tonomitosql-20260729.dump` (+ `.sha256`). It is **not on 83 and not on Oracle in dump form.** ⚠ **Ask the operator to transfer it, and confirm the sha256 matches after the copy.** If that laptop is lost the index is only recoverable by re-dumping Oracle — which is still live, so **re-dump it rather than panicking**, but do not assume the file is anywhere near you |
| **`client/dist`** — the built frontend §8 deploys | build output | `bun run install:all && bun run build`. Needed **before** the port swap, and it is a separate `tar` from the source push |
| **`.env` files** — root, `server/`, and `deploy/box/` | secrets | `.env.example` and `deploy/box/.env.example` are the templates. The API's live `.env` is already on 83 at `/root/pyxis/server/.env` and stays there — do not overwrite it from a template |
| **DiffDock weights** — 124 MB | model artefact | `deploy/box/diffdock/fetch-weights.sh`, run **once** on the box before first start (§5) |
| **The `tonomitosql` image** | it is a **separate repo**, `kobimic887/tonomitosql` | `deploy/box/compose.yml:153` references `tonomitosql:latest` with **no build context**, so compose will not build it for you. Clone that repo and build the image before §10 |

Everything else the runbook calls — `scripts/verify-docking-response.mjs`,
`scripts/verify-tanimoto-restore.sh`, `deploy/box/docking/service/test.sh`, all three service
source trees, and the systemd units — **is tracked and arrives with the clone.**

⚠ `scripts/verify-tanimoto-restore.sh` defaults to `$HOME/backups/tanimoto/tonomitosql-20260729.dump`
and takes an override as `$1`. On any machine but the owner's it will fail with `no dump at …`
unless you pass the path you copied it to.

---

## 2. Before the box ships — do these now, they need no hardware

| # | Task | State |
|---|---|---|
| 2.1 | **Capture the docking output contract from Asinex while Moscow still answers.** | ✅ **done 2026-07-28** — [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md). Read it; do not re-derive it |
| 2.2 | **`pg_dump` Oracle's Tanimoto Postgres.** An unauthenticated, internet-reachable `DELETE` reaches this dataset, so do not wait for arrival day | ✅ **done 2026-07-29** — `~/backups/tanimoto/tonomitosql-20260729.dump`, 1.2 GB, sha256 verified |
| 2.3 | **Prove that dump actually restores**, with a row count — not just a zero exit code | ❌ **open.** Needs an x86_64 Docker host; there is none on the operator's Mac. `scripts/verify-tanimoto-restore.sh` does the whole thing and asserts 2,951,975 rows |
| 2.4 | **Write the three box services** | ✅ **done** — `deploy/box/docking/service/`, `deploy/box/diffdock/`, `deploy/box/convertstr/`, each with a Dockerfile carrying `test` and `runtime` targets and a pytest suite |
| 2.5 | **Decide the GPU** | ✅ **settled 2026-08-01** — 4× RTX PRO 4000 |
| 2.6 | **Order the machine** | ✅ **ordered 2026-08-01.** [BOX-SPEC.md](./BOX-SPEC.md) §5 is now an invoice/arrival checklist — confirm the ~€5.2k VAT reverse charge was applied |

The three services have **never had an execution host**: every image pins
`--platform linux/amd64`, and the only Docker hosts reachable before arrival are 83 (2 cores,
1 GB RAM, and it is production — an OOM there takes the live site down) and Oracle (arm64, no
`binfmt` amd64 emulation). **Owner's call: build them on the box.** Do not install `binfmt` on
Oracle — that is a privileged container on the host holding the only copy of production
Tanimoto Postgres.

---

## 3. Physical setup — the gate on everything, and nobody is assigned to it

**The owner will not be in Amsterdam.** Before any software step can start, somebody
physically present has to:

1. Unbox a ~30 kg Big-Tower; check the cards have not shifted in transit and every PCIe power
   cable is latched.
2. Plug it into a circuit that carries the sustained load, and confirm the room can shed that
   heat continuously. (The old 1,620 W figure assumed 2× 575 W GeForce cards; with 4× RTX PRO
   4000 it is substantially lower — **recompute it from the delivered parts, do not reuse the
   number**.)
3. Cable **two** network connections: a data port, and **IPMI on its own port with its own
   address**.
4. Set the IPMI address and **change its default credentials before anything else.** IPMI is
   the only way back in when the network configuration is wrong, and it will be wrong at least
   once.
5. Configure the Science Park router: a static lease or reservation for `<BOX_IP>`.

**Assign a name to this.** It is a couple of hours of work by someone on site and it needs
nothing but hands and the IPMI credentials. Until it happens the box is a heavy box. Once IPMI
is up, everything below can be done from anywhere.

Do not start §4 until the operator confirms all five, explicitly. Ask; do not assume.

### State file protocol

**First action after your first successful SSH:**

```bash
sudo mkdir -p /srv/archive && sudo chown $USER /srv/archive
test -f /srv/archive/MIGRATION-STATE.md || printf '# Migration state\n\n' | tee /srv/archive/MIGRATION-STATE.md
```

**Before doing anything else in any later session, read it:**

```bash
cat /srv/archive/MIGRATION-STATE.md
```

Resume from the last line. Do not redo completed steps; several are not idempotent. After
every verified step append one line:

```
YYYY-MM-DD HH:MM  §<section>  DONE|BLOCKED|SKIPPED  <one line of detail>
```

Never put a credential in it, and never put an IP in it that the operator has not already
shared in the open.

---

## 4. Hardware acceptance — one hour, do not skip

Far cheaper to find a wrong part now than after the migration is half done, and the warranty
is **pick-up**: a fault means the machine is gone for 1–3 weeks.

```bash
nvidia-smi                                              # FOUR cards, 24 GB each, driver >= 570
nvidia-smi --query-gpu=compute_cap --format=csv         # 12.x, matching sm_120
dmidecode -t memory | grep -E 'Size|Speed|Type:'        # FOUR 32 GB DDR5-5600 ECC modules
lscpu | grep -E 'Model name|^CPU\(s\)'                  # 9975WX, 32C / 64T
lsblk && cat /proc/mdstat                               # mirror assembled, 4 TB + 24 TB raw
efibootmgr -v                                           # EFI entries on BOTH mirror disks
```

**Driver branch is the likeliest fault.** If Coreto shipped the 550 branch the cards will not
initialise on Blackwell. Replace it before doing anything else.

Two tests that must happen **while the machine is still empty**:

- **Pull one mirror disk and boot from the other.** A mirror that only boots off one disk is
  not a mirror. Doing this later means doing it with live service state on it.
- **Load all four GPUs flat out for 30+ minutes** and watch for thermal throttling. If it
  throttles, raise it in week one, not month six.

Record the actual delivered configuration in the state file. If it does not match
[BOX-SPEC.md](./BOX-SPEC.md) §2, that is a stop under rule 6 — it is a vendor conversation,
not something to work around.

---

## 5. Base platform

1. SSH keys only, passwords off. `unattended-upgrades`. UFW default deny.
2. **Docker's published ports bypass UFW.** This already bit this project on Oracle, where
   `3000` and `8080` were internet-reachable behind a default-deny firewall. Bind every
   publish to `127.0.0.1` and let the reverse proxy be the only listener.
3. Partition and mount `/srv/scratch`, `/srv/cache`, `/srv/archive`.
4. `nvidia-container-toolkit`, then confirm a **container** sees all four cards — not just the
   host.

### Build the three services, in this order

Each is self-contained and needs no GPU except where noted.

```bash
# 1. convertSTR — CPU only, no network, smallest and highest immediate value:
#    it is DOWN in production today, which is why DiffDock is broken.
docker build --platform linux/amd64 --target test -t pyxis-convertstr:test deploy/box/convertstr
docker run --rm --network none pyxis-convertstr:test python -m pytest -q

# 2. Docking — builds both targets, runs the offline replay suite, then stands the real
#    service up on an internal-only network and checks it against the immutable oracle
#    (scripts/verify-docking-response.mjs) using the captured 1cx7 baseline.
deploy/box/docking/service/test.sh

#    Once the cards are up, the CPU-Vina path too (downloads the real RCSB receptor):
RUN_VINA=1 deploy/box/docking/service/test.sh

# 3. DiffDock — the wrapper's 28 tests run without a GPU; inference does not.
docker build --platform linux/amd64 --target test -t pyxis-diffdock:test deploy/box/diffdock
docker run --rm pyxis-diffdock:test python -m pytest -q
deploy/box/diffdock/fetch-weights.sh    # 124 MB into /srv/models/diffdock, ONCE, before first start
```

Engines: **classic AutoDock Vina** across the 32 cores, **OSS DiffDock**
(`gcorso/DiffDock`, MIT) on torch cu128, and a **`replay`** engine that returns the committed
reference payload with no GPU at all.

> ## ⛔ AutoDock-GPU IS NOT IMPLEMENTED. Read this before planning the day.
>
> Earlier versions of this runbook described "AutoDock-GPU compiled for `sm_120`" as the
> workhorse and the reason the machine exists. **That engine does not exist in this repo.**
>
> `deploy/box/docking/service/docking_service/engines/autodock_gpu.py` is a stub whose `dock()`
> raises `DockingUnavailable` **unconditionally**:
>
> ```python
> class AutoDockGpuEngine:
>     """Deliberately unavailable until native hardware qualification completes."""
>     @staticmethod
>     def require_qualified() -> None:
>         raise DockingUnavailable("AutoDock-GPU is unavailable until hardware qualification is complete")
> ```
>
> `deploy/box/docking/service/tests/test_http_contract.py` asserts that 503. It is intentional,
> not a bug — but it means **selecting `DOCKING_ENGINE=autodock-gpu` makes every dock return
> 503.** `deploy/box/.env.example` shipped that as its default until 2026-08-01; it is now
> `vina`.
>
> **What actually works today:** `vina` (real — 81 + 279 lines that shell out to a Vina binary)
> and `replay`. So arrival day can genuinely complete on **CPU Vina across 32 cores**, which is
> a first-class path, not a workaround — but it is not GPU docking.
>
> **Implementing and qualifying AutoDock-GPU is a separate piece of engineering work**, after
> the cutover. Do not let §7 pass on `replay` and then cut over on `autodock-gpu`.
> **Check what you are running before §9:**
>
> ```bash
> docker compose -f deploy/box/compose.yml exec docking printenv DOCKING_ENGINE
> ```

> **Not the DiffDock NIM container.** It requires an NVIDIA AI Enterprise licence, which the
> owner declined on 2026-07-31 (*"we are not buying nvidia enterprise"*). RTX PRO cards do not
> change that. Do not re-propose NIM and do not price AI Enterprise.

### Grid map cache

`autogrid` maps are per-receptor, CPU-bound and cacheable. Key them by PDB ID under
`/srv/cache`. The first dock against a protein pays for the maps; subsequent ligands do not.
**Record the actual size per receptor in the state file** — the ~60 MB figure in these docs is
an estimate from typical box dimensions and has never been measured.

---

## 6. Ingress — public hostname over HTTPS, firewalled to 83

**Decided 2026-07-29: no VPN, no tunnel.** Earlier drafts floated WireGuard or Tailscale. That
was a suggestion in a compose-file comment which four documents then repeated as though it
were settled. It never was, and it is rejected — it adds a third-party account and a daemon on
both machines to solve a problem TLS already solves.

Production already calls `https://services.asinex.com:8000/docking` across the open internet.
The box replacing it the same way is a true 1:1, and the rollback is putting the Asinex
hostname back.

All of this is on the box; **none of it is on 83**:

1. Every service binds `127.0.0.1` (`BIND_ADDR` in `deploy/box/.env` already defaults to
   that). Nothing publishes itself.
2. **Caddy on `:443`** with a Let's Encrypt certificate for `<BOX_DOMAIN>`, reverse-proxying to
   those loopback ports. One certificate, one open port.
3. The host firewall admits **only 83's IP** to `:443`. That is the allowlist, and it is one
   rule.

**The paths already line up, so the cutover is hostname-only:**

| Today | Box service | Caddy route |
|---|---|---|
| `services.asinex.com:8000/docking` | `POST /docking` on `:8000` | `handle /docking*` (prefix kept) |
| `services.asinex.com:58000/molecular-docking/diffdock/generate` | same path on `:8002` | `handle /molecular-docking/*` |
| `83.229.87.94:8001/convertSTR` | `POST /convertSTR` on `:8001` | `handle /convertSTR*` |
| `151.145.91.17:8000` + `/v1/…` | tanimoto on `:8003` | `handle_path /tanimoto/*` (prefix stripped) |

⚠ **`handle` vs `handle_path` is deliberate and load-bearing.** The first three services expect
their prefix; Tanimoto does not. Swapping one for the other 404s the lot.

---

## 7. Validate docking — this is the gate, not a formality

**Run the script. It is not optional and it is not a diff you can eyeball.**

```bash
node scripts/verify-docking-response.mjs --url https://<BOX_DOMAIN>/docking \
  --pdbid 1cx7 --smiles 'Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C' --save candidate.json
```

**Exit 0 required.** It pushes the payload through both production parsers
(`/api/sanitizedminimalsdf` and the client's `parseSdfData`) and prints the pose table the
dashboard would render.

⚠ **Confirm which engine produced that pass.** `replay` returns the committed reference
payload, so it passes §7 trivially and proves only the plumbing. A pass on `replay` is **not**
evidence that docking works. Check `DOCKING_ENGINE` (see §5) and re-run on `vina` before §9.

**Why a field-by-field diff is not enough.** The two parsers disagree about strictness. A
payload that is chemically perfect and passes any reasonable SDF validator will still render
**nothing** if a property tag is written `> <smiles>` instead of `>  <smiles>` — the server
drops every pose, returns **HTTP 200** with an empty body, and the user gets a receptor with
no ligands, no score, and no error anywhere. [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) §7.

**Three traps a naive acceptance test will hit:**

- **The receptor PDB is not byte-stable.** 1,308 of 2,601 lines differ between two docks of
  the same input — hydrogens are re-placed stochastically each run. **The acceptance test
  cannot be a diff.** Compare heavy atoms.
- **SMILES are stored URL-encoded**, and the cache key matches the encoded form. Re-encoding
  differently is a silent cache miss, which charges the user twice.
- **Red badges are normal.** The UI colours anything at or above −5 red, and every real dock
  production has ever produced scores −4.3 to −4.6. Red is not a regression.

Then judge the chemistry: run the protein/ligand pairs already in `simulation_logs` and
compare against the stored reference docks. **Score parity is not expected** — different
engines and builds differ. Field names and structure must match exactly.

**Decide the `TORSDO` question** ([DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) §3): Asinex
emits tag `TORSDO` with value `"F 5"`, a truncation of AutoDock's `TORSDOF 5`. Either
reproduce the bug, or emit `<TORSDOF>` and change `molstar3d.jsx:52` **in the same release**.
Not one without the other.

Delegate the chemistry judgement to a strong reasoning model with both outputs attached. Do
not delegate the plumbing check — run the script.

---

## 8. Port swap — this repo takes 5173

**Owner's call, 2026-08-01: same day as the cutover.** Do it *after* §7 passes — if the box
services are not good, you never touch the live site at all.

Today (deliberately, since 2026-07-31):

| Port | Unit | What | Reachable |
|---|---|---|---|
| **5173** | `pyxis-vite-legacy` | the original Pyxis (`/root/material-tailwind-dashboard-react`, Vite dev) talking to `chem_beo` on `:3000` | **the public site**, via nginx |
| **5174** | `pyxis-web` | this repo (`/root/pyxis`, Bun + `client/dist`) | loopback only |

Both units are `enabled`, so both survive a reboot. `Conflicts=` was removed — they are on
different ports and must be able to run together.

**Swap the ports. Do not enable or disable anything:**

1. `pyxis-web`: set `Environment=PORT=5173` and **delete the `Environment=BIND_HOST=127.0.0.1`
   line** — it must bind every interface again to be served by nginx.
2. `pyxis-vite-legacy`: move it to 5174. Its `ExecStart` is `npm run dev-vite-only` with no
   port argument, so this needs `-- --port 5174` appending.
3. `systemctl daemon-reload && systemctl restart pyxis-web pyxis-vite-legacy`
4. Confirm: `ss -ltnp | grep -E ':5173|:5174'` shows **bun on 5173** and **node on 5174**.

nginx already proxies `/ → localhost:5173` and never learns anything changed. **No nginx, TLS,
DNS or Stripe change.**

**Rollback is the same swap in reverse**, and the legacy stack stays installed on 5174. Never
delete `/root/material-tailwind-dashboard-react` — it is a different codebase from this repo's
`client/`, not an older copy of it.

### Then retire the legacy stack in stages — 83 has 1 GB of RAM

**Owner's call, 2026-08-01: the swap stays a swap, but the standby does not stay running
forever if it costs performance.** That caveat matters more than it sounds, because 83 is
**2 cores and 1 GB of RAM**, shared with an unrelated production project on `:4000` and a
GROMACS container on `:8000`.

A **Vite dev server is the most expensive process on that machine** — it holds a module graph
in memory, runs esbuild's dependency optimiser, and transforms on demand. Keeping it resident
buys very little, because **the rollback is the code on disk, not the running process.**
Stopping the unit costs only the dev server's cold-start time; it does not cost you the
rollback.

So retire it in stages, measuring between each:

```bash
free -m                       # baseline BEFORE the swap, and after each stage
systemctl status pyxis-vite-legacy --no-pager
```

| Stage | Action | Rollback becomes | When |
|---|---|---|---|
| 1 | Port swap. Both frontends running | swap the ports back — seconds | arrival day |
| 2 | `systemctl stop pyxis-vite-legacy` (leave it **enabled** and installed) | `systemctl start` + swap ports — under a minute | once a real dock, sign-in and Simulation Results have all passed on the new stack |
| 3 | `systemctl disable pyxis-vite-legacy` | edit the unit, enable, start, swap — minutes | after a week of clean running |
| 4 | Retire `pyxis-stripe` on `:3001` | — | separate, deliberate step: every route it serves already exists in `server/index.js` behind auth and rate limiting |

⚠ **Do not skip stage 2 straight to uninstalling anything.** And do not remove
`/root/material-tailwind-dashboard-react` at any stage — stages 2 and 3 stop a *process*; the
directory is what makes them reversible.

**Stage 4 has a dependency worth noticing:** `stripe-server.cjs` is the contact-form backend
for the *legacy* frontend, which proxies `/api` to it. Once the legacy frontend is stopped
(stage 2), nothing reaches `:3001` at all — so stage 4 is safe as soon as stage 2 holds, and
it frees a second Node process.

⚠ **Rolling back re-exposes ~60 unauthenticated `chem_beo` routes** — `/api/sanitizedminimalsdf/<key>`
returns real customer results with no token from the public internet.
[`deploy/chem_beo/01-fixes-and-config.patch`](../deploy/chem_beo/) closes the worst of them and
is written and rehearsed but **unapplied**. Treat a rollback as an emergency measure, not a
resting state. Note that `chem_beo` on `:3000` must keep running through stages 1–3 regardless
— it is the API the legacy frontend talks to.

**Verify before moving on**, because the live site is now this repo: sign in, run a dock, load
Simulation Results, check the Deep Similarity page. Mail, response compression, asset caching,
the PubMed page and the docked-pose overlay all exist only in this version — their appearance
is expected, not a regression.

---

## 9. Cut docking over — one URL at a time

With §8 done, production is this repo's server. **Two of the four knobs are hot; two are not.**
Do not describe the whole cutover as "no restart" — that is true only of the first two.

`getRequestLigandServiceConfig()` resolves the company's **four** `ligandServiceConfig` fields
on every docking request, so those change with **no restart and no redeploy**:

```
PATCH /api/company/ligand-service-config      (owner/admin)
```

`GET` on the same path is readable by any signed-in member, and the Control Panel shows the
four values read-only with a Default/Custom chip each — so anyone can confirm the box is live
without admin rights.

⚠ **`TANIMOTO_API_BASE` and `SDF_CONVERTER_URL` are NOT in `ligandServiceConfig`.** They are
module-scope constants read once at boot (`server/index.js:106-107`), so changing either means
editing `/root/pyxis/server/.env` and `systemctl restart pyxis-web`.

**One field, then verify, then the next:**

| Order | Knob | Set to | Mechanism |
|---|---|---|---|
| 1 | `dockingApiUrl` | `https://<BOX_DOMAIN>/docking` | `PATCH` — **hot, no restart** |
| 2 | `diffdockApiUrl` | `https://<BOX_DOMAIN>/molecular-docking/diffdock/generate` | `PATCH` — **hot, no restart** |
| 3 | `SDF_CONVERTER_URL` | `https://<BOX_DOMAIN>/convertSTR` | **`.env` + restart** |
| 4 | `TANIMOTO_API_BASE` | `https://<BOX_DOMAIN>/tanimoto` | **`.env` + restart.** Only after §10 restores the data |
| — | `catalogApiBase`, `stockApiUrl` | **leave on Asinex.** The catalog needs their compound file for licensing reasons, and live stock cannot be self-hosted at any price | — |

**Verify the credit behaviour between each, not just the response.** Run one dock that
succeeds and one against a nonsense PDB ID. The failing one must return an error and leave the
balance **unchanged**. That is the thing most likely to regress under a new upstream.

**Rollback:** put the Asinex hostname back in the same field (items 1–2 are instant; 3–4 need
the `.env` edited back and a restart). Keep those URLs valid — they are the disaster-recovery
path, and the box has a 1–3 week repair time.

**At this point docking no longer depends on Moscow. That is the project.** Everything below
is consolidation.

---

## 10. Tanimoto — restore the Postgres index onto the box

Oracle's Postgres answers live user traffic today:
`browser → :3000 chem_beo → 151.145.91.17:8000 tonomitosql → Postgres/RDKit`, from the Deep
Similarity page. It is **production data and the only copy** — 2,951,975 molecules, built from
`molsd4.csv`, indexed 2026-03-12.

The dump exists (§2.2) — ⚠ **but only on the owner's Mac, not in git and not on 83.** See §1b;
get it transferred and verify the sha256 after the copy. Restore it on the box and **assert the
row count, not the exit code** — `pg_restore` can exit 0 having restored a schema and no data:

```bash
scripts/verify-tanimoto-restore.sh /path/to/tonomitosql-20260729.dump
```

**Rebuilding from source is not an available fallback.** Nobody knows where `molsd4.csv` is or
whether it still exists. Ask the operator early whether that file survives anywhere; if it
does, a rebuild is a cross-check worth having.

`deploy/box/.env` pins the cartridge image to `Release_2025_03_3` (amd64 `sha256:c7eeff51…`)
rather than `:latest`, because `:latest` is a moving tag that could be rebuilt onto Postgres 18
and the thing it would break is the only copy of three million molecules.

⚠ `tonomitosql`'s Dockerfile has an ARM fallback that installs without `rdkit-pypi`. On x86_64
it should install normally — **verify that branch is not being taken silently**, because it
degrades chemistry to SQL-side validation.

**Do not remove either `tonomitosql` container** until the box answers the same queries
correctly and `/tanimoto/*` has been repointed and checked from a browser.

---

## 11. Remaining services

1. **convertSTR** — repoint `SDF_CONVERTER_URL`. Leave 83's copy in place until the local one
   is proven. (83's has been **down** for some time, which is why DiffDock is broken in
   production today.)
2. **RabbitMQ, then the ADMET worker.** ⚠ **Prerequisite: the box's IP must be on the Atlas
   allowlist.** The worker polls a Mongo job collection (`deploy/box/compose.yml:186` passes it
   `MONGODB_URI`), and nothing about the failure will say so — a non-allowlisted IP is rejected
   with **TLS alert 80**, which reads as a handshake error, not an access error. This is the
   only step in the whole runbook that needs Atlas.

   `services/admet/` currently pulls a **CPU-only torch wheel**. For GPU: base on
   `nvidia/cuda:12.8.x-runtime-ubuntu24.04` and install cu128 torch **before** `admet-ai`, then
   verify **inside the built image**:
   ```bash
   python -c "import torch; print(torch.cuda.is_available())"
   ```
   Installing `admet-ai` after cu128 torch can silently reinstall the CPU wheel via chemprop's
   pins. **That failure never errors — it is just slow forever.**
3. **GROMACS** — needs a `-DGMX_GPU=CUDA` rebuild. The current image is a CPU-only apt build.
4. **Glioblastoma** — the container listens on **5000, not 8000**, and there is no healthcheck,
   so a broken start looks identical to a working one. Curl `/health` through the ingress
   before believing it.

Before rebuilding ADMET or GROMACS from scratch: they ran somewhere once, possibly the owner's
PC, with no surviving record. Ask the operator whether that configuration was ever found.

---

## 12. Oracle decommission — weeks later, and it is a separate engagement

> **This is the only irreversible section.** It happens weeks after arrival day under different
> conditions, and reaching it by momentum from §11 is a mistake. It requires its own go-ahead.

**Two of Oracle's five containers serve production.** `tonomitosql-api-1` and `tonomitosql-db-1`
answer the Deep Similarity page today. The three `medsaas-*` containers are a genuinely
discardable non-prod copy; the two `tonomitosql-*` ones are a service migration, not a cleanup.

Confirm every one of these with the human, explicitly, before starting:

- [ ] Everything in §1–§11 is green
- [ ] **`/tanimoto/*` no longer resolves to `151.145.91.17` from anywhere**, verified from a
      browser and not just from a shell on the box
- [ ] The box has served real production traffic for a period the operator considers
      sufficient — their judgement, not yours
- [ ] Offsite backup exists, or the operator has explicitly accepted proceeding without one
- [ ] The operator has said "proceed with the Oracle decommission" in the current session

Missing any of these? Stop. Then remove containers one at a time, verifying between each, and
leave the owner's unrelated tooling (rule 3) alone.
