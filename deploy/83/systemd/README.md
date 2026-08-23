# systemd units (pattern for live `84`; directory name is historical)

> **2026-08-21+:** Live app host is **`84.13.81.51`**. `83` is **imminent shutdown** (not
> long-lived standby). These unit files are the pattern used on **`84`**; do not install or
> mutate them on `83` toward kill. Before-kill checklist:
> [`docs/POST-PROMOTION-HANDOFF.md`](../../docs/POST-PROMOTION-HANDOFF.md).
> Public = `pyxis-web` `:5174` (soft flip 2026-08-23). Legacy `:5173` = rollback only.
> Units on **`84`**; directory name is historical.

## Why

Historically every Pyxis process on `83` was hand-started in a foreground shell inside
`screen` — **a reboot ended production until a human logged in.** That was the longest-
standing operational failure mode. Units below fixed that; the same pattern runs on live
`84`.

It has already caused visible damage. On 2026-07-29 the box was running **two half-dead
`concurrently` stacks**: one from 2026-07-02, one from 2026-07-08, each started with
`npm run dev`, each having lost one of its two children to `EADDRINUSE` because the other
stack already held the port. Nobody noticed, because the survivors between them happened to
cover both ports.

## What is installed, and what is running

All four units are installed and **enabled**, so all four survive a reboot.

| Unit | Port | What | On live `84` |
|---|---|---|---|
| `pyxis-vite-legacy` | **5173** | the original Pyxis, a Vite dev server | yes — **rollback only** |
| `pyxis-api-legacy` | 3000 | `chem_beo`, the legacy API | yes — serves rollback `:5173` |
| `pyxis-stripe` | 3001 | `stripe-server.cjs` — the contact form's backend | yes — rollback path |
| `pyxis-web` | **5174** | this repo's server + `client/dist`, on Bun | **yes — public site** (nginx `:443`) |

⚠ **Corrected 2026-08-01.** This table used to say `pyxis-web` was on 5173 and disabled, that
enabling it *was* the cutover, and that it declared `Conflicts=pyxis-vite-legacy.service`.
All three were true for two days in July and are false now. The owner deliberately rolled
production back to the original Pyxis on **2026-07-31**; `Conflicts=` was **removed** so both
frontends can run side by side on different ports.

Historical note: the unit file still mentions `BIND_HOST=127.0.0.1`. **Measured 2026-08-22:**
live `pyxis-web` has no `BIND_HOST`; `server/index.js` listens `0.0.0.0`. Public traffic is
nginx `:443` → `127.0.0.1:5174`. Open cleartext `:5174` is hygiene, not the public path.
Tunnel if you need the process off-nginx:

```bash
ssh -N -L 5174:127.0.0.1:5174 ubuntu@84.13.81.51
# only if 83 is still up pre-kill and you need its loopback copy:
# ssh -N -L 5174:127.0.0.1:5174 root@83.229.87.94
```

## Install

Prefer **`84`** (live). Paths and users differ (`ubuntu` + sudo vs historical `root` on `83`).
Do **not** install/enable on `83` as part of shutdown prep unless the owner asks.

```bash
# example shape — measure paths on 84 first
scp deploy/83/systemd/*.service ubuntu@84.13.81.51:/tmp/
ssh ubuntu@84.13.81.51 'sudo cp /tmp/*.service /etc/systemd/system/ && sudo systemctl daemon-reload'
```

To hand a service over without waiting for a reboot, do it one at a time and check the port
between each:

```bash
ss -ltnp | grep :3001                   # note the pid
kill <pid>; sleep 2; ss -ltn | grep :3001 || echo released
systemctl start pyxis-stripe
systemctl status pyxis-stripe --no-pager
```

⚠ **Never `pkill -f "bun index.js"`** — it matches production's own process. Kill by PID.

## The port swap — unused classic recipe (soft flip already ran)

**Public flip used nginx `:443` → `:5174` on 2026-08-23**, not this swap. Keep the steps as
rollback/audit history. Do not re-run them without a new owner ask.

**It is a port swap, not an enable/disable.** Neither unit gets disabled.

1. `pyxis-web`: set `Environment=PORT=5173` and **delete** the `Environment=BIND_HOST=127.0.0.1`
   line — it must bind every interface to be served by nginx.
2. `pyxis-vite-legacy`: append a port flag to `ExecStart`, which passes none today:
   `ExecStart=/usr/bin/npm run dev-vite-only -- --port 5174`
3. `systemctl daemon-reload && systemctl restart pyxis-web pyxis-vite-legacy`
4. Verify: `ss -ltnp | grep -E ':5173|:5174'` shows **bun on 5173**, **node on 5174**.

Rollback is the same swap in reverse. Full context in
[`docs/ARRIVAL-RUNBOOK.md`](../../../docs/ARRIVAL-RUNBOOK.md) §8.

Nothing in nginx, TLS, DNS or Stripe is touched either way: nginx proxies to `localhost:5173`
and never learns which process is behind it.

## After the swap: retire the legacy stack in stages

**83 is 2 cores and 1 GB of RAM**, shared with an unrelated project on `:4000` and a GROMACS
container on `:8000`. A **Vite dev server is the most expensive process on it** — module graph
in memory, esbuild dependency optimiser, on-demand transforms. Keeping it resident as a
standby buys very little, because **the rollback is the code on disk, not the running
process.**

Measure with `free -m` before the swap and after each stage:

| Stage | Action | Rollback becomes |
|---|---|---|
| 1 | Port swap; both running | swap back — seconds |
| 2 | `systemctl stop pyxis-vite-legacy` (leave it **enabled**) | `systemctl start` + swap — under a minute |
| 3 | `systemctl disable pyxis-vite-legacy` | edit unit, enable, start, swap — minutes |
| 4 | Retire `pyxis-stripe` on `:3001` | — |

Stage 4 is safe as soon as stage 2 holds: `:3001` is only reachable through the legacy
frontend's `/api` proxy, so stopping that frontend already orphans it.

⚠ Stages 2 and 3 stop a *process*. **Do not remove `/root/material-tailwind-dashboard-react`
at any stage** — that directory is what makes them reversible.

**Leave the rollback tree alone.** On `84` that is `/root/pyxis-OLD-LIVE-frontend-5173`
(older `83` name may still be `/root/material-tailwind-dashboard-react`). It is a *different
codebase* from this repo's `client/` — Creative Tim template lineage, not an older version.

**Leave `:3001` running** while the rollback Vite tree is kept. Every route it serves also
exists in `server/index.js` behind authentication and rate limiting; retire it as a separate,
deliberate step when the owner stops the rollback frontend.

## Logs

`/var/log/pyxis-*.log`. There is no rotation configured; add one before these have been
running for a month.
