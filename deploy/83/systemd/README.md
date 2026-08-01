# systemd units for 83.229.87.94

## Why

Every Pyxis process on 83 is hand-started in a foreground shell inside `screen`. **A reboot
ends production until a human logs in.** That has been the machine's longest-standing
operational problem, and it is the one failure mode that takes the product down completely
with no alert and no automatic recovery.

It has already caused visible damage. On 2026-07-29 the box was running **two half-dead
`concurrently` stacks**: one from 2026-07-02, one from 2026-07-08, each started with
`npm run dev`, each having lost one of its two children to `EADDRINUSE` because the other
stack already held the port. Nobody noticed, because the survivors between them happened to
cover both ports.

## What is installed, and what is running

All four units are installed and **enabled**, so all four survive a reboot.

| Unit | Port | What | Live? |
|---|---|---|---|
| `pyxis-vite-legacy` | **5173** | the original Pyxis, a Vite dev server | **yes — this is the public site** |
| `pyxis-api-legacy` | 3000 | `chem_beo`, the legacy API | yes — serves 5173 |
| `pyxis-stripe` | 3001 | `stripe-server.cjs` — the contact form's backend | yes |
| `pyxis-web` | **5174** | this repo's server + `client/dist`, on Bun | yes, but **loopback only** |

⚠ **Corrected 2026-08-01.** This table used to say `pyxis-web` was on 5173 and disabled, that
enabling it *was* the cutover, and that it declared `Conflicts=pyxis-vite-legacy.service`.
All three were true for two days in July and are false now. The owner deliberately rolled
production back to the original Pyxis on **2026-07-31**; `Conflicts=` was **removed** so both
frontends can run side by side on different ports.

`pyxis-web` also carries `Environment=BIND_HOST=127.0.0.1`, because 5174 is not behind nginx
and shares the **production Atlas** database — bound to `0.0.0.0` it published a second live
copy of the app over plain HTTP. Reach it with:

```bash
ssh -N -L 5174:127.0.0.1:5174 root@83.229.87.94
```

## Install

```bash
scp deploy/83/systemd/*.service root@83.229.87.94:/etc/systemd/system/
ssh root@83.229.87.94 'systemctl daemon-reload && systemctl enable \
  pyxis-vite-legacy pyxis-api-legacy pyxis-stripe pyxis-web'
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

## The port swap — arrival day, and the only cutover mechanism

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

**Leave `/root/material-tailwind-dashboard-react` alone, forever.** It is the live site's code
right now, and it is a *different codebase* from this repo's `client/` — Creative Tim template
lineage, not an older version.

**Leave `:3001` running.** The legacy Vite server proxies `/api` to it, so it is the contact
form's backend for the live site. Every route it serves also exists in `server/index.js`
behind authentication and rate limiting, so it becomes redundant *after* the port swap — but
retire it as a separate, deliberate step.

## Logs

`/var/log/pyxis-*.log`. There is no rotation configured; add one before these have been
running for a month.
