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

Installed and **enabled** (they start on boot) but **not started now** — the existing
`screen` processes keep serving until something restarts them, so installing these changes
nothing today and makes a reboot survivable:

| Unit | Port | What |
|---|---|---|
| `pyxis-vite-legacy` | 5173 | the Vite dev server that serves the public site today |
| `pyxis-api-legacy` | 3000 | `chem_beo`, the legacy API |
| `pyxis-stripe` | 3001 | `stripe-server.cjs` — the contact form's backend |

Installed and **disabled**:

| Unit | Port | What |
|---|---|---|
| `pyxis-web` | 5173 | Release A: this repo's server + `client/dist`. Enabling it *is* the cutover |

`pyxis-web` declares `Conflicts=pyxis-vite-legacy.service`, so the two can never both hold
5173 — systemd stops one before starting the other.

## Install

```bash
scp deploy/83/systemd/*.service root@83.229.87.94:/etc/systemd/system/
ssh root@83.229.87.94 'systemctl daemon-reload && systemctl enable \
  pyxis-vite-legacy pyxis-api-legacy pyxis-stripe'
```

Deliberately no `--now`. Starting them while the `screen` processes hold the ports just
produces four more `EADDRINUSE` failures — the exact problem these units exist to end.

To hand a service over without waiting for a reboot, do it one at a time and check the port
between each:

```bash
ss -ltnp | grep :3001                   # note the pid
kill <pid>; sleep 2; ss -ltn | grep :3001 || echo released
systemctl start pyxis-stripe
systemctl status pyxis-stripe --no-pager
```

## Cutover and rollback

```bash
# CUT OVER  (Release A)
systemctl disable --now pyxis-vite-legacy
systemctl enable  --now pyxis-web

# ROLL BACK
systemctl disable --now pyxis-web
systemctl enable  --now pyxis-vite-legacy
```

Nothing in nginx, TLS, DNS or Stripe is touched either way: nginx proxies to `localhost:5173`
and never learns which process is behind it.

**Leave `/root/material-tailwind-dashboard-react` alone, forever.** It is the rollback, and
it is a *different codebase* from this repo's `client/` — Creative Tim template lineage, not
an older version. There is no bundle to preserve; the rollback is that dev server starting.

**Leave `:3001` running.** The legacy Vite server proxies `/api` to it, so it is the contact
form's backend and part of the rollback path. Release A makes it redundant — every route it
serves exists in `server/index.js` behind authentication and rate limiting — but retire it
as a separate, deliberate step.

## Logs

`/var/log/pyxis-*.log`. There is no rotation configured; add one before these have been
running for a month.
