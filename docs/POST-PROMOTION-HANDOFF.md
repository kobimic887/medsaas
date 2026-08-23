# Post-promotion operating handoff

**Use this document when the owner has already promoted `oracleNew` (`84.13.81.51`) to
production by changing DNS.** It is the authority for the period after that promotion.

This document does **not** change DNS or authorize any destructive action. Re-confirm DNS
and service identity with live checks at the start of every session. Every copy
(Mac / 84 / 151 / 83 / GitHub): [`WHERE.md`](./WHERE.md).

## Measured 2026-08-21 evening; re-checked 2026-08-23 (re-check before acting)

| Check | Result |
|---|---|
| `app.pyxis-discovery.com` A | **`84.13.81.51`** (`oracleNew`) |
| `app.fin-srv.com` A | **`84.13.81.51`** |
| Public Pyxis product | **Maintained `pyxis-web`** on `:5174` (soft flip 2026-08-23) — title `Pyxis Discovery` (re-fetched 2026-08-23), `DEPLOYED_SHA` `c162b15…` |
| nginx on `84` | `proxy_pass http://127.0.0.1:5174` on `:443` (legacy `:5173` kept for rollback) |
| Side door | nginx **`:8443`** also → `:5174`. Checklist / rollback: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md) |
| Host `83` (`83.229.87.94`) | **Imminent shutdown** (owner 2026-08-21 — not long-lived standby). **Measured:** SSH OK, hostname `chem`, up ~50d, nginx active, listeners `:443`/`:80`, `:5173`, `127.0.0.1:5174`, `:3000`, `:3001`, `:4000`. **Not** on public DNS. Agents: read-only only; do not kill. See § “Before killing `83`”. |

### Paths on `84` (renamed 2026-08-23; do not expect `standby` / `OLD-LIVE` / `chem_beo`)

| Role | Path on `84` | Git remote / identity |
|---|---|---|
| Legacy rollback frontend | `/root/pyxis-ROLLBACK-frontend-5173` | `eitangenis/material-tailwind-dashboard-react` @ `60072cb` |
| Legacy rollback API | `/root/pyxis-ROLLBACK-backend-3000` | `eitangenis/chem_beo` @ `8d1d921` |
| Live maintained (public) | `/root/pyxis-LIVE-5174` | deploy tree (no `.git`); `DEPLOYED_SHA` stamped |
| FinSrv | `/opt/finsrv` | nginx → `:4000` |

`/home/ubuntu` exposes those trees as symlinks (`~/pyxis-ROLLBACK-frontend-5173`,
`~/pyxis-ROLLBACK-backend-3000`, `~/pyxis-LIVE-5174`, `~/finsrv-4000`). On `83` (until
kill) the legacy trees may still use older names (`/root/chem_beo`,
`/root/pyxis-OLD-LIVE-5173`); measure read-only only — do not mutate toward shutdown.

## Owner decisions (2026-08-21 evening + 2026-08-22 flip approval)

See also [`NEXT-SESSION.md`](./NEXT-SESSION.md) § “Owner decisions” and the flip checklist
[`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). Short form for agents landing here first:

- **Public product (2026-08-23):** maintained `:5174` via nginx soft flip. Legacy `:5173`
  trees stay; rollback units **stopped** (still **enabled**) 2026-08-23.
- **Do not polish legacy** — product energy stays on maintained. Emergencies on legacy only
  if rolling back.
- **Flip status:** **executed** (soft flip A + JWT rotate). Stripe webhook **registered** 2026-08-23; checkout smoke open.
  Details: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md).
- **Flip triggers (historical grill):** boss click-test (may include broad scientific paths)
  **or** box arrival (Q17=A, Q22=A+B) — boss path is now the active path.
- **Atlas shared;** fix `simulation_logs` dual-shape in the reader in parallel.
- **On public flip:** rotate JWT (Q13=A); register Stripe webhook after flip (Q14=A). Stripe
  not critical near-term (Q18=B).
- **Legacy teardown:** boss-driven / flexible; no hard N (Q15≈D).
- **Box access:** choose from §1c probe on arrival (Q11=D). Do not buy Tailscale Pro by
  default; separate Tailscale account only if probe needs mesh (Q21 → wait). Park first-shell
  buyer 1-pager until IP/user known (Q12).
- **PubMed:** maintained only; `:5174` 404 ≠ legacy deleting git.
- **Bare Molstar:** empty visit with no handoff is intentional.

### Rollback trees are cleaned in git (2026-08-23)

`:5173` / `:3000` junk deletes + `vite.config.js` / `stripe-server.cjs` hardening are
**committed** on those remotes (`60072cb` / `8d1d921`). Host `.env` stays uncommitted.
Do not `git checkout .` / hard-reset those trees — that would still be wrong if a later
host-only edit appears.

## The role switch

| Host | Post-promotion role | What it must not be confused with |
|---|---|---|
| **`oracleNew` — `84.13.81.51`** | **Live production application host** for every hostname the operator has deliberately pointed at it. Validate this host first. Dual stack: public maintained `:5174`, legacy `:5173` rollback only. | `oracleOld`; it is not the Tanimoto source and is not the Amsterdam box |
| **`83.229.87.94`** | **Imminent shutdown** (owner 2026-08-21). Still measured up as a non-DNS host (nginx + Pyxis/FinSrv listeners) until teardown — **not** a long-lived standby. Keep inventory/runbooks as historical record; agents do not power it off. | The Amsterdam compute box; public production (DNS is on `84`); long-lived failover |
| **`oracleOld` — `151.145.91.17`** | Temporary source for the live Tanimoto/Postgres data and old non-production medsaas stack. | `oracleNew`; this is a different Oracle tenancy, key, workload and data role |
| **Amsterdam GPU box** | Compute-only host for docking, DiffDock, convertSTR, Tanimoto + Postgres/RDKit, GROMACS, ADMET and glioblastoma. Access method chosen from §1c probe on arrival — not Tailscale-by-default. | Neither application host; it does not receive the API or MongoDB Atlas |

The expected DNS promotion is normally:

- `app.pyxis-discovery.com` → `84.13.81.51` for Pyxis;
- `app.fin-srv.com` → `84.13.81.51` for FinSrv, **if that hostname was also promoted**.

Verify each hostname independently. Pyxis and FinSrv use different applications and different
MongoDB Atlas projects. A working Pyxis request does not prove FinSrv's Mongo connection, and
`/api/health` alone is only a process check.

## Before killing `83` (owner checklist)

Agents do **not** shut down or mutate `83`. Owner confirms these on **`84` first**, then kills
`83` out of band:

| Gate | Must be true | Notes (2026-08-21 measure) |
|---|---|---|
| **DNS** | `app.pyxis-discovery.com` and `app.fin-srv.com` A → **`84.13.81.51` only** | Already true for both |
| **Pyxis sole home** | Public `:5174` healthy on `84`; rollback trees on disk; units enabled but **stopped** (2026-08-23) | Already true — Pyxis is live on `84` |
| **FinSrv sole home** | `app.fin-srv.com` serves from `84` (`/opt/finsrv` → `:4000`); authenticated/DB-backed check OK **without** needing `83` | DNS on `84`; confirm FinSrv is not still depending on anything only on `83` |
| **Mirrors / rollback story** | Owner decides post-kill rollback target | After kill there is **no** host-level mirror on `83`. Likely: on-disk trees + timestamped snapshots on **`84` only**. Docs that still say “mirror/`sync`/`rollback` to `83`” need confirmation — see flags below |
| **Backups** | Env/secrets, nginx TLS material if not elsewhere, any FinSrv/Pyxis data that exists only as files on `83` (not Atlas) are copied or confirmed present on `84` / backup store | Atlas stays; host-local files do not |
| **Default URLs** | No production client/server default still points scientific traffic at `83` IPs/ports after kill | e.g. legacy `SDF_CONVERTER_URL` default in this repo historically cited `83` — verify live env on `84` |

**Post-shutdown open question for the owner:** what is the rollback target once `83` is gone —
on-disk legacy trees on `84`, a snapshot tarball, or something else? Do not assume a second VPS.

**Docs flagged** (still contain mirror/`sync`/`rollback`-to-`83` assumptions in body text;
banners updated — prefer this handoff over those sections):
`ARRIVAL-RUNBOOK.md`, `BOX-ARCHITECTURE.md`, `PRODUCTION-83-INVENTORY.md`,
`deploy/83/systemd/README.md`. Archived away from the agent path:
`docs/archive/FRONTEND-QUALITY-PLAN.md`, `docs/archive/NEUROSNAP-BENCHMARK.md`,
`docs/archive/ROLLBACK-BUN-NODE.md`.

## Database rules

- **Pyxis MongoDB Atlas stays exactly where it is.** Users, credits, billing, companies and
  simulation history are not dumped, moved or replaced during this work. The Pyxis services
  on `84` (and historically on `83` until shutdown) intentionally use the same Atlas database.
  Fix `simulation_logs` dual-shape in the **reader** in parallel with the maintained stack
  (owner, 2026-08-21).
- **FinSrv MongoDB is separate.** Validate its own Atlas project/cluster on the one
  application host (`84`); `83` is leftover and not DNS. Never substitute the Pyxis URI.
- **Tanimoto Postgres is different again.** It is the 2,951,975-molecule production index
  currently sourced from `oracleOld`. Restore it to Amsterdam and verify it before retiring
  the old Oracle stack.
- **`oracleOld`'s local `mongo:7` / `medsaas` database was non-production side-project data.**
  Never restore it over Pyxis Atlas. Measured 2026-08-23: no `medsaas`/`mongo` containers,
  no `:27017`; leftover volume only — do **not** start. Volume removal is only in the
  explicit, approved cleanup phase after all migration gates pass.

## What a fresh agent should do

When the owner says:

> Amsterdam box has arrived. Here is its connection information.

and confirms that `84` is already production, the agent should:

1. **Read instructions in this order:** this document, `ARRIVAL-RUNBOOK.md`,
   `BOX-ARCHITECTURE.md`, `CLAUDE.md`, and the current state file. Do not rely on an older
   prompt that says `83` is public.
2. **Ask once for missing operational inputs:** Amsterdam IP/user/domain, SSH access to
   `84`, `83` and `oracleOld`, the Tanimoto dump or a transfer plan, the tonomitosql source or
   image, and runtime secrets supplied securely. Never write secrets into git, chat logs, the
   state file or command output.
3. **Perform read-only identity checks first:** DNS resolution for each production hostname,
   active listeners, systemd state, deployed SHA/build identity, Atlas connectivity, and a
   real authenticated check for both Pyxis and FinSrv. Record which host is actually public.
4. **Do not run the pre-promotion port swap blindly.** The old §8 procedure was for the state
   where `83` was public and `84` was standby. In post-promotion mode, first measure the
   listeners and the reverse proxy on **`84`**. Never move DNS or swap ports merely because §8
   exists. ⚠ Steps that say “make `83` a usable rollback host” / “sync `83`” need **owner
   confirmation after `83` shutdown** — rollback target becomes whatever the owner picks on
   `84` (see § “Before killing `83`”).
5. **Probe Amsterdam before changing it:** architecture, GPU visibility, Docker, disk/RAM,
   outbound network, inbound `443` from the application host, firewall ownership and current
   listeners. Choose the runbook's Caddy branch or reverse-tunnel branch from the measured
   result; do not assume either one.
6. **Build and validate compute services natively on Amsterdam.** Start with real CPU Vina
   docking if AutoDock-GPU is still the documented stub; validate the real service with
   `scripts/verify-docking-response.mjs`. A replay fixture is not sufficient evidence.
7. **Repoint the live production path on `84` first, one service at a time:** docking, then
   DiffDock, then convertSTR, then Tanimoto after its data restore. Verify a real request and
   credit/refund behavior after each change.
8. **Do not plan a fresh “synchronize `83`” pass.** Older wording assumed `83` stayed a
   standby. With imminent shutdown, apply Amsterdam service-link env only on **`84`**. Avoid
   double-PATCHing shared Atlas `ligandServiceConfig`. ⚠ Any remaining “mirror to `83`”
   instruction is stale pending owner confirmation of the post-kill rollback target.
9. **Restore Tanimoto and verify it from the one application host (`84`) through the real Pyxis path.**
   `83` is leftover and not DNS. Check dataset count, similarity search and the Deep Similarity
   page before considering the old Oracle removable.
10. **Leave `oracleOld` intact** until every gate in runbook §12 is green and the owner gives a
    fresh, explicit approval for the exact cleanup. Do not remove its Tanimoto containers,
    leftover Mongo volume, or source during arrival setup. Measured 2026-08-23: no
    `medsaas`/`mongo` containers and no `:27017` — do **not** start Mongo. Leave CLIProxyAPI,
    Crafty and all unrelated owner tooling alone forever.

## Stop conditions

Stop and report the measurement instead of improvising if:

- DNS still points a production hostname at `83` or points different application hostnames at
  different machines unexpectedly;
- `84` cannot reach Pyxis Atlas or FinSrv cannot complete its own authenticated DB-backed check;
- `84` (the one application host) has a different production build/env fingerprint than
  expected; `83` is leftover and not DNS;
- Amsterdam's GPU, ingress, architecture or service health does not match the acceptance test;
- a Tanimoto restore does not return the expected dataset/row count;
- a proposed action would delete data, remove a container/volume, disable a service, alter DNS,
  or change a shared database without explicit approval.

## Canonical arrival prompt after promotion

Paste this into a fresh agent session after supplying connection information:

> `84.13.81.51` (`oracleNew`) is already the live production application host after DNS
> promotion. `83.229.87.94` is **scheduled for imminent shutdown** — still may be reachable
> until teardown, but is **not** a long-lived standby; agents must not shut it down or mutate
> it. `151.145.91.17` (`oracleOld`) is the old Oracle host and temporary Tanimoto source. Do
> not reverse these roles, do not change DNS, and do not touch `oracleOld` destructively.
>
> Read `docs/POST-PROMOTION-HANDOFF.md` (including § “Before killing `83`”), then
> `docs/ARRIVAL-RUNBOOK.md` and `docs/BOX-ARCHITECTURE.md`. Probe `84` and the Amsterdam box
> before changing anything. Choose box access from §1c probe (not Tailscale-by-default). Do not
> blindly execute the pre-promotion §8 port swap: measure `84` listeners first. Validate `84`
> only for application cutovers. Build and verify Amsterdam's compute services, repoint
> docking/DiffDock/convertSTR/Tanimoto one at a time, and keep Asinex URLs as rollback values.
> MongoDB Atlas for Pyxis stays in place; FinSrv uses a separate Atlas project. Soft flip
> executed 2026-08-23 — see `docs/PYXIS-WEB-FLIP.md`; do not re-flip without a new ask.
> Stripe webhook registered 2026-08-23. Do not remove anything from `oracleOld` until all migration
> checks pass and I explicitly approve the exact cleanup commands.
