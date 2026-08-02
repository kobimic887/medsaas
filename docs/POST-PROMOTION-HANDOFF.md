# Post-promotion operating handoff

**Use this document when the owner has already promoted `oracleNew` (`84.13.81.51`) to
production by changing DNS.** It is the authority for the period after that promotion.

This document does **not** change DNS, declare that DNS has already changed, or authorize
any destructive action. The operator must confirm the actual DNS and service state with live
checks. Until that confirmation, use the pre-promotion sections of
[`ARRIVAL-RUNBOOK.md`](./ARRIVAL-RUNBOOK.md).

## The role switch

| Host | Post-promotion role | What it must not be confused with |
|---|---|---|
| **`oracleNew` — `84.13.81.51`** | **Live production application host** for every hostname the operator has deliberately pointed at it. Validate this host first. | `oracleOld`; it is not the Tanimoto source and is not the Amsterdam box |
| **`83.229.87.94`** | **Standby / rollback application host**. Keep it synchronized and validate it independently, but do not treat it as the public production host. | The Amsterdam compute box; it remains a shared VPS |
| **`oracleOld` — `151.145.91.17`** | Temporary source for the live Tanimoto/Postgres data and old non-production medsaas stack. | `oracleNew`; this is a different Oracle tenancy, key, workload and data role |
| **Amsterdam GPU box** | Compute-only host for docking, DiffDock, convertSTR, Tanimoto + Postgres/RDKit, GROMACS, ADMET and glioblastoma. | Neither application host; it does not receive the API or MongoDB Atlas |

The expected DNS promotion is normally:

- `app.pyxis-discovery.com` → `84.13.81.51` for Pyxis;
- `app.fin-srv.com` → `84.13.81.51` for FinSrv, **if that hostname was also promoted**.

Verify each hostname independently. Pyxis and FinSrv use different applications and different
MongoDB Atlas projects. A working Pyxis request does not prove FinSrv's Mongo connection, and
`/api/health` alone is only a process check.

## Database rules

- **Pyxis MongoDB Atlas stays exactly where it is.** Users, credits, billing, companies and
  simulation history are not dumped, moved or replaced during this work. The Pyxis services
  on `84` and `83` intentionally use the same Atlas database.
- **FinSrv MongoDB is separate.** Validate its own Atlas project/cluster on both application
  hosts; never substitute the Pyxis URI.
- **Tanimoto Postgres is different again.** It is the 2,951,975-molecule production index
  currently sourced from `oracleOld`. Restore it to Amsterdam and verify it before retiring
  the old Oracle stack.
- **`oracleOld`'s local `mongo:7` / `medsaas` database is non-production side-project data.**
  Never restore it over Pyxis Atlas. It is removed only in the explicit, approved cleanup
  phase after all migration gates pass.

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
   listeners and the reverse proxy on both hosts. Only make the smallest change needed to
   make `83` a usable rollback host; never move DNS or swap ports merely because §8 exists.
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
8. **Synchronize and verify `83` separately.** Apply equivalent service-link configuration to
   the standby without accidentally PATCHing a shared Atlas company document twice. Shared
   `ligandServiceConfig` fields are changed once through the production API; host-local env
   values such as `SDF_CONVERTER_URL` and `TANIMOTO_API_BASE` are changed on each host and
   restarted as required.
9. **Restore Tanimoto and verify it from both application hosts through the real Pyxis path.**
   Check dataset count, similarity search and the Deep Similarity page before considering the
   old Oracle removable.
10. **Leave `oracleOld` intact** until every gate in runbook §12 is green and the owner gives a
    fresh, explicit approval for the exact cleanup. Do not remove its Tanimoto containers,
    local Mongo, volumes or source during arrival setup. Leave CLIProxyAPI, Crafty and all
    unrelated owner tooling alone forever.

## Stop conditions

Stop and report the measurement instead of improvising if:

- DNS still points a production hostname at `83` or points different application hostnames at
  different machines unexpectedly;
- `84` cannot reach Pyxis Atlas or FinSrv cannot complete its own authenticated DB-backed check;
- either application host has a different production build/env fingerprint than expected;
- Amsterdam's GPU, ingress, architecture or service health does not match the acceptance test;
- a Tanimoto restore does not return the expected dataset/row count;
- a proposed action would delete data, remove a container/volume, disable a service, alter DNS,
  or change a shared database without explicit approval.

## Canonical arrival prompt after promotion

Paste this into a fresh agent session after supplying connection information:

> `84.13.81.51` (`oracleNew`) is already the live production application host after DNS
> promotion. `83.229.87.94` is the standby/rollback application host. `151.145.91.17`
> (`oracleOld`) is the old Oracle host and temporary Tanimoto source. Do not reverse these
> roles, do not change DNS, and do not touch `oracleOld` destructively.
>
> Read `docs/POST-PROMOTION-HANDOFF.md`, then `docs/ARRIVAL-RUNBOOK.md` and
> `docs/BOX-ARCHITECTURE.md`. Probe both application hosts and the Amsterdam box before
> changing anything. Do not blindly execute the pre-promotion §8 port swap: measure the
> existing listeners first. Validate `84` first, then synchronize and validate `83`. Build
> and verify Amsterdam's compute services, repoint docking/DiffDock/convertSTR/Tanimoto one
> at a time, and keep Asinex URLs as rollback values. MongoDB Atlas for Pyxis stays in place;
> FinSrv uses a separate Atlas project. Do not remove anything from `oracleOld` until all
> migration checks pass and I explicitly approve the exact cleanup commands.
