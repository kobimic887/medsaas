# Pyxis Discovery

Repository name is `medsaas`. User-facing product is **Pyxis Discovery**.

The maintained frontend should stay recognizably Pyxis, deliver the best user
experience, and keep the Amsterdam compute-box cutover simple. That is not a
license to rewrite the product.

Git, Mac↔oracleOld sync, production approval, start mode, and token-conserve live in
`~/.codex/AGENTS.md`. Do not create `LANDMINES.md` here — encode traps in code and
keep this file updated **in the same change** when a path or trap moves.

**Voice:** `~/.codex/AGENTS.md` (minimal compressed). Pretty English only if asked.

## Invariants

- **“De-SaaS” means one-company Pyxis branding.** It does **not** mean deleting
  signup, plans, purchasing, billing, roles, companies, credits, or other working
  product behavior. Preserve controls users recognize. Do not add tenant/billing
  features without a direct request.
- **`401` is a dead session only.** The client logs out on any same-origin `401`.
  Authorization failures are `403`, validation `400`, upstream auth failures `502`.
- Credits are granted server-side from the Stripe webhook, never from the client.
- Company branding and role checks are server-owned. Do not trust client-only enforcement.
- MongoDB Atlas is the production application database. Do not replace it with a local dump.
  Pyxis and FinSrv use separate Atlas projects.
- Folding and molecule generation stay hosted NVIDIA services. DiffDock replacement is
  OSS DiffDock — do not re-propose NVIDIA NIM / AI Enterprise for DiffDock.

## Architecture

- Bun workspace: `client/` React 18 + Vite; `server/` Express/Bun API; `services/`
  scientific + MCP; `deploy/` host and box.
- Routes primarily in `server/index.js`; scientific proxies also in
  `server/routes/scientificServices.js`.
- Client routes: `client/src/routes.jsx`. Use `API_CONFIG.buildApiUrl()` for `/api/*`
  and `API_CONFIG.buildUrl()` for top-level routes.
- Auth state: `client/src/context/auth.jsx`. Session logout interceptor:
  `client/src/utils/authInterceptor.js`.
- Amsterdam box is **compute-only** (docking, DiffDock, conversion, Tanimoto/Postgres,
  GROMACS, ADMET, glioblastoma). It does not receive the application API or MongoDB.
- `oracleOld` (`151.145.91.17`) is a distinct host and a temporary Tanimoto source.
  `oracleNew` (`84.13.81.51`) is the **live** application host — measure DNS.
  Public Pyxis is systemd + Bun **`pyxis-web` `:5174`** (nginx `:443` → `127.0.0.1:5174`).
  Legacy Vite `:5173` / `chem_beo` `:3000` = rollback on disk (units **stopped**, still
  **enabled**). `83` (`83.229.87.94`) is leftover, **not DNS**, and is **not** production.
  `SDF_CONVERTER_URL` code default is dead `83:8001` (boot warns when unset). Live on
  `84` since 2026-08-23 via interim loopback container `pyxis-convertstr`
  (`http://127.0.0.1:8001/convertSTR`); replace with `https://<box-domain>/convertSTR`
  when the Amsterdam box ingress exists. Do not change the code default without
  measuring env on `84`.
- Root, `client/`, and `server/` keep both Bun and npm lockfiles. After a dependency
  change run `bun run lockfiles:refresh` and commit both families.

## Conditional docs

Do not open these unless the task is prod, deploy, continuation, or box work.

1. Resolve `app.pyxis-discovery.com` and inspect the working tree when identity matters.
2. **Where is X / leftover copies:** [`docs/WHERE.md`](docs/WHERE.md) first.
3. If DNS points at oracleNew (`84.13.81.51`), read `docs/POST-PROMOTION-HANDOFF.md`.
4. Otherwise, for box/cutover continuation, read `docs/NEXT-SESSION.md`.
5. For box work, then `docs/ARRIVAL-RUNBOOK.md` and `docs/BOX-ARCHITECTURE.md`.
6. `docs/README.md` is an index. Measure live state. After DNS → `84`, the
   post-promotion handoff outranks older “`83` is production” prose.
7. Roadmap / unclear priority only: `GOAL.md`. Not for a narrow bugfix or API slice.
8. Architecture relationships: global `graphify` skill if `graphify-out/` exists
   (confirm live facts in files). Docking contract: `docs/DOCKING-CONTRACT.md`.

## Commands

```bash
bun run dev               # API + Vite
bun run check             # server compile + client build
bun run lint
bun run test              # server suite
bun run ci                # full gate
```

Pick the smallest convincing check:

- UI / routing: `build` or `check`, nearest `test:*` lifecycle, one real browser path when feasible.
- Server / auth / billing: compile check + nearest focused server test; full server suite when shared middleware changes.
- Branding: include `bun run test:brand`.
- Docking / box: service-level tests plus the real contract verifier in `docs/DOCKING-CONTRACT.md`.
  Replay fixtures are not arrival evidence.
- Shared config / dependency / release boundary: `bun run ci` when justified.

Loose grep and mocked fixtures have produced false confidence here. A build alone
does not prove a dashboard flow.

## Release

Production deploy is manual. Source upload, built `client/dist`, service restart, and
deployed identity are separate — follow the current runbook; do not reconstruct
commands from memory. Pushes run CI and do **not** deploy.

Begin remote work with read-only identity, DNS, listener, service, build, and database
checks. On shared hosts, never modify nginx, TLS, DNS, firewall, unrelated apps, or
database volumes unless the user names that action. Kill only measured PIDs or named
units — never broad `pkill`.

## Skills and subagents

Subagent limits: `~/.codex/AGENTS.md` (Skills, subagents, cheap mode). Use the named skill when the trigger fits.

| Trigger | Use |
|---|---|
| Box arrival, cutover prep, arrival readiness | `pyxis-arrival` |
| Express `/api` routes, auth middleware, credits, proxies, 401/403/502 | `pyxis-api-route` |
| Product change that needs client + server + the right test harness | `pyxis-feature-slice` |
| Session start / bun missing / lockfile or local-mongo confusion | `pyxis-dev-ready` (user-only) |
| Read-only topology / runbook / deploy-risk / live-identity audit | `pyxis_ops` (Codex) / `pyxis-ops` (Claude) |
| Improvements everywhere / vibe coding / agent setup (in this repo) | `claude-automation-recommender` + `mac-oracleold-sync`. Usual: this repo’s product leftovers **and** AGENTS.md / skills / hooks **and** Mac+151 files that serve medsaas. Not FinSrv product, Hermes, or 83-kill. “Agent setups for everything” also covers globals + `finbs` agent files — how in `~/.codex/AGENTS.md`. A product-only ask stays product-only. Recommend 1–2 per type, then implement. |

Do not spawn `pyxis-ops` for ordinary one-file work.
