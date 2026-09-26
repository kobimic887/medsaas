# Pyxis Discovery

Repository name is `medsaas`. User-facing product is **Pyxis Discovery**.

The maintained frontend should stay recognizably Pyxis, deliver the best user
experience, and keep the Amsterdam compute-box cutover simple. That is not a
license to rewrite the product.

Git, Mac↔oracleOld sync, production approval, start mode, and
diagnose-vs-execute live in `~/.codex/AGENTS.md`. Do not create `LANDMINES.md`
here — encode traps in code and keep this file updated **in the same change**
when a path or trap moves.

**Diagnose fully; execute the small slice.**

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
- OpenFold3 request/result normalization lives in `client/src/utils/openfold.js`;
  folding previews use `ProteinFoldViewer.jsx`. Preserve the PDB default for docking
  when extending the shared Molstar message format to mmCIF.
- Folding and molecule generation stay hosted NVIDIA services. DiffDock replacement is
  OSS DiffDock — do not re-propose NVIDIA NIM / AI Enterprise for DiffDock.

## Architecture

- Bun workspace: `client/` React 18 + Vite; `server/` Express/Bun API; `services/`
  scientific + MCP; `deploy/` host and box.
- Routes primarily in `server/index.js`; scientific proxies also in
  `server/routes/scientificServices.js`.
- Simulation sources (catalog, stock, macrocycles, open compounds), pricing and
  checkout: read [the search/checkout contract](.agents/skills/pyxis-feature-slice/references/search-and-checkout.md)
  before changing these flows. Stock/macrocycles are not buyable; missing data
  never falls back to a different source. Catalog checkout re-prices server-side
  from `GET /api/id/{code}`; changed prices require explicit 409 review. Upstream
  `/api4/bas` has no runtime callers. Stock search belongs in Simulation.
- Client routes: `client/src/routes.jsx`. Use `API_CONFIG.buildApiUrl()` for `/api/*`
  and `API_CONFIG.buildUrl()` for top-level routes.
- Auth state: `client/src/context/auth.jsx`. Session logout interceptor:
  `client/src/utils/authInterceptor.js`.
- Amsterdam box is **compute-only** (docking, DiffDock, conversion, Tanimoto/Postgres,
  GROMACS, ADMET, glioblastoma). It does not receive the application API or MongoDB.
- `oracleOld` (`151.145.91.17`) is a distinct host and a temporary Tanimoto source.
  `oracleNew` (`84.13.81.51`) is the **live** application host — measure DNS.
- Owner-test **staging** is the same hostname at `/staging/`: separate loopback
  service `pyxis-web-staging` `:5274` (tree `/root/pyxis-STAGING-5274`), normal
  Mongo-backed app with `PYXIS_STAGING_MODE=true` and `PYXIS_DEMO_MODE=false`.
  Its unit reads the existing production environment in place: accounts,
  history, credits, orders, checkout, providers and Atlas data are **shared
  read/write with production**. The staging build has `/staging/` asset URLs,
  namespaced browser storage and no consumer redirect. Stock uses the same
  tonomitosql dataset; real/virtual macrocycles use a separate loopback index
  `:8274`. Open compounds AI uses a private oracleOld OmniRoute tunnel and
  verified free model; the consumer app's AI remains disabled. Both staging
  units and the AI bridge units are enabled at boot. The external Asinex
  catalog endpoint `dev.asinex.com:58181` refused connections from Mac, 151
  and 84 on 2026-09-24; this affects both apps. The old demo router remains
  only as a rollback option. Contract and rollback: `docs/STAGING.md` and
  `deploy/staging/README.md`.
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

Read only the entry that matches the task; ordinary edits do not require ops runbooks.

1. Resolve `app.pyxis-discovery.com` and inspect the working tree when identity matters.
2. **Where is X / leftover copies:** [`docs/WHERE.md`](docs/WHERE.md) first.
3. If DNS points at oracleNew (`84.13.81.51`), read `docs/POST-PROMOTION-HANDOFF.md`.
4. For box work: `docs/ARRIVAL-RUNBOOK.md` and `docs/BOX-ARCHITECTURE.md`.
5. `docs/README.md` is an index. Measure live state. The post-promotion handoff
   outranks older “`83` is production” prose.
6. Roadmap / unclear priority only: `GOAL.md`. Not for a narrow bugfix or API slice.
7. Architecture relationships: global `graphify` skill if `graphify-out/` exists
   (confirm live facts in files). Docking contract: `docs/DOCKING-CONTRACT.md`.
8. Staging / demo-mode / folding-history work: `docs/STAGING.md` +
   `deploy/staging/README.md` (the current full `/staging/` app shares production
   accounts, Atlas, credits, orders and providers; the older isolated demo is
   rollback only).

## Local development

Start with `git status --short`, then read only the files/docs relevant to the task.
Do not start Mongo to make the app work: application data is Atlas. Existing
`services:up` and `scripts/ensure-dev.mjs` contain stale local-Mongo guidance.
`bun run dev` can invoke `predev`, which creates `.env` when missing. Until that
helper is repaired, prefer `bun run dev:bun` to start both services without the
bootstrap helper; do not create/edit environment files without named approval.
Frontend-only preview: `bun --cwd=client run dev` (API must be available separately).

## Commands

```bash
bun run dev:bun           # API + Vite; avoids legacy predev helper
bun run check             # server compile + client build
bun run lint
bun run test              # server suite
bun run ci                # full gate
bun run test:staging-demo # demo/staging server contract (fixtures, privacy, refusals)
bun run test:staging-simulation # staging Simulation: catalog/search/docking/artifacts against fixture upstreams
bun run test:staging-build # staging client build scoping checks
bun run test:catalog-pricing # checkout catalog re-pricing + stock refusal + pricing lifecycles
bun run test:macrocycle-index # macrocycle index contract: RDKit parity, format-1/2, count stream
bun run test:count-morgan    # count-Morgan support parity vs RDKit + count Tanimoto/Dice math
```

Staging build (never for the live tree): `bun --cwd=client run build:staging`
writes `client/dist` in staging mode — re-run the normal `bun --cwd=client run
build` before packing anything for production.

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
commands from memory. Pushes run CI and do **not** deploy. After a finished
shippable live-app change that actually runs on 84, **ask** whether to deploy
it unless the user already authorized deployment this turn. Docs, skills, hooks
and agent settings have no live artifact and do not require a deploy question.

Begin remote work with read-only identity, DNS, listener, service, build, and database
checks. On shared hosts, never modify nginx, TLS, DNS, firewall, unrelated apps, or
database volumes unless the user names that action. Kill only measured PIDs or named
units — never broad `pkill`.

## Claude automation

`CLAUDE.md` imports this file. `.claude/skills/` links to `.agents/skills/`;
maintain the source, not a duplicate. The post-edit Biome hook lints only the
changed supported source file, never formats or fixes it, and reports diagnostics
as model context. It does not replace the final focused check and does not catch
shell-based edits. The secret-file hook is an authorization reminder for file
editing tools, not a sandbox; global approval/secrecy rules still apply.

## Skills and subagents

Subagent limits: `~/.codex/AGENTS.md` (Skills, subagents, cheap mode). Use the named skill when the trigger fits.

| Trigger | Use |
|---|---|
| Box arrival, cutover prep, arrival readiness | `pyxis-arrival` |
| Express `/api` routes, auth middleware, credits, proxies, 401/403/502 | `pyxis-api-route` |
| Product behavior / Simulation sources / basket or checkout / the right test harness | `pyxis-feature-slice` |
| Explicit coding-box readiness / bun missing / lockfile or local-mongo confusion | `/pyxis-dev-ready` (user-only; normal startup commands are above) |
| Read-only topology / runbook / deploy-risk / live-identity audit | `pyxis_ops` (Codex) / `pyxis-ops` (Claude) |
| Improvements everywhere / vibe coding / agent setup (in this repo) | `mac-oracleold-sync`. Usual: this repo’s product leftovers **and** AGENTS.md / skills / hooks **and** Mac+151 files that serve medsaas. Not FinSrv product, Hermes, or 83-kill. “Agent setups for everything” also covers globals + `finbs` agent files — how in `~/.codex/AGENTS.md`. A product-only ask stays product-only. Recommend 1–2 per type, then implement. |

Do not spawn `pyxis-ops` for ordinary one-file work.

Deployment history and rollback archives live in `docs/POST-PROMOTION-HANDOFF.md`;
never treat a dated release hash as the current live identity.
