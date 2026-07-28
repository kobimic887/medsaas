# docs/

Reference material for the medsaas / Pyxis Discovery platform. Architecture and commands
live in the repo root [`CLAUDE.md`](../CLAUDE.md); this directory holds the longer-form
docs that would bloat it.

| Document | What it is | Status |
|---|---|---|
| [COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md) | Full trace of every machine, API and compute dependency, and the plan to move the backend onto the Amsterdam GPU box. Includes the CUDA matrix, storage layout, and open decisions. | **planning — nothing applied** |
| [PYXIS-ONLY.md](./PYXIS-ONLY.md) | Retiring the SaaS surface: this is one product for one company now. Which frontend wins (with evidence), what goes, what stays, and the archive-don't-delete sequence. | **planning — nothing applied** |
| [CLAUDE-LIFE-SCIENCES.md](./CLAUDE-LIFE-SCIENCES.md) | The ChemBench MCP server: its 14 tools, the four that cannot work until Pile 2 is deployed, how to connect Claude for Life Sciences, and the ingress it is waiting on. | current |
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
