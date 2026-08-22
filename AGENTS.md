# Pyxis Discovery working instructions

## Mission and source of truth

Read [`GOAL.md`](GOAL.md) only when the task is roadmap, priority, or unclear scope — not for
narrow bugfixes or API slices. The owner wants the maintained frontend to remain recognizably
Pyxis, deliver the best user experience, and make the Amsterdam compute-box cutover simple. Do
not grow that goal into a general rewrite.

Operational docs (trigger-only — read when the task is prod/deploy/continuation or box work):

1. Resolve `app.pyxis-discovery.com` and inspect the working tree when identity matters.
2. If DNS points at `oracleNew` (`84.13.81.51`), read
   [`docs/POST-PROMOTION-HANDOFF.md`](docs/POST-PROMOTION-HANDOFF.md).
3. Otherwise, for continuation of box/cutover work, read
   [`docs/NEXT-SESSION.md`](docs/NEXT-SESSION.md).
4. For box work, then [`docs/ARRIVAL-RUNBOOK.md`](docs/ARRIVAL-RUNBOOK.md) and
   [`docs/BOX-ARCHITECTURE.md`](docs/BOX-ARCHITECTURE.md).
5. [`docs/README.md`](docs/README.md) is an index only. Measure live state before trusting dated
   status. After DNS → `84`, the handoff file above outranks older “`83` is production” prose.

Architecture/relationship questions: use global `graphify` skill when `graphify-out/` exists;
confirm changed code and operational state directly (graph can be stale).

## Product invariants

- The product is **Pyxis Discovery**. `medsaas` is the repository name, not user-facing branding.
- “De-SaaS” means one-company Pyxis branding. It does **not** mean deleting signup, plans,
  purchasing, billing, roles, companies, credits, or other working product behavior.
- Preserve controls and flows users recognize. Fix how they work; do not remove or relocate them
  unless that is explicitly requested.
- Keep the existing signup/billing surface and scientific workflows. Do not add new tenant or
  billing features without a direct request.
- Reserve API `401` for an invalid/dead session because the client logs out on any `401`.
  Authorization failures are `403`, validation failures `400`, and upstream auth failures `502`.
- Credits are granted server-side from the Stripe webhook, never from the client.

## Architecture

- Bun workspace: `client/` is React 18 + Vite; `server/` is the Express/Bun API; `services/`
  contains scientific services and the MCP server; `deploy/` contains host and box deployment.
- Routes are primarily in `server/index.js`; scientific proxies also use
  `server/routes/scientificServices.js`.
- Client routes live in `client/src/routes.jsx`. Use `API_CONFIG.buildApiUrl()` for `/api/*` and
  `API_CONFIG.buildUrl()` for top-level routes.
- Authentication state comes from `client/src/context/auth.jsx`. Company branding and role checks
  are server-owned; do not trust client-only enforcement.
- MongoDB Atlas remains the production application database. Do not replace it with a local dump.
  Pyxis and FinSrv use separate Atlas projects.
- The Amsterdam box is compute-only: docking, DiffDock, conversion, Tanimoto/Postgres, GROMACS,
  ADMET, and glioblastoma. It does not receive the application API or MongoDB.
- Folding and molecule generation remain hosted NVIDIA services. Do not re-propose NVIDIA NIM / AI
  Enterprise for DiffDock; the selected replacement is OSS DiffDock.
- `oracleOld` (`151.145.91.17`) is a distinct host and temporary Tanimoto source. `oracleNew`
  (`84.13.81.51`) is the live application host (measure DNS). `83.229.87.94`: **scheduled for
  imminent shutdown** (owner 2026-08-21) — do not treat as long-lived standby; still measured up
  until teardown. Before-kill checklist and post-shutdown rollback question:
  [`docs/POST-PROMOTION-HANDOFF.md`](docs/POST-PROMOTION-HANDOFF.md).

## Working method

Follow global `~/.codex/AGENTS.md`. Preserve unrelated dirty work in this often-dirty repo; verify
the actual affected surface (a build alone does not prove a dashboard flow).

## Commands and focused verification

Use Bun by default. Root, `client/`, and `server/` intentionally keep Bun and npm lockfiles; after a
dependency change run `bun run lockfiles:refresh` and commit both families.

```bash
bun run dev               # API + Vite
bun run check             # server compile check + client build
bun run lint
bun run test              # server suite
bun run ci                # full repository gate
```

Choose checks by changed boundary:

- UI or routing: `bun run build` or `bun run check`, the nearest existing `test:*` lifecycle check,
  and one real browser/user path when feasible.
- Server/auth/billing: server compile check plus the nearest focused server test; use the full server
  suite when shared middleware or route plumbing changes.
- Branding: include `bun run test:brand`.
- Docking/box code: use its service-level tests and the real contract verifier documented in
  `docs/DOCKING-CONTRACT.md`; replay fixtures are not arrival evidence.
- Shared configuration, dependency, or release boundary: run `bun run ci` when its broader coverage
  is justified.

Do not stack several overlapping smoke tests around the same assertion. Inspect outputs critically;
loose grep counts and mocked fixtures have produced false confidence here.

## Git and release behavior

- **Git (identical everywhere):** When a meaningful unit of work looks done → commit (no secrets,
  no half-done work, no unrelated dirty files). After that commit → push (non-force), including
  `main`/`master`. Verified ≈ agent judgment; cheap/relevant tests if easy. Git push ≠ prod deploy:
  pushes run CI and do not deploy production; still need explicit approval for oracleNew/84 live
  mutations, billing, DNS/TLS. Never force-push; never commit `.env`/secrets. Plan-only /
  "don't commit" / draft-discard in the user message overrides for that turn.
- Production deployment is manual. Source upload, built `client/dist`, service restart, and deployed
  identity are separate concerns; follow the current runbook rather than reconstructing commands.
- Begin remote work with read-only identity, DNS, listener, service, build, and database checks.
- Obtain explicit approval immediately before a production mutation, DNS/network change, manual
  rollback, destructive cleanup, or removal of an old service/data source. Routine steps inside an
  approved deployment and documented automatic rollback do not need repeated approval.
- On shared hosts, never modify nginx, TLS, DNS, firewall, unrelated applications, or database
  volumes unless the user names and authorizes that exact action.
- Kill only measured PIDs or named units. Never use broad `pkill` patterns.
- Never print, copy into Git, or expose `.env` contents or credentials.

## Available project helpers

- Use the `pyxis-arrival` skill when the box arrives, when preparing its cutover, or when checking
  arrival readiness.
- Use `pyxis-api-route` when adding or changing Express `/api` routes, auth middleware, credit
  metering, proxies, or 401/403/502 behavior.
- Use `pyxis-feature-slice` when a product change needs client + server + the right test harness
  (includes gen-test guidance for `server/test` vs lifecycle scripts).
- Use the Pyxis operations custom agent (`pyxis_ops` in Codex, `pyxis-ops` in Claude) only for a
  read-only topology, runbook, deployment-risk, or live identity audit. Do not spawn it for ordinary
  one-file work.
