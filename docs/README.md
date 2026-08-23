# docs/

Longer-form reference for Pyxis Discovery. Shared agent instructions:
[`../AGENTS.md`](../AGENTS.md). Product intent: [`../GOAL.md`](../GOAL.md).

> **Current state (2026-08-23):** DNS → **`84.13.81.51`**. Public product = maintained
> **`:5174`** (`pyxis-web`, soft flip executed). Legacy `:5173` = rollback only. Stripe
> webhook still pending — [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). **`83`** = imminent
> shutdown. Box ordered, not delivered. Atlas shared. Details: the three files below.

## Where to start (pick one)

| Situation | Read |
|---|---|
| **Any ops / fresh agent** | [POST-PROMOTION-HANDOFF.md](./POST-PROMOTION-HANDOFF.md) |
| **What to do while waiting / owner decisions** | [NEXT-SESSION.md](./NEXT-SESSION.md) |
| **Public flip (executed) / rollback / Stripe-after** | [PYXIS-WEB-FLIP.md](./PYXIS-WEB-FLIP.md) |
| **Box has arrived / cutover day** | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) (after the handoff) |

Topology *why*: [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md). What was ordered:
[BOX-SPEC.md](./BOX-SPEC.md). Docking bytes: [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md).

## Settled decisions (do not re-litigate)

Full table in [NEXT-SESSION.md](./NEXT-SESSION.md) § Owner decisions. Short form:

- Public = maintained `:5174`; legacy `:5173` = rollback only.
- **2026-08-23:** soft flip executed (JWT rotated). Stripe webhook **after** — still open.
- Do **not** polish legacy unless rolling back.
- Shared Atlas; `simulation_logs` dual-shape in the **reader**; ensure-on-login `companyId`.
- Box access from runbook §1c probe — no Tailscale Pro mandate.
- PubMed on maintained only; bare Molstar visit stays empty (by design).
- `chem_beo` hardening patch will **never** be applied; public flip remediates exposure.

## Reference catalog

| Document | Role |
|---|---|
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

- **`84.13.81.51` (`oracleNew`)** — live app host (measure DNS).
- **`83.229.87.94`** — imminent shutdown; read-only until owner kills.
- **`151.145.91.17` (`oracleOld`)** — temporary Tanimoto; ops notes in `~/projects/oracle`.
- Amsterdam GPU box — compute only; access via ARRIVAL §1c probe.
