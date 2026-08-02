# Arrival runbook

**Invoke with:** `execute the plan docs/ARRIVAL-RUNBOOK.md`

> ## If `oracleNew` is already production
>
> Stop using the pre-promotion assumptions in this file as the starting state. Read
> [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) first. It defines `84.13.81.51`
> (`oracleNew`) as production and `83.229.87.94` as standby after DNS promotion. In that state,
> do **not** blindly execute §8's port swap: measure both hosts first and make only the smallest
> change needed to maintain a verified rollback host. Do not change DNS again, and do not touch
> `oracleOld` destructively until §12's gates and a fresh explicit approval are complete.
>
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

## Host identities — do not collapse the two Oracles

> **State qualifier:** the table below describes the **pre-promotion / arrival-day starting
> state**. If `oracleNew` was promoted to production before the box arrived, the post-promotion
> roles in [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) take precedence. The two
> hosts must still be kept distinct in every state.

There are **two different Oracle machines** in this plan. A fresh clone must keep them separate:

| Name | Address | Role before Amsterdam arrival | Role after the verified arrival cutover |
|---|---|---|---|
| **`oracleOld`** | `151.145.91.17` | Old Oracle: live Tanimoto/Postgres + non-production medsaas containers + unrelated owner tooling | Tanimoto and **all medsaas containers are removed only after the Amsterdam migration is verified**; CLIProxyAPI/Crafty and other unrelated tooling are left alone |
| **`oracleNew`** | `84.13.81.51` | **Intended 1:1 standby clone** of `83` — legacy Pyxis on `:5173`, `chem_beo` on `:3000`, this repo's `pyxis-web` standby on `:5174`, and FinSrv on `:4000` | Receives the **same Pyxis port swap and the same Amsterdam service-link settings as `83`**; remains the synchronized standby/failover host. It is not considered ready until secrets, Atlas access, and database-backed checks pass |

`oracleOld` is the source for the Tanimoto migration. `oracleNew` is **not** the Tanimoto
source and is **not** the Amsterdam compute box. Never use a bare label such as “Oracle” in
commands or notes: say `oracleOld` (`151.145.91.17`) or `oracleNew` (`84.13.81.51`).
Before the Amsterdam cutover, `oracleNew` must remain a legacy clone; do not switch it to
`pyxis-web` early.

The Amsterdam machine is a third, separate host: the **GPU/compute box**. It receives
Tanimoto and the scientific services, but not the API server or the production Mongo database.


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
   `parted`, `dd`, disabling a running service, or anything on `oracleOld` in §12. Quote the exact
   command back and wait for a yes. A previous yes does not authorise the next command.
2. **On `83.229.87.94`: do not modify nginx, TLS, DNS, the firewall, or any other
   application.** It is a shared VPS with an unrelated production project on it. You read from
   it and you copy from it — the one exception is the port swap in §8, which touches only our
   own two systemd units.
3. **The port swap in §8 applies to both application hosts: `83.229.87.94` and
   `oracleNew` (`84.13.81.51`).** They must finish in the same post-cutover state. Do not
   perform it on `oracleNew` before the Amsterdam services and `pyxis-web` validation pass.
4. **On `oracleOld` (`151.145.91.17`): do not touch CLIProxyAPI (`:8317`), Crafty (`:8443`),
   or `~/.cli-proxy-api/auths/`.** Those are the owner's separate tooling. Tanimoto and the
   medsaas containers are removed only in the explicit post-migration cleanup in §12.
5. **Three Mongo/Postgres situations, three different answers. Never let them collapse into one rule.**

   | Database | Where | What happens |
   |---|---|---|
   | Pyxis production Mongo — users, credits, billing, docking history | **MongoDB Atlas** | **stays.** `chem_beo :3000` and `pyxis-web :5174`/`:5173` intentionally use this same Atlas database; never dump or replace it |
   | FinSrv Mongo | **a separate MongoDB Atlas project/cluster** | Stays separate from Pyxis and from both Oracle hosts; verify both FinSrv hosts independently |
   | Tanimoto Postgres — 2,951,975 molecules | **`oracleOld` (`151.145.91.17`)** | **copied to the Amsterdam box** (§10). It is production data and the only live copy until the migration is verified |
   | `oracleOld`'s local Mongo | **`oracleOld` Docker (`mongo:7`, `medsaas` DB)** | Non-production side-project data; never restore it over Atlas; remove the old medsaas stack only in §12 after explicit approval |

   Refusing to copy the Postgres loses three million molecules. Copying `oracleOld`'s local
   Mongo over Atlas would overwrite production with a side project. The two Pyxis services
   sharing the production Atlas database is intentional and required.
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
| ~~`<IPMI_*>`~~ | ⛔ **Do not expect it.** The hosting company controls access and we cannot ask. See **§1c** | — |
| `<83_HOST>` / `<83_USER>` | SSH to `83.229.87.94` | §8 |
| `<ORACLE_NEW_HOST>` / `<ORACLE_NEW_USER>` | SSH to the synchronized Oracle standby `84.13.81.51`; it receives the same port swap as `83` | §8 |
| `<BOX_DOMAIN>` | the DNS name the Amsterdam box answers on, for its Let's Encrypt certificate | §6 |
| `<ORACLE_OLD_HOST>` / `<ORACLE_OLD_USER>` | SSH to `oracleOld` (`151.145.91.17`); its Postgres is the only **live** Tanimoto source until §10 completes | §10, §12 |
| **the Tanimoto dump** | 1.2 GB, **not in git** — see §1b | §10 |
| **the `tonomitosql` image or source** | `compose.yml` references `tonomitosql:latest` with **no build context**, and the source is a **separate repo** (`kobimic887/tonomitosql`). Clone and build it, or the Tanimoto service will not start | §10 |
| **Atlas allowlist access** | to add the box's IP. ⚠ **Not needed for §1–§10**; the ADMET worker in §11 polls Mongo and cannot start without it | §11 |
| `.env` values | for the Amsterdam box's services (`deploy/box/.env.example`) **and for both application hosts**: the Pyxis API env must be present and equivalent on `83` and `oracleNew`; do not assume a source-tree copy includes secrets | §5, §8, §9 |

⚠ **There is no guaranteed way back in.** The box is in a managed building, we do not control
SSH, and we cannot ask them anything. **Read §1c before touching the firewall or sshd** — it
contains the probe that tells you what you actually have, and the deadman switch that makes
the two lockout-capable steps survivable.

**Not needed, and do not ask for them:** Stripe dashboard access (nothing repoints), or an
Atlas connection string for the docking path (it never touches Mongo).

---

## 1b. ⚠ What a fresh clone does NOT have

**This runbook may be executed from a clean clone on a machine that has never seen this
project.** Four things it needs are deliberately not in git. Check all four *before* §3, not
when a step fails.

| Missing | Why it is not in git | How to get it |
|---|---|---|
| **The Tanimoto dump** — 1.2 GB | too large for git | On the owner's Mac at `~/backups/tanimoto/tonomitosql-20260729.dump` (+ `.sha256`), and **nowhere else** — not on 83, not on `oracleOld` in dump form. ⚠ **Ask the operator to transfer it, and re-check the sha256 after the copy** (a truncated copy looks identical in `ls`). Integrity verified 2026-08-01: sha256 matches, header reads `PGDMP`/`tonomitosql`/`17.5`, tail intact. **If the laptop is lost, re-dump `oracleOld`** — it is still live and is the authoritative source, so this is an inconvenience, not a data-loss event |
| **`client/dist`** — the built frontend §8 deploys | build output | `bun run install:all && bun run build`. Needed **before** the port swap, and it is a separate `tar` from the source push |
| **`.env` files** — root, `server/`, and `deploy/box/` | secrets | `.env.example` and `deploy/box/.env.example` are templates. The live Pyxis API env must be present on **both** `/root/pyxis/server/.env` on `83` and `oracleNew`; copy/supply it securely and compare only redacted fingerprints. Never overwrite a production env from a template |
| **DiffDock weights** — 124 MB | model artefact | `deploy/box/diffdock/fetch-weights.sh`, run **once** on the box before first start (§5) |
| **The `tonomitosql` image** | it is a **separate repo**, `kobimic887/tonomitosql` | `deploy/box/compose.yml:153` references `tonomitosql:latest` with **no build context**, so compose will not build it for you. Clone that repo and build the image before §10 |

Everything else the runbook calls — `scripts/verify-docking-response.mjs`,
`scripts/verify-tanimoto-restore.sh`, `deploy/box/docking/service/test.sh`, all three service
source trees, and the systemd units — **is tracked and arrives with the clone.**

⚠ `scripts/verify-tanimoto-restore.sh` defaults to `$HOME/backups/tanimoto/tonomitosql-20260729.dump`
and takes an override as `$1`. On any machine but the owner's it will fail with `no dump at …`
unless you pass the path you copied it to.

---

## 1c. ⚠ We do not control access, and we cannot ask. Probe, then adapt.

**The box sits in a building managed by another company. They control SSH. We probably have no
IPMI, and we cannot ask them questions — what we get is what we get.** (Owner, 2026-08-01.)

An earlier version of this section said *"stop without IPMI"*, and a later one said *"ask the
hosting company these seven questions"*. **Both are void.** You cannot stop and you cannot ask.
So the first thing you do with a shell is **find out what you actually have**, and the plan
bends around the answer.

### Run this the moment you have SSH, before changing anything

```bash
# --- privilege ---
id -u; sudo -n true 2>/dev/null && echo "SUDO: passwordless" || echo "SUDO: none or needs password"

# --- is there a BMC after all? ---
ls /dev/ipmi* 2>/dev/null; sudo dmidecode -t 38 2>/dev/null | head -20   # empty = no IPMI

# --- whose firewall is it? ---
sudo ufw status verbose 2>/dev/null; sudo iptables -S 2>/dev/null | head -30
systemctl is-active firewalld 2>/dev/null

# --- what does the world see us as, and can we even hold :443? ---
curl -s https://ifconfig.me; echo
ip -4 addr show scope global | grep inet          # RFC1918 here = we are behind NAT

# --- outbound: the build needs all three of these ---
curl -sI --max-time 10 https://registry-1.docker.io/v2/ | head -1   # Docker images
curl -sI --max-time 10 https://acme-v02.api.letsencrypt.org/directory | head -1  # ACME
curl -sI --max-time 10 https://github.com | head -1                 # weights, source

# --- who else is on this machine ---
getent passwd | awk -F: '$3>=1000'; sudo ls /root/.ssh/authorized_keys 2>/dev/null && sudo wc -l /root/.ssh/authorized_keys
```

**Then the one test that decides the architecture** — run it *from 83*, not from the box:

```bash
# on the box:  sudo python3 -m http.server 443
# from 83:
curl -sS --max-time 10 http://<BOX_IP>:443/ >/dev/null && echo "INBOUND 443 OK" || echo "INBOUND 443 BLOCKED"
```

Write the result in the state file. **Everything below branches on it, and there is no
default** — owner's call, 2026-08-01: *decide on the day, from what the probe finds.* Neither
branch is a fallback for the other. Do not pre-commit to one while planning; do not treat
Branch B as a defeat if the probe points there.

### Branch A — inbound `:443` reaches the box (the designed path)

Proceed with §6 exactly as written: services on loopback, Caddy on `:443` with a Let's Encrypt
certificate, host firewall admitting only 83. Nothing changes.

### Branch B — inbound is blocked, or the box is behind NAT

**This is survivable and does not need anyone's permission, because outbound almost always
works even when inbound does not.** Invert the direction: the **box dials out to 83** and holds
a persistent tunnel; 83 then talks to a local port as if the services were on localhost.

```bash
# On the BOX, as a systemd unit with Restart=always:
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:8443:127.0.0.1:443 <83_USER>@83.229.87.94
```

83 then points at `https://127.0.0.1:8443/...` instead of `https://<BOX_DOMAIN>/...`, and the
cutover in §9 is the same settings change against a different hostname.

> **This is not a reversal of the "no VPN, no tunnel" decision.** That decision (2026-07-29)
> rejected WireGuard/Tailscale on the grounds that *TLS already solves this* — which assumed we
> control inbound `:443`. **If we do not, the premise is gone and so is the conclusion.** Prefer
> Branch A when the probe says inbound works, Branch B when it does not. **That is the whole
> decision rule** — record which one you used and why.

Trade-offs to accept knowingly: one more moving part; the tunnel must be a `Restart=always`
unit or a dropout takes docking down silently; and `assertConfiguredUrlsArePublic` **would**
reject a `127.0.0.1` URL — but it has a single call site on the admin-UI PATCH path, so set the
loopback URL via `.env`/direct DB update rather than through that form.

### Exactly two steps can lock you out. Deadman-switch both.

- **§5.1** — `UFW default deny` + disabling password auth
- **§6.3** — the firewall rule admitting only 83's IP to `:443`

Nothing else in §1–§12 can cost you the machine; everything else is a container, a file, or a
setting reachable over the session you already have. **Since re-entry now means another
company's ticket queue with no SLA we know of, schedule the undo before you make the change:**

```bash
# 1. BEFORE touching the firewall, schedule a revert 10 minutes out.
sudo systemd-run --on-active=10min --unit=ufw-deadman \
  /bin/sh -c 'ufw --force reset && ufw allow OpenSSH && ufw --force enable'

# 2. Make the risky change.
sudo ufw default deny incoming && sudo ufw allow from <83_IP> to any port 443 && sudo ufw --force enable

# 3. Prove access FROM A SECOND, NEW SSH SESSION. An established TCP connection survives a
#    firewall that would refuse a new one, so testing from your current shell proves nothing.

# 4. Only once the NEW session works, cancel the revert.
sudo systemctl stop ufw-deadman.timer 2>/dev/null; sudo systemctl reset-failed ufw-deadman 2>/dev/null || true
```

**Never close your working session while changing sshd or the firewall.** For `sshd_config`,
same pattern — `sshd -t` catches syntax errors but not "you just locked out your own key".

### Default to touching nothing you do not have to

**If the probe shows a firewall already active and not ours, leave it alone.** The real security
requirement for this box is that its *services* are not open to the internet, and that is
satisfied by binding every service to `127.0.0.1` and putting Caddy in front — which carries
**zero lockout risk**. `ufw default deny` is belt-and-braces on top of that.

**A firewall we did not need is a poor reason to lose a €24k machine to someone else's ticket
queue.** If §5.1 is not clearly ours to make, skip it, record that you skipped it, and move on.

---

## 2. Before the box ships — do these now, they need no hardware

| # | Task | State |
|---|---|---|
| 2.1 | **Capture the docking output contract from Asinex while Moscow still answers.** | ✅ **done 2026-07-28** — [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md). Read it; do not re-derive it |
| 2.2 | **`pg_dump` `oracleOld`'s Tanimoto Postgres.** An unauthenticated, internet-reachable `DELETE` reaches this dataset, so do not wait for arrival day | ✅ **done 2026-07-29** — `~/backups/tanimoto/tonomitosql-20260729.dump`, 1.2 GB, sha256 verified |
| 2.3 | **Prove that dump actually restores**, with a row count | ⏸ **deferred to the Amsterdam box — §10.** Needs an x86_64 Docker host; the Mac has no container runtime and 83 is a 1 GB production box. **Re-verified 2026-08-01 without one:** `shasum -a 256 -c` passes, the archive header reads `PGDMP` / `tonomitosql` / **17.5 (Debian 17.5-1)**, and the tail is not truncated — so the bytes are intact and the Postgres major matches the pinned cartridge image. What remains unproven is only that `pg_restore` reads it end to end and the row count returns 2,951,975. `oracleOld` is live as a re-dump fallback. **Must still happen before §12**, and §10 runs it |
| 2.4 | **Write the three box services** | ✅ **done** — `deploy/box/docking/service/`, `deploy/box/diffdock/`, `deploy/box/convertstr/`, each with a Dockerfile carrying `test` and `runtime` targets and a pytest suite |
| 2.5 | **Decide the GPU** | ✅ **settled 2026-08-01** — 4× RTX PRO 4000 |
| 2.6 | **Order the machine** | ✅ **ordered 2026-08-01.** [BOX-SPEC.md](./BOX-SPEC.md) §5 is now an invoice/arrival checklist — confirm the ~€5.2k VAT reverse charge was applied |

### Where the amd64 images actually get built

Every image pins `--platform linux/amd64`, and for a long time no host could run them: 83 is2 cores / 1 GB and is production (an OOM there takes the live site down), and `oracleOld`/`oracleNew` are arm64 with no `binfmt` emulation. **Owner's call, unchanged: build them on the Amsterdam box.** It is the right
architecture, it is not production, and a native build has no emulation surprises.

⚠ **Do not install `binfmt` on either Oracle host**, and note the objection is **risk, not
capacity**: registering amd64 emulation means running a privileged container on a host that
currently carries production or standby services. `oracleOld` was upgraded to **4 cores /
24 GB** and `oracleNew` is **2 OCPU / 12 GB**; that changes nothing about whether emulation is
wise. Build the Amsterdam images natively on the Amsterdam x86_64 GPU box.

*(A fallback exists: the owner has an x86_64 Windows PC with WSL2 — i7-12700K, RTX 3060 —
which could host these builds and the §2.3 restore proof. **Do not plan around it.** The owner
would rather not use it (2026-08-01), and nothing in this runbook requires it. Raise it only if
something genuinely cannot proceed without an x86_64 host before delivery, and say plainly why.)*

---

## 6. Ingress — public hostname over HTTPS, firewalled to 83

> ⚠ **This section assumes inbound `:443` reaches the box. Run the §1c probe first.** We are in
> a managed building, we do not control the network, and we cannot ask. If inbound is blocked
> or the box is behind NAT, **§1c Branch B** (a box-initiated reverse tunnel to 83) is the
> fallback, and the rest of this section does not apply.

**Decided 2026-07-29, and still preferred where it works: no VPN, no tunnel.** Earlier drafts floated WireGuard or Tailscale. That
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
   rule. ⚠ **The second lockout-capable step** — if this rule is written wrong it can also
   drop your own SSH. Use the **§1c** deadman switch, and make sure the rule scopes to `:443`
   rather than becoming a blanket policy.

**The paths already line up, so the cutover is hostname-only:**

| Today | Box service | Caddy route |
|---|---|---|
| `services.asinex.com:8000/docking` | `POST /docking` on `:8000` | `handle /docking*` (prefix kept) |
| `services.asinex.com:58000/molecular-docking/diffdock/generate` | same path on `:8002` | `handle /molecular-docking/*` |
| `83.229.87.94:8001/convertSTR` | `POST /convertSTR` on `:8001` | `handle /convertSTR*` |
| `oracleOld` (`151.145.91.17:8000`) + `/v1/…` | Tanimoto on `:8003` | `handle_path /tanimoto/*` (prefix stripped) |

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

**Owner's call, 2026-08-01: same day as the cutover, and it stays on arrival day.** It was put
to the owner that this step has no dependency on the box and could ship earlier — it is the
only thing that closes `chem_beo`'s ~60 unauthenticated routes, since that patch will never be
applied. The answer was to keep it here. ⛔ **Do not re-raise it.**

Do it *after* §7 passes — if the Amsterdam box services are not good, you never touch either
live application host. ⚠ **And get §7 right**, because the rollback path returns to an API with
those routes open, so a botched swap now costs more than a delayed one.
Before touching either host, verify that the Pyxis API env and Atlas access are present on both
`83` and `oracleNew`; a copied source tree without `.env` is not a runnable standby.

Today (deliberately, since 2026-07-31):

| Port | Unit | What | Reachable |
|---|---|---|---|
| **5173** | `pyxis-vite-legacy` | the original Pyxis (`/root/material-tailwind-dashboard-react`, Vite dev) talking to `chem_beo` on `:3000` | **the public site**, via nginx |
| **5174** | `pyxis-web` | this repo (`/root/pyxis`, Bun + `client/dist`) | loopback only |

Both units are `enabled`, so both survive a reboot. `Conflicts=` was removed — they are on
different ports and must be able to run together.

**Swap the ports on both application hosts. Do not enable or disable anything:**

Perform the following once on `83.229.87.94` and once on `oracleNew` (`84.13.81.51`). Do not
change `oracleOld` for this step; it is the separate Tanimoto/old-Oracle host.

1. `pyxis-web`: set `Environment=PORT=5173` and **delete the `Environment=BIND_HOST=127.0.0.1`
   line** — it must bind every interface again to be served by nginx.
2. `pyxis-vite-legacy`: move it to 5174. Its `ExecStart` is `npm run dev-vite-only` with no
   port argument, so this needs `-- --port 5174` appending.
3. `systemctl daemon-reload && systemctl restart pyxis-web pyxis-vite-legacy`
4. Confirm on **each host**: `ss -ltnp | grep -E ':5173|:5174'` shows **bun on 5173** and
   **node on 5174**.
5. Confirm the two hosts have the same post-swap service state before changing DNS. `83` is
   the live host; `oracleNew` is the standby/failover clone.

nginx already proxies `/ → localhost:5173` on both hosts and never learns anything changed.
**No nginx, TLS, DNS or Stripe change.** DNS remains unchanged until both hosts pass validation.

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

With §8 done on **both `83` and `oracleNew`**, production on `83` and the synchronized
standby on `oracleNew` are this repo's server. **Two of the four knobs are hot; two are not.**
Do not describe the whole cutover as "no restart" — that is true only of the first two.

Apply the Amsterdam service-link configuration to both application hosts. Change and verify
`83` first; then make the host-local changes on `oracleNew` and verify it independently. The
four `ligandServiceConfig` values live in the shared Atlas company document: PATCH them **once**
through the production API, then confirm the same values are visible from both hosts. Do not
PATCH the shared document twice. Do not point either host at `oracleOld` after the Tanimoto
migration is complete.

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
| 1 | `dockingApiUrl` | `https://<BOX_DOMAIN>/docking` | PATCH the shared Atlas company document **once**, then verify from both hosts |
| 2 | `diffdockApiUrl` | `https://<BOX_DOMAIN>/molecular-docking/diffdock/generate` | PATCH the shared Atlas company document **once**, then verify from both hosts |
| 3 | `SDF_CONVERTER_URL` | `https://<BOX_DOMAIN>/convertSTR` | Set the equivalent host-local `.env` value on **83 and `oracleNew`**, then restart each `pyxis-web` |
| 4 | `TANIMOTO_API_BASE` | `https://<BOX_DOMAIN>/tanimoto` | Set the equivalent host-local `.env` value on **83 and `oracleNew`**, then restart each `pyxis-web`; only after §10 restores the data |
| — | `catalogApiBase`, `stockApiUrl` | **leave on Asinex.** The catalog needs their compound file for licensing reasons, and live stock cannot be self-hosted at any price | — |

**Verify the credit behaviour between each, not just the response.** Run one dock that
succeeds and one against a nonsense PDB ID. The failing one must return an error and leave the
balance **unchanged**. That is the thing most likely to regress under a new upstream.

**Rollback:** put the Asinex hostname back in the shared fields once, then restore the
host-local `.env` values on both `83` and `oracleNew` and restart each `pyxis-web`. Keep those
URLs valid — they are the disaster-recovery path, and the box has a 1–3 week repair time.
Before §12 cleanup, also update the legacy `chem_beo` Tanimoto target on both application hosts
(or explicitly document that legacy rollback no longer includes Tanimoto); otherwise a rollback
to the legacy frontend after deleting `oracleOld` silently loses Deep Similarity.

**At this point docking no longer depends on Moscow. That is the project.** Everything below
is consolidation.

---

## 10. Tanimoto — restore the Postgres index onto the box

`oracleOld`'s Postgres answers live user traffic today:
`browser → :3000 chem_beo → oracleOld (151.145.91.17):8000 tonomitosql → Postgres/RDKit`, from
the Deep Similarity page. It is **production data and the only copy** — 2,951,975 molecules,
built from `molsd4.csv`, indexed 2026-03-12. `oracleOld`'s separate local Mongo (`mongo:7`,
 database `medsaas`) is not this production database and must not be copied into the box.

The dump exists (§2.2) — ⚠ **but only on the owner's Mac, not in git and not on 83.** See §1b;
get it transferred and verify the sha256 after the copy. Restore it on the box and **assert the
row count, not the exit code** — `pg_restore` can exit 0 having restored a schema and no data:

```bash
scripts/verify-tanimoto-restore.sh /path/to/tonomitosql-20260729.dump
```

**Rebuilding from source is not an available fallback.** Nobody knows where `molsd4.csv` is or
whether it still exists. Ask the operator early whether that file survives anywhere; if it
does, a rebuild is a cross-check worth having.

After the Amsterdam copy is restored, verify the Tanimoto API from both `83` and `oracleNew`
through the real Pyxis path—not only with a direct health request. Only then change the
legacy rollback path on both application hosts: replace `chem_beo`'s hardcoded
`http://151.145.91.17:8000` target with the verified Amsterdam Tanimoto endpoint, test the
legacy `/tanimoto/*` routes, and confirm no production path still reaches `oracleOld`.
Do not delete `oracleOld` first and hope the legacy rollback will find the new endpoint.

`deploy/box/.env` pins the cartridge image to `Release_2025_03_3` (amd64 `sha256:c7eeff51…`)
rather than `:latest`, because `:latest` is a moving tag that could be rebuilt onto Postgres 18
and the thing it would break is the only copy of three million molecules.

⚠ `tonomitosql`'s Dockerfile has an ARM fallback that installs without `rdkit-pypi`. On x86_64
it should install normally — **verify that branch is not being taken silently**, because it
degrades chemistry to SQL-side validation.

**Do not remove either `tonomitosql` container from `oracleOld`** until the Amsterdam box
answers the same queries correctly and `/tanimoto/*` has been repointed on both `83` and
`oracleNew`, then checked from a browser. The old Oracle containers are the rollback source
until that verification is complete.

---

## 11. Remaining services

1. **convertSTR** — repoint `SDF_CONVERTER_URL`. Leave 83's copy in place until the local one
   is proven. (83's has been **down** for some time, which is why DiffDock is broken in
   production today.)
2. **RabbitMQ, then the ADMET worker.** ⚠ **Prerequisite: the box's IP must be on the Atlas
   allowlist.** The worker polls a Mongo job collection (`deploy/box/compose.yml:186` passes it
   `MONGODB_URI`), and nothing about the failure will say so — a non-allowlisted IP is rejected
   with **TLS alert 80**, which reads as a handshake error, not an access error.

   **FinSrv is separate.** Its `MONGO_URI` belongs to a different Atlas project/cluster than
   Pyxis. `GET /api/health` is a static process check and does **not** prove Mongo connectivity;
   validate FinSrv with an authenticated database-backed request on both `83` and `oracleNew`
   before calling the standby healthy.

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

## 12. `oracleOld` cleanup — only after Amsterdam migration is verified

> **This is the irreversible cleanup section.** It applies only to `oracleOld` (`151.145.91.17`),
> never to `oracleNew` (`84.13.81.51`) and never to the Amsterdam GPU box. It happens only after
> Tanimoto is live on Amsterdam and both application hosts are verified. It requires its own
> explicit go-ahead in the current session.

⚠ **`oracleOld` was upgraded to 4 cores / 24 GB on 2026-08-01**, so it is a more capable host
than when this section was written and decommissioning it is correspondingly **less urgent**.
The reason to do it eventually is consolidation and one less dependency, not that the machine
is inadequate. It is also still free-tier, so it is not costing anything to leave running.

On `oracleOld`, `tonomitosql-api-1` and `tonomitosql-db-1` serve the production Tanimoto
path today. The separate `medsaas` compose project currently has `medsaas-app-1`,
`medsaas-mcp-server-1`, and `medsaas-mongo-1` stopped; its Mongo is local `mongo:7`, database
`medsaas`, and is **not** the production Pyxis Atlas database. After Amsterdam Tanimoto has
been verified, remove **all medsaas stack artifacts** from `oracleOld`—its containers, local
Mongo volume/data, medsaas images, compose project/source files, and related medsaas-only
artifacts—plus both tonomitosql containers/data, as one explicitly approved cleanup. Do not
remove CLIProxyAPI, Crafty, their data, or any unrelated owner tooling.

Confirm every one of these with the human, explicitly, before starting:

- [ ] Everything in §1–§11 is green
- [ ] **No production path, including the legacy rollback path, resolves to `151.145.91.17`**
      for Tanimoto from either `83` or `oracleNew`; verify from a browser and from both hosts
- [ ] Tanimoto queries, dataset count, similarity search, and the Deep Similarity page pass
      through the Amsterdam box from both application hosts
- [ ] Both `83` and `oracleNew` have the same verified post-arrival port swap and service links
- [ ] The legacy `chem_beo` Tanimoto target on both hosts is updated or the operator has
      explicitly accepted that legacy rollback loses Deep Similarity
- [ ] FinSrv has passed a real authenticated Mongo-backed check on both `83` and `oracleNew`;
      `/api/health` alone is not sufficient
- [ ] The Amsterdam box has served real production traffic for a period the operator considers
      sufficient — their judgement, not yours
- [ ] Offsite backup exists for any data being deleted, or the operator has explicitly accepted
      proceeding without one
- [ ] The operator has said **"proceed with the `oracleOld` cleanup"** in the current session

Before any destructive command, inventory the exact medsaas containers, images, volumes,
compose/source paths, and the two tonomitosql containers on `oracleOld`; show that inventory to
the operator and quote the exact removal commands. Missing any gate? Stop. Once explicitly
approved, remove the medsaas artifacts and Tanimoto artifacts one category at a time,
verifying after each category that CLIProxyAPI, Crafty, and all unrelated owner tooling remain
healthy. `oracleNew` is not part of this cleanup.
