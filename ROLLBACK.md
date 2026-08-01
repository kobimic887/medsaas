# Rollback Guide (OPS-04)

> ## ⚠ This is the *Bun→Node* rollback. It is not the production rollback.
>
> **Production does not run Docker.** `app.pyxis-discovery.com` on `83.229.87.94` runs
> under systemd, deployed by `git archive` + `tar -x`. Nothing below applies to it.
>
> **Corrected 2026-08-01 — this box used to describe the opposite topology and would have
> caused an outage if followed.** It said `pyxis-web` holds port 5173 and `Conflicts=` the
> legacy unit. Both were true until 2026-07-31 and are false now.
>
> **What is actually live:** the owner deliberately rolled production back to the **original
> Pyxis** on 2026-07-31. `pyxis-vite-legacy` holds **5173** and is the public site;
> `pyxis-web` (this repo) is the standby on **5174**, loopback only. `Conflicts=` was
> **removed** so the two can run together. Both units are `enabled`.
>
> **So there is nothing to roll back to — you are already on the fallback.** If the live site
> is broken, it is the legacy stack that is broken, and the fix is forward, not back:
>
> 1. `systemctl status pyxis-vite-legacy pyxis-api-legacy pyxis-stripe` — all three serve the
>    live site. `chem_beo` on `:3000` is the API; `stripe-server.cjs` on `:3001` is the
>    contact form. **Do not kill either.**
> 2. If the legacy frontend is unrecoverable, promote the standby: give `pyxis-web`
>    `PORT=5173`, delete its `BIND_HOST=127.0.0.1` line, move the legacy unit to 5174, then
>    `daemon-reload` and restart both. That is the same port swap as
>    [docs/ARRIVAL-RUNBOOK.md](./docs/ARRIVAL-RUNBOOK.md) §8.
>
> **Never delete `/root/material-tailwind-dashboard-react`.** It is the live site's code and
> a different codebase from this repo's `client/` — not an older copy of it.
>
> ⚠ Running on `:3000` means ~60 unauthenticated `chem_beo` routes are exposed **right now**,
> not hypothetically. See [docs/SECURITY-FINDINGS.md](./docs/SECURITY-FINDINGS.md).

This document describes how to revert to Node if a dependency misbehaves under Bun
in production. Both paths are non-destructive and reversible.

---

## Docker image rollback (one change)

The production image is built from the root `Dockerfile`. Reverting to Node requires
editing that single file:

1. Change both `FROM oven/bun:1.3.14-slim` lines back to `FROM node:22-alpine`.
2. In the frontend stage: change `RUN bun install --frozen-lockfile` back to `RUN npm ci`, and `RUN bun run build` back to `RUN npm run build`.
3. In the api stage: change `RUN bun install --frozen-lockfile --production` back to `RUN npm ci --omit=dev`.
4. Change the final `CMD ["bun", "index.js"]` back to `CMD ["node", "index.js"]`.

The fastest path is a `git revert` of the Dockerfile commit, or a manual swap of the
`FROM` and `CMD` lines. The `COPY --from=frontend /app/client/dist ../client/dist`
line and the `ENV FRONTEND_DIST=../client/dist` setting are runtime-agnostic — they
stay unchanged whether the image is built on Bun or Node.

---

## Script rollback (already available)

The script-level Node fallback shipped in Phases 5–6 via `:node`-suffixed aliases.
No new change is required — running any `:node` alias reverts that operation to Node
without touching the Bun defaults.

**Root-level fallbacks:**

| Script | Reverts |
|---|---|
| `npm run install:all:node` | `bun install` for all workspaces |
| `npm run dev:node` | `bun --watch` server + Vite client |
| `npm run build:node` | `bun run build` (Vite client build) |
| `npm run start:node` | `bun run start` (build + unified server) |
| `npm run check:node` | `bun run check` (syntax check + client build) — added Plan 02 |
| `npm run test:brand:node` | `bun run test:brand` (brand name check) — added Plan 02 |

**Server-level fallbacks (`npm --prefix server run <script>`):**

| Script | Reverts |
|---|---|
| `start:node` | `bun index.js` |
| `start:unified:node` | `FRONTEND_DIST=../client/dist bun index.js` |
| `dev:node` | `bun --watch index.js` |
| `test:stripe:node` | `bun run test:stripe` (webhook smoke test) — added Plan 02 |

---

## When to roll back

If a dependency misbehaves under Bun in production (a risk retained as RUN-04/PKG-02/OPS-04),
revert the Dockerfile as described above and/or switch to the `:node` aliases for affected
operations. Both paths are independent — you can revert only the Docker image while keeping
Bun scripts locally, or vice versa. Neither change destroys the Bun-based setup; the
original state is recoverable with a single `git revert`.
