# docs/

Reference material for the medsaas / Pyxis Discovery platform. Architecture and commands
live in the repo root [`CLAUDE.md`](../CLAUDE.md); this directory holds the longer-form
docs that would bloat it.

> **Start here, 2026-07-29.** The docs went through several conflicting plans. The settled one is
> **two releases that must not be one day:**
>
> - **Release A — the server swap.** This repo's `server/index.js` + `client/dist` take over
>   port 5173 from the Vite dev server and `chem_beo`. **It needs no new hardware and no nginx
>   change**, so ship it *before* the box arrives. Gated on `scripts/migrate-legacy-users.mjs`
>   and on verifying response shapes while both servers are still live.
> - **Release B — arrival day.** Docking, DiffDock and Tanimoto repoint at the box, one setting
>   at a time. The database, the frontend, nginx, TLS, DNS and Stripe are **not touched.**
>
> If A has not shipped by delivery, defer it and run B against a patched `chem_beo`
> ([`deploy/chem_beo/`](../deploy/chem_beo/)) — apply that patch now regardless; it fixes live
> credit bugs and is the rollback target for A.
>
> Read [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) §2–§3, then ARRIVAL-RUNBOOK's opening
> section. **Anything in an older doc saying the database moves, or that the frontend swap needs
> an nginx change, is stale.**

| Document | What it is | Status |
|---|---|---|
| [BOX-SPEC.md](./BOX-SPEC.md) | **What was ordered and why.** The machine exists because Asinex's servers are in Moscow and go down because of the war. RECT WS-3229C, 2× RTX 5090, €24,727 net — with the reasoning for every line and what was rejected. **Supersedes the machine spec and science-stack scope in COMPUTE-BOX-MIGRATION.** | **configured — one Coreto answer outstanding** |
| [BOX-BEFORE-AFTER.md](./BOX-BEFORE-AFTER.md) | The plain-language version: what runs where today, what runs where afterwards, where every piece of data lives on each side, what a Pyxis user notices, and what happens from first SSH onward. Start here if you want the picture rather than the sequence. | **planning — nothing applied** |
| [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) | **Decision record: what runs where, and why.** API stays on 83 (pick-up warranty means the box will be gone 1–3 weeks someday); box gets all compute; Atlas stays; CloudAMQP goes. §2 is the arrival-day/later split. Supersedes the topology in every other document. | **current — read first, revised 2026-07-29** |
| [deploy/chem_beo/](../deploy/chem_beo/) | **The arrival-day prerequisite.** A patch for the production API: service addresses become environment variables, the credit charge becomes atomic and refundable, the five money/data routes get closed, signup starts producing usable accounts. Verified by running it against the real database. | **written and verified — not yet applied** |
| [scripts/migrate-legacy-users.mjs](../scripts/migrate-legacy-users.mjs) | Brings the 49 legacy user documents up to the shape this repo's server needs. Idempotent, dry-run by default. Gates Release A (the server swap), not hardware day — but it also fixes 47 users who have never been able to run a simulation, so run it now regardless. | **written, dry-run verified — not applied** |
| [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) | **What production actually is** — inventoried over SSH 2026-07-28, read-only. Corrects several claims the other docs make: Mongo is **Atlas** not on 83, the frontend is a **Vite dev server** proxied by nginx, the API is a second HTTPS server on `:3000` bypassing nginx, and 49 of 50 users lack `companyId`. Read before planning any cutover. | **current — contains a blocker** |
| [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) | **The full 1-click docking contract — request (§0), response (§1-§6), and how the response reaches the screen (§7).** Pose format, exact property-tag bytes, the URL-encoded SMILES trap, the `TORSDO`/`"F 5"` truncation artifact, and the silent HTTP-200 failure where a one-space tag difference renders an empty viewer. | **current — §0 and §7 added 2026-07-29** |
| [deploy/box/docking/BRIEF.md](../deploy/box/docking/BRIEF.md) | **Self-contained build brief for the docking service** — hand it to an implementing agent as-is. The full byte-level contract, the exactly-reproducible receptor prep, the recovered search box, the caching design, the engine interface that makes it all testable without a GPU, and an honest assessment of `nvcr.io/hpc/autodock:2020.06`. | **ready to hand off** |
| [deploy/box/docking/reference/](../deploy/box/docking/reference/) | **A real production Asinex response**, `{pdb, sdf}` for `1cx7`. The only ground truth that exists, and the baseline every rebuild is tested against. | **captured** |
| [scripts/verify-docking-response.mjs](../scripts/verify-docking-response.mjs) | **Run before cutting docking over.** Pushes a candidate engine payload through both production parsers byte-for-byte and prints the pose table the dashboard would render. Validated against a real Asinex response. Exit 0 = it reaches the user. | **written and validated** |
| [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) | **Agent-executable.** `execute the plan docs/ARRIVAL-RUNBOOK.md`. Every step with its command, expected output, and what to do on mismatch; hard rules, destructive-step gating, a resumable state file, rollback per phase, and abort conditions. **Phase 5 runs before delivery; hardware day runs 1·2·3·4.3·6·7.** Only **4.1/4.2** (moving the production Mongo) are dead — **4.3, the Tanimoto Postgres copy from Oracle, is mandatory.** Phase numbers are historical, not an order. | **ready to run — revised 2026-07-29** |
| [COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md) | Full trace of every machine, API and compute dependency. Still the best map of *what depends on what*. ⚠ **Its topology and sequencing are superseded** by BOX-ARCHITECTURE — it predates the production inventory and assumes the whole backend and database move to the box. Read it for the dependency trace and the CUDA matrix, not for the plan. | **reference — plan superseded** |
| [PYXIS-ONLY.md](./PYXIS-ONLY.md) | Retiring the SaaS surface: this is one product for one company now. Which frontend wins (with evidence), what goes, what stays, and the archive-don't-delete sequence. | **planning — nothing applied** |
| [CLAUDE-LIFE-SCIENCES.md](./CLAUDE-LIFE-SCIENCES.md) | The ChemBench MCP server: its 14 tools, the four that cannot work until Pile 2 is deployed, how to connect Claude Science, and the ingress it is waiting on. | current |
| [CI-CD.md](./CI-CD.md) | Source of truth for the two repo-owned workflows, the build-on-box deploy model, and required secrets. | current |
| [STRIPE_LIVE_CUTOVER.md](./STRIPE_LIVE_CUTOVER.md) | Steps to move Stripe from test to live keys. | reference |
| [ASINEX-ESHOP-HANDOFF.md](./ASINEX-ESHOP-HANDOFF.md) | What `eitangenis/eShop` is, and how the three distinct Asinex data paths relate. | reference |
| [ASINEX-ESHOP-REVERSE-ENGINEERING.md](./ASINEX-ESHOP-REVERSE-ENGINEERING.md) | Implementable spec extracted from the legacy storefront: pricing table, compound model, search semantics. | reference |
| [SECURITY-FINDINGS.md](./SECURITY-FINDINGS.md) | Recorded security findings and their state. | reference |
| [IMPROVEMENTS.md](./IMPROVEMENTS.md) | Backlog of known improvements. | reference |

## Where the infrastructure notes live

Not everything is in this repo:

- **Oracle VPS `151.145.91.17`** — operations notes are in a separate local repo,
  `~/projects/oracle` (`connection.md`, `services.md`, `router.md`, `maintenance.md`). That
  box runs the medsaas app + Mongo + MCP server, the tonomitosql stack, and unrelated owner
  tooling (CLIProxyAPI, Crafty).
- **tonomitosql** — the Tanimoto/RDKit search API that `TANIMOTO_API_BASE` points at lives
  in its own repo, `kobimic887/tonomitosql`.
- **`83.229.87.94`** — a shared VPS hosting an unrelated project plus the SMILES→SDF
  converter on `:8001`. Its rules ("do not modify nginx, TLS, DNS, firewall") are documented
  in that project, not here.

See [COMPUTE-BOX-MIGRATION.md §2](./COMPUTE-BOX-MIGRATION.md#2-repos-traced) for the full
repo trace, including the two legacy predecessors.
