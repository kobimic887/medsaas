# Pyxis Discovery

Repository name is `medsaas`. User-facing product is **Pyxis Discovery**.

The maintained frontend should stay recognizably Pyxis, deliver the best user
experience, and keep the Amsterdam compute-box cutover simple. That is not a
license to rewrite the product.

Git, Mac↔oracleOld sync, production approval, start mode, and token-conserve live in
`~/.codex/AGENTS.md`. Do not create `LANDMINES.md` here — encode traps in code and
keep this file updated **in the same change** when a path or trap moves.

**Voice:** normal English to the user (full sentences, articles). Not telegram,
not caveman. Cavecrew / compressed formats are internal receipts only. Short by
default; no audit novels unless asked. Do not write “Say word.”

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
  `83` (`83.229.87.94`) is scheduled for shutdown and is **not** production.
  `SDF_CONVERTER_URL` still defaults to `83:8001` in `server/index.js` — leftover,
  not proof `83` is live. Do not change that default without measuring env on `84`.
- Root, `client/`, and `server/` keep both Bun and npm lockfiles. After a dependency
  change run `bun run lockfiles:refresh` and commit both families.

## Conditional docs

Do not open these unless the task is prod, deploy, continuation, or box work.

1. Resolve `app.pyxis-discovery.com` and inspect the working tree when identity matters.
2. If DNS points at oracleNew (`84.13.81.51`), read `docs/POST-PROMOTION-HANDOFF.md`.
3. Otherwise, for box/cutover continuation, read `docs/NEXT-SESSION.md`.
4. For box work, then `docs/ARRIVAL-RUNBOOK.md` and `docs/BOX-ARCHITECTURE.md`.
5. `docs/README.md` is an index. Measure live state. After DNS → `84`, the
   post-promotion handoff outranks older “`83` is production” prose.
6. Roadmap / unclear priority only: `GOAL.md`. Not for a narrow bugfix or API slice.
7. Architecture relationships: global `graphify` skill if `graphify-out/` exists
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

**Use subagents.** Do not do the whole job inline alone. Prefer **1**. Usual
tasks: **maximum 2**. Hard max **3** if really needed. **Never 4–5 / fleets /
“explore everything” swarms.** Cheap / “usage is low” / conserve tokens: still
prefer **1**, not a swarm. Measure/plan is not an excuse for 5 — still **1–2**.

Use the named skill when the trigger fits.

| Trigger | Use |
|---|---|
| Box arrival, cutover prep, arrival readiness | `pyxis-arrival` |
| Express `/api` routes, auth middleware, credits, proxies, 401/403/502 | `pyxis-api-route` |
| Product change that needs client + server + the right test harness | `pyxis-feature-slice` |
| Read-only topology / runbook / deploy-risk / live-identity audit | `pyxis_ops` (Codex) / `pyxis-ops` (Claude) |

Do not spawn `pyxis-ops` for ordinary one-file work.
