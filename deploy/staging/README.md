# Pyxis full staging at `/staging/`

**Live since 2026-09-24:** [https://app.pyxis-discovery.com/staging/](https://app.pyxis-discovery.com/staging/) runs the normal Pyxis application in a separate loopback process on 84. It shares production Atlas, accounts, signing key, history, credits, orders, Stripe, and scientific providers. **Staging actions can change real production data and balances.** The consumer root app has no link or redirect to staging; its service and bundle were unchanged during the switch. The browser uses separate `pxstg__` storage keys, so the same account signs in separately.

Current state and measured evidence: [`docs/STAGING.md`](../../docs/STAGING.md). The old isolated demo mode is retained only as a rollback option.

## Runtime map

| Component | Location | Role |
|---|---|---|
| Public app | 84 `pyxis-web` `:5174` | Consumer site; unchanged by staging release |
| Full staging app | 84 `pyxis-web-staging` `127.0.0.1:5274` | `/staging/` through existing nginx location; enabled at boot |
| Staging tree | 84 `/root/pyxis-STAGING-5274` | Separate source and Vite `--mode staging` bundle |
| Shared environment | 84 `/root/pyxis-LIVE-5174/server/.env` | Read in place by staging systemd unit; do not copy or log |
| Macrocycle search | 84 `pyxis-macrocycle-search-staging` `127.0.0.1:8274` | Separate read-only real and virtual macrocycle indexes; enabled at boot |
| Stock search | oracleOld tonomitosql | Same dataset used by consumer app |
| Free AI proxy | oracleOld `pyxis-open-compounds-ai-proxy` `127.0.0.1:20130` | Injects existing OmniRoute key, allows only verified free model/tool; enabled at boot |
| Private AI tunnel | oracleOld `pyxis-open-compounds-ai-tunnel` → 84 `127.0.0.1:20129` | Reverse SSH; enabled at boot; no OmniRoute key copied to 84 |

`pyxis-web-staging-full.service` is the installed staging unit. It uses `EnvironmentFile=/root/pyxis-LIVE-5174/server/.env` and overrides the stage port, bind address, asset path, base URL, `PYXIS_DEMO_MODE=false`, `PYXIS_STAGING_MODE=true`, and free AI endpoint. The `10-macrocycle-search.conf` drop-in supplies the staging-only index URL. Normal app routes therefore serve real login, history, stock, ChEMBL, folding, checkout and paid actions. Open compounds AI uses `openrouter/openrouter/free` through the local OmniRoute bridge. An AI bridge failure is visible; **Search without AI** remains an explicit option.

The browser build must be `bun --cwd=client run build:staging` and use `/staging/` asset URLs. A normal `bun --cwd=client run build` restores the local production build after transferring staging artifacts. Do not transfer that normal build into the staging tree. Source uploads via `git archive` exclude ignored `.env` files.

## Checks after a staging update

Run the focused repository checks (`bun run check`, `bun run test:staging-build`, `bun run test:simulation-search`, `bun run test:count-morgan`, and `bun --cwd=server run test:open-compounds:bun`) before shipping. On 84, verify only the staging service is restarted and confirm:

```bash
systemctl is-active pyxis-web-staging pyxis-macrocycle-search-staging
curl -fsS http://127.0.0.1:5274/health
curl -fsS http://127.0.0.1:5274/api/staging/status
curl -fsS http://127.0.0.1:8274/v1/datasets   # each dataset lists fingerprint_type + metrics
curl -fsS http://127.0.0.1:20129/health
curl -I https://app.pyxis-discovery.com/staging/
curl -I https://app.pyxis-discovery.com/
```

A format-2 macrocycle index lists `metrics: [tanimoto, count_tanimoto, count_dice]` and needs `<source>.cnt` beside `<source>.fpb`; install the complete `*.fpb`, `*.rows.csv`, `*.cnt`, `*.manifest.json` set or the format check reports that dataset unavailable. A format-1 artifact stays valid and advertises `tanimoto` alone.

The 2026-09-25 count-metric update has a staging-only rollback snapshot at
`/root/pyxis-staging-count-rollback-20260925/` (`staging-before.tgz`,
`index-before/`, and saved frontend bundles). Its real and virtual fingerprint
and row files matched the previous index byte for byte, so only `.cnt` and
`.manifest.json` changed in the deployed index. Restore the saved staging tree
and index files, then restart only `pyxis-web-staging` and
`pyxis-macrocycle-search-staging`. See [`docs/STAGING.md`](../../docs/STAGING.md)
for deployed identities and browser evidence.

`/api/staging/status` must say `demo:false` and `sharedProductionData:true`. Also check a real sign-in, existing history, macrocycle/stock source status, an Open compounds AI search, and the unchanged consumer service PID and bundle SHA. These read-only checks do not prove a completed payment or a paid scientific provider round trip.

The external catalog endpoint `dev.asinex.com:58181` refused connections from Mac, oracleOld and 84 on 2026-09-24. The consumer app still uses that endpoint. The staging Simulation source picker now uses the Pyxis stock and macrocycle indexes plus ChEMBL, so its search does not require the failed supplier catalog. This does not turn the dated exports into verified offers or enable their checkout. See the replacement-catalog gaps in [`docs/STAGING.md`](../../docs/STAGING.md).

## Rollback to the former isolated demo

The pre-switch staging unit and source/frontend archive are at `/root/pyxis-staging-full-rollback-20260924/` on 84. `staging-before.tar` excludes `.env`. Restore the original stage unit and frontend bundle, run `systemctl daemon-reload`, and restart **only** `pyxis-web-staging`. Check `/api/staging/status` returns `demo:true`; disable that older stage unit at boot. Stop and disable both oracleOld AI bridge units if they are no longer needed. Do not restart `pyxis-web`, change DNS/nginx, alter the production env file, or roll back shared Mongo records for a stage code failure.

The old demo used `PYXIS_DEMO_MODE=true`, its own JWT signing secret, in-process history, fixture folding, and refused checkout; these are **not** the current full stage behavior. `pyxis-web-staging.service`, `env.server.template`, `deploy-staging.sh`, and `rollback-staging.sh` are legacy first-install/demo assets. Do not run `rollback-staging.sh` for the full-to-demo rollback: it removes the entire `/staging/` route and tree.

## Nginx trap

The existing `/staging/` location proxies to loopback `:5274`; this switch required no nginx or DNS edit. `/etc/nginx/sites-enabled/app.pyxis-discovery.com` is a symlink into `sites-available/`. If restoring nginx for a separate reason, back up and restore **file content**, not the symlink (`cp -a` would keep pointing at the live file). Pre-staging content backup: `/root/pyxis-staging-nginx-backup.20260907T152427.original`; backup with the `/staging/` block: `/root/pyxis-staging-nginx-backup.20260907T152427.current`.
