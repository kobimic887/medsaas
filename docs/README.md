# docs/

Longer-form reference for Pyxis Discovery. Shared agent instructions:
[`../AGENTS.md`](../AGENTS.md). Product intent: [`../GOAL.md`](../GOAL.md).

> **Current state (2026-08-23):** DNS → **`84.13.81.51`**. Public product = maintained
> **`:5174`** (`pyxis-web`). Rollback units **stopped** (enabled; trees stay). Stripe
> webhook **registered** (checkout smoke still open) — [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). **`83`** = leftover,
> not DNS. Box planned, not ordered or delivered (owner correction 2026-09-06). Atlas shared. Map: [WHERE.md](./WHERE.md).

## Where to start (pick one)

| Situation | Read |
|---|---|
| **Resume the two-agent Simulation search review** | [NEXT-SESSION-SEARCH-REVIEW.md](./NEXT-SESSION-SEARCH-REVIEW.md) |
| **Protein-design research / folding next steps** | [PROTEIN-DESIGN-RESEARCH.md](./PROTEIN-DESIGN-RESEARCH.md) |
| **Where is this copy / leftover?** | [WHERE.md](./WHERE.md) |
| **Any ops / fresh agent** | [POST-PROMOTION-HANDOFF.md](./POST-PROMOTION-HANDOFF.md) |
| **What to do while waiting / owner decisions** | [NEXT-SESSION.md](./NEXT-SESSION.md) |
| **Public flip (executed) / rollback / Stripe-after** | [PYXIS-WEB-FLIP.md](./PYXIS-WEB-FLIP.md) |
| **Box has arrived / cutover day** | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) (after the handoff) |

Topology *why*: [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md). Planned specification:
[BOX-SPEC.md](./BOX-SPEC.md). Docking bytes: [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md).

## Settled decisions (do not re-litigate)

Full table in [NEXT-SESSION.md](./NEXT-SESSION.md) § Owner decisions. Short form:

- Public = maintained `:5174`; legacy `:5173` = rollback only.
- **2026-08-23:** soft flip executed (JWT rotated). Stripe webhook **registered**; checkout smoke still open.
- Do **not** polish legacy unless rolling back.
- Shared Atlas; `simulation_logs` dual-shape in the **reader**; ensure-on-login `companyId`.
- Box access from runbook §1c probe — no Tailscale Pro mandate.
- PubMed on maintained only; bare Molstar restores last result for ~5 min TTL, then empty.
- `chem_beo` hardening patch will **never** be applied; public flip remediates exposure.

## Reference catalog

| Document | Role |
|---|---|
| [WHERE.md](./WHERE.md) | **Authority** — every measured copy (Mac / 84 / 151 / 83 / GitHub / leftovers) |
| [POST-PROMOTION-HANDOFF.md](./POST-PROMOTION-HANDOFF.md) | **Authority** — host roles, `84` paths, before-kill `83`, arrival prompt |
| [NEXT-SESSION.md](./NEXT-SESSION.md) | **Authority** — backlog, owner decisions, do-nots, deploy to `:5174` |
| [PYXIS-WEB-FLIP.md](./PYXIS-WEB-FLIP.md) | **Flip executed 2026-08-23** — rollback + Stripe-after remaining |
| [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) | Box-day sequence (pre-promotion body; handoff overrides host roles; §8 product swap superseded by flip doc when soft-flipping pre-box) |
| [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) | Compute-only topology decision record |
| [BOX-SPEC.md](./BOX-SPEC.md) | Ordered hardware (4× RTX PRO 4000) + VAT checklist |
| [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) | Historical legacy-stack inventory (2026-07-28 on `83`) |
| [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) | 1-click docking request/response ground truth |
| [SECURITY-FINDINGS.md](./SECURITY-FINDINGS.md) | Findings; “fixed” = this repo = public `:5174`; chem_beo never patched |
| [KNOWN-BROWSER-ISSUES.md](./KNOWN-BROWSER-ISSUES.md) | Safari/Molstar WebGL; workarounds |
| [PYXIS-ONLY.md](./PYXIS-ONLY.md) | De-SaaS branding record (applied and public on `:5174`) |
| [CLAUDE-LIFE-SCIENCES.md](./CLAUDE-LIFE-SCIENCES.md) | MCP tools |
| [CI-CD.md](./CI-CD.md) | Repo workflows; deploy.yml ≠ production |
| [STRIPE_LIVE_CUTOVER.md](./STRIPE_LIVE_CUTOVER.md) | Webhook registration — **after** public flip |
| [IMPROVEMENTS.md](./IMPROVEMENTS.md) | Optional backlog (not critical path) |
| [ASINEX-ESHOP-HANDOFF.md](./ASINEX-ESHOP-HANDOFF.md) / [ASINEX-ESHOP-REVERSE-ENGINEERING.md](./ASINEX-ESHOP-REVERSE-ENGINEERING.md) | External catalog/storefront reference |
| [DATA-STOCK-COMPOUNDS.md](./DATA-STOCK-COMPOUNDS.md) | Anna's stock-compound dataset (inspection, import contract, Simulation search integration + env contract) |
| [archive/](./archive/) | Superseded plans (quality roadmap, Neurosnap, Bun↔Node rollback) |

### Deploy trees agents trip on

| Path | Note |
|---|---|
| [`deploy/83/systemd/`](../deploy/83/systemd/) | Unit **pattern** also used on live `84`; directory name is historical |
| [`deploy/chem_beo/`](../deploy/chem_beo/) | Patch record only — **never apply** |
| [`deploy/box/`](../deploy/box/) | Amsterdam images/briefs — none executed until box day |

## Recovering deleted planning

Tag **`docs-archive-2026-08-01`** (e.g. `COMPUTE-BOX-MIGRATION.md`, old NEXT-SESSION log).
Also: `planning-archive`, `saas-surface-v1`.

## Hosts outside this tree

Canonical list: [WHERE.md](./WHERE.md). Short form: `84` live app, `151` Tanimoto +
dev clone, `83` leftover not DNS, Amsterdam not delivered. Host notes:
`~/projects/oracleNew`, `~/projects/oracleOld`.
