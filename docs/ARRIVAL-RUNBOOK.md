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
| ~~`<IPMI_*>`~~ | ⛔ **Do not expect it.** The hosting company controls access and we cannot ask. See **§1c** | — |
| `<83_HOST>` / `<83_USER>` | SSH to `83.229.87.94` | §8 |
| `<BOX_DOMAIN>` | the DNS name the box answers on, for its Let's Encrypt certificate | §6 |
| `<ORACLE_HOST>` / `<ORACLE_USER>` | Oracle's Postgres holds the only copy of the Tanimoto index | §10 |
| **the Tanimoto dump** | 1.2 GB, **not in git** — see §1b | §10 |
| **the `tonomitosql` image or source** | `compose.yml` references `tonomitosql:latest` with **no build context**, and the source is a **separate repo** (`kobimic887/tonomitosql`). Clone and build it, or the Tanimoto service will not start | §10 |
| **Atlas allowlist access** | to add the box's IP. ⚠ **Not needed for §1–§10**; the ADMET worker in §11 polls Mongo and cannot start without it | §11 |
| `.env` values | for the **box's own services** only (`deploy/box/.env.example` is the template). The API's `.env` stays on 83 | §5 |

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
| 2.2 | **`pg_dump` Oracle's Tanimoto Postgres.** An unauthenticated, internet-reachable `DELETE` reaches this dataset, so do not wait for arrival day | ✅ **done 2026-07-29** — `~/backups/tanimoto/tonomitosql-20260729.dump`, 1.2 GB, sha256 verified |
| 2.3 | **Prove that dump actually restores**, with a row count | ⏸ **deferred to the box — §10.** Needs an x86_64 Docker host; the Mac has no container runtime and 83 is a 1 GB production box. **Re-verified 2026-08-01 without one:** `shasum -a 256 -c` passes, the archive header reads `PGDMP` / `tonomitosql` / **17.5 (Debian 17.5-1)**, and the tail is not truncated — so the bytes are intact and the Postgres major matches the pinned cartridge image. What remains unproven is only that `pg_restore` reads it end to end and the row count returns 2,951,975. Oracle is live as a re-dump fallback. **Must still happen before §12**, and §10 runs it |
| 2.4 | **Write the three box services** | ✅ **done** — `deploy/box/docking/service/`, `deploy/box/diffdock/`, `deploy/box/convertstr/`, each with a Dockerfile carrying `test` and `runtime` targets and a pytest suite |
| 2.5 | **Decide the GPU** | ✅ **settled 2026-08-01** — 4× RTX PRO 4000 |
| 2.6 | **Order the machine** | ✅ **ordered 2026-08-01.** [BOX-SPEC.md](./BOX-SPEC.md) §5 is now an invoice/arrival checklist — confirm the ~€5.2k VAT reverse charge was applied |

### Where the amd64 images actually get built

Every image pins `--platform linux/amd64`, and for a long time no host could run them: 83 is
2 cores / 1 GB and is production (an OOM there takes the live site down), and Oracle is arm64
with no `binfmt` emulation. **Owner's call, unchanged: build them on the box.** It is the right
architecture, it is not production, and a native build has no emulation surprises.

⚠ Do not install `binfmt` on Oracle — that is a privileged container on the host holding the
only copy of production Tanimoto Postgres.

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

**Owner's call, 2026-08-01: same day as the cutover, and it stays on arrival day.** It was put
to the owner that this step has no dependency on the box and could ship earlier — it is the
only thing that closes `chem_beo`'s ~60 unauthenticated routes, since that patch will never be
applied. The answer was to keep it here. ⛔ **Do not re-raise it.**

Do it *after* §7 passes — if the box services are not good, you never touch the live site at
all. ⚠ **And get §7 right**, because the rollback path returns to an API with those routes
open, so a botched swap now costs more than a delayed one.

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
