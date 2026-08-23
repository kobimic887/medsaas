# Where Pyxis / medsaas actually lives

**Measured 2026-08-23.** Re-check DNS and `DEPLOYED_SHA` before mutating.
This file is the **location map**. Arrival/ops sequence still starts at
[`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md).

Repo name is `medsaas`. Product is **Pyxis Discovery**. FinSrv is a different
app (`finbs`) on the same `84` host — not this map except where noted.

## One-line roles

| Name | Address | Role |
|---|---|---|
| **This laptop** | `/Users/kobigenis/projects/medsaas` | **Dev source.** Git `main` |
| **oracleNew / 84** | `84.13.81.51` (`ssh oracleNew`) | **Live app host.** DNS for `app.pyxis-discovery.com` |
| **oracleOld / 151** | `151.145.91.17` (`ssh oracleOld`) | Dev clone + **live Tanimoto**. Not the app host |
| **83** | `83.229.87.94` (`ssh 83`) | **Leftover**, not DNS. Do not kill from an agent session |
| **Amsterdam box** | not delivered | Compute-only when it arrives |
| **macmini** | `ssh macmini` / `macmini-ts` | Hermes/Frigate. **No Pyxis tree found** (SSH timed out 2026-08-23) |

DNS `app.pyxis-discovery.com` A → **`84.13.81.51`**. Apex/www `pyxis-discovery.com` is elsewhere (marketing).

## Live (what users hit)

| What | Where | Identity |
|---|---|---|
| Public UI + API | `84` systemd `pyxis-web` → `/root/pyxis-LIVE-5174` | nginx `:443` / `:8443` → `127.0.0.1:5174`. **systemd + Bun, not Docker.** `DEPLOYED_SHA` `7955150…` (gitless deploy tree; auth downloads + panel retry 2026-08-23) |
| Mongo | **MongoDB Atlas** (Pyxis project) | Do not replace with a dump. FinSrv uses a **different** Atlas project |
| convertSTR | `84` docker `pyxis-convertstr` | `127.0.0.1:8001`. Source `/root/pyxis-convertstr-src` |
| Ubuntu shortcuts | `84` `~/pyxis-LIVE-5174` etc. | Symlinks to `/root/…` |
| FinSrv (other product) | `84` `/opt/finsrv` `:4000` | Not Pyxis |

## Dev source (edit here)

| Place | Path | SHA (2026-08-23) |
|---|---|---|
| Mac | `/Users/kobigenis/projects/medsaas` | `main` = `origin/main` (re-check SHA) |
| 151 | `~/projects/medsaas` | same `main` |

Mac ↔ 151: keep these two clones matched. Push is not a prod deploy.

No second Mac worktree. No Mac Docker Pyxis. No LaunchAgent for Pyxis.

## Rollback (keep on disk; not public)

On **84 only** (cleaned in git 2026-08-23; **units stopped 2026-08-23**, still
**enabled**, trees stay — start only if nginx rolls back to `:5173`):

| Tree | Unit / port | Git |
|---|---|---|
| `/root/pyxis-ROLLBACK-frontend-5173` | `pyxis-vite-legacy` `:5173`, `pyxis-stripe` `:3001` | `eitangenis/material-tailwind-dashboard-react` `@60072cb` |
| `/root/pyxis-ROLLBACK-backend-3000` | `pyxis-api-legacy` `:3000` | `eitangenis/chem_beo` `@8d1d921` |

Nginx rollback = `proxy_pass` → `:5173`. Host `.env` stays out of git.
`/root/pyxis-secrets` = env backups (not a source tree).

## Tanimoto (not the web app)

| Place | What |
|---|---|
| 151 docker | `tonomitosql-api-1` `:8000` + `tonomitosql-db-1` (live index) |
| 151 | `~/sql/tonomitosql` compose |
| Mac | `/Users/kobigenis/projects/tonomitosql` (`d04a553`) |
| Mac | `~/backups/tanimoto/tonomitosql-20260729.dump` (laptop copy; Oracle is authoritative) |

`:8000` means **three different things** depending on host: 151 = Tanimoto, 83 = leftover GROMACS, 84 = nothing (convertSTR is `:8001`).

## Leftover 83 (not production)

Same hostname `chem` as 84. Units still **active**. **Not** on public DNS.

| Path | What |
|---|---|
| `/root/pyxis-new-standby-5174` | old maintained; `DEPLOYED_SHA` `b5962da`; loopback `:5174` |
| `/root/pyxis-OLD-LIVE-5173` | Vite `:5173` @ `58ad4cb` (older than 84 rollback) |
| `/root/chem_beo` | API `:3000` @ `3074d8d` (older than 84 rollback) |
| `/root/pyxis-migrate`, `pyxis-backups`, `pyxis-secrets`, `pyxis-rollback-*.tgz` | archive |
| docker `gromacs-api` | `:8000` leftover |
| `/opt/finsrv` | leftover FinSrv, older SHA than 84 |
| `/var/www/app.pyxis-discovery.com` | empty dir |

Do not mutate toward shutdown. Owner kills 83 out of band.

## Archive / do-not-start

| Place | What | Rule |
|---|---|---|
| 151 `~/archive/medsaas-stale-not-git-20260822T184704Z` | old tree + compose, **no git** | Do not treat as source |
| 151 docker `medsaas-app-1`, `medsaas-mongo-1`, `medsaas-mcp-server-1` | **removed 2026-08-23** (`docker rm`, no `-v`) | Do **not** start. Volume `medsaas_mongo-data` left. Local mongo ≠ Atlas |
| 151 image `medsaas:local` + unused network `medsaas_default` | **removed 2026-08-23** (image unused; network had no containers) | Do not recreate. Volume `medsaas_mongo-data` stays |
| 151 `…/STALE.txt` | marker in the no-git archive | Do not treat as source |
| 84 `/var/www/app.pyxis-discovery.com` | **rmdir 2026-08-23** (was empty; nginx never served it) | gone. Rollback: `sudo mkdir` only if something expects the path |
| Cursor/Claude project caches | Mac `Users-kobigenis-projects-medsaas`; 151 `~/.claude/projects/-home-ubuntu-projects-medsaas` | Chat metadata, not a deploy |

## GitHub

**Source of truth for the product:** [kobimic887/medsaas](https://github.com/kobimic887/medsaas).

| Remote | Role |
|---|---|
| `kobimic887/medsaas` | This monorepo (`client/` + `server/` + `services/`) |
| `kobimic887/admet`, `gromacs-api`, `glioblastoma-predictor` | Vendored under `services/` |
| `kobimic887/tonomitosql` | Tanimoto service source (not the app host) |
| `eitangenis/material-tailwind-dashboard-react` | **84 rollback FE** (`:5173` tree; unit **stopped**, enabled) |
| `eitangenis/chem_beo` | **84 rollback API** |
| `kobimic887/material-tailwind-dashboard-react`, `kobimic887/chem_beo` | Extra forks — **diverged decoys**, do not clone. 84 rollback uses the eitangenis remotes |
| `eitangenis/eShop` | ASINEX contract reference only |
| `kobimic887/rdkitapi` | Unrelated leftover name; not the live Tanimoto path |

CI does **not** deploy. Live deploy = `git archive` / `tar` onto `/root/pyxis-LIVE-5174` + `systemctl restart pyxis-web`.

## What is *not* Pyxis

- **finbs** / `app.fin-srv.com` — other product, same `84`.
- macmini Hermes/Frigate — no Pyxis path measured (host unreachable this pass).
- Mac LaunchAgents / Docker — none for Pyxis.
- Downloads — no Pyxis artifacts.

## Confusion to remember

1. **Both 84 and 83 are hostname `chem`.** Measure DNS, not hostname.
2. Same systemd unit *names* on 83 and 84. Only 84 is public.
3. Two gitless `:5174` trees: 84 live `7955150…` vs 83 `b5962da`.
4. `:8000` is not one service.
5. `~/projects/oracleNew` and `~/projects/oracleOld` are **host docs**, not app clones.

Amsterdam compute cutover: [`ARRIVAL-RUNBOOK.md`](./ARRIVAL-RUNBOOK.md) after this map + the handoff.
