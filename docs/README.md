# docs/

Reference material for the Pyxis Discovery platform. Architecture and commands live in the
repo root [`CLAUDE.md`](../CLAUDE.md); this directory holds the longer-form docs that would
bloat it.

> ## The state, 2026-08-01
>
> **The GPU box has not been ordered.** Several documents were written as though delivery
> were imminent. They have been corrected — nothing about the box is in the past tense, and
> nothing on it has been executed. **The critical path is a purchase**, not a deployment:
> [BOX-SPEC.md](./BOX-SPEC.md) §5.
>
> **Production serves the ORIGINAL Pyxis, deliberately.** The owner rolled back on
> 2026-07-31 and it stays there until the box arrives.
>
> | Port | Unit | What | Reachable |
> |---|---|---|---|
> | **5173** | `pyxis-vite-legacy` | the original Pyxis (Vite dev) → `chem_beo` on `:3000` | **the public site** |
> | **5174** | `pyxis-web` | this repo (Bun + `client/dist`) → Atlas | loopback only |
>
> **Box day is a port swap, then a settings change** — [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md)
> §8 then §9. Same day, owner's call.
>
> **Decisions that override anything older you read:**
> - **The box is compute only.** The API stays on 83; the database stays in **MongoDB Atlas**
>   and does not move. Nothing on the box opens a Mongo connection.
> - **GPUs are 4× RTX PRO 4000**, settled 2026-08-01. Not 2× RTX 5090.
> - **The box is reached by public hostname over HTTPS.** Caddy on `:443`, services on
>   loopback, firewall admits only 83. **No VPN, no tunnel** — that was one code comment four
>   docs repeated as settled. It never was, and it is rejected.
> - **NVIDIA NIM / AI Enterprise will not be bought.** DiffDock is rebuilt from OSS
>   `gcorso/DiffDock` (MIT). Do not re-propose it.
> - **Folding and molecule generation stay on hosted NIM, permanently.**
> - **"De-SaaS" meant BRANDING, not deleting features.** A 2026-07-29 pass read it the other
>   way and removed sign-up and the plans page. That was wrong and is reverted. What stayed
>   deleted, correctly, is the seven marketing pages (tag `saas-surface-v1`).
>
> **The largest live exposure:** ~60 unauthenticated `chem_beo` routes, on the public site
> right now. `/api/sanitizedminimalsdf/<key>` returns real customer results with no token.
> The fix is written and rehearsed at `deploy/chem_beo/01-fixes-and-config.patch` and is
> **unapplied**.

## Where to start

| I want to… | Read |
|---|---|
| know what to do next | [NEXT-SESSION.md](./NEXT-SESSION.md) |
| buy the machine | [BOX-SPEC.md](./BOX-SPEC.md) §5 |
| run arrival day | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) |
| understand what runs where | [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md), then [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) |
| rebuild docking | [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) and [`deploy/box/docking/BRIEF.md`](../deploy/box/docking/BRIEF.md) |

## Every document

| Document | What it is | Status |
|---|---|---|
| [NEXT-SESSION.md](./NEXT-SESSION.md) | **Start here.** Current production topology, the deploy commands, the one job only the owner can do, eight things that look correct and are not, and what is left in priority order. | **current — the working handoff** |
| [BOX-SPEC.md](./BOX-SPEC.md) | **What to order and why.** The machine exists because Asinex's servers are in Moscow and go down because of the war. RECT WS-3229C, 4× RTX PRO 4000, Threadripper PRO 9975WX. Includes the GPU trade-off in full, the CUDA/workload matrix, and §5 — the four things to settle with Coreto, including ~€5.2k of reclaimable VAT. | **NOT ORDERED — §5 is the critical path** |
| [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) | **Agent-executable, in order.** §1–§12, each with its command, expected output and what to do on mismatch. Hard rules, a resumable state file, per-section rollback. Sections renumbered 2026-08-01 into a real sequence — the old "phase" numbers were explicitly historical and are gone. | **ready to run — needs the box** |
| [BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md) | **Decision record: what runs where, and why.** The API stays on 83 because the box has pick-up warranty (a fault means 1–3 weeks gone), so box dies → docking stops → product survives. Atlas stays. Supersedes the topology in every other document. | **current** |
| [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) | **What production actually is** — inventoried over SSH 2026-07-28, read-only. Corrected several things the other docs assumed: Mongo is **Atlas**, the frontend is a **Vite dev server**, the API is a second HTTPS server on `:3000` bypassing nginx. | **current — measured, not inferred** |
| [DOCKING-CONTRACT.md](./DOCKING-CONTRACT.md) | **The full 1-click docking contract** — request (§0), response (§1–§6), and how it reaches the screen (§7). Pose format, exact property-tag bytes, the URL-encoded SMILES trap, the `TORSDO`/`"F 5"` truncation artifact, and the silent HTTP-200 failure where a one-space tag difference renders an empty viewer. Captured from production while Asinex still answered. | **current — the only ground truth** |
| [SECURITY-FINDINGS.md](./SECURITY-FINDINGS.md) | Recorded findings and their state. ⚠ The "already fixed" table is fixed in *this repo*, which is not what is serving the site right now. Three findings added 2026-08-01. | **current** |
| [PYXIS-ONLY.md](./PYXIS-ONLY.md) | Retiring the SaaS *branding*: one product for one company. Which frontend wins, with evidence. Steps 1/3/4 applied, 2/5 reversed, 6 done. | **applied — but not currently live** |
| [CLAUDE-LIFE-SCIENCES.md](./CLAUDE-LIFE-SCIENCES.md) | The MCP server: its 14 tools, the four that cannot work until the box is up, and how to connect Claude Science. | current |
| [CI-CD.md](./CI-CD.md) | The two repo-owned workflows, the build-on-box deploy model, required secrets. | current |
| [STRIPE_LIVE_CUTOVER.md](./STRIPE_LIVE_CUTOVER.md) | Moving Stripe from test to live keys. ⚠ Related live bug: **no webhook is registered at all**, so real purchases grant no credits. | reference |
| [IMPROVEMENTS.md](./IMPROVEMENTS.md) | Backlog of known improvements. | reference |
| [ASINEX-ESHOP-HANDOFF.md](./ASINEX-ESHOP-HANDOFF.md) | What `eitangenis/eShop` is, and how the three distinct Asinex data paths relate. | reference |
| [ASINEX-ESHOP-REVERSE-ENGINEERING.md](./ASINEX-ESHOP-REVERSE-ENGINEERING.md) | Implementable spec from the legacy storefront: pricing table, compound model, search semantics. | reference |

### Elsewhere in the repo

| Path | What |
|---|---|
| [`deploy/box/`](../deploy/box/) | The box's stack: `compose.yml`, `.env.example`, and the three services — [docking](../deploy/box/docking/), [diffdock](../deploy/box/diffdock/), [convertstr](../deploy/box/convertstr/), each with a Dockerfile carrying `test` and `runtime` targets and a pytest suite. **Never had an execution host** — built on the box, per §5 of the runbook. |
| [`deploy/box/docking/BRIEF.md`](../deploy/box/docking/BRIEF.md) | Self-contained build brief for the docking service. The byte-level contract, reproducible receptor prep, the recovered search box, and the engine interface that makes it testable without a GPU. |
| [`deploy/chem_beo/`](../deploy/chem_beo/) | A patch for the **legacy** production API: service addresses become env vars, the credit charge becomes atomic and refundable, five money/data routes get closed. Verified by running it against the real database. **Written, rehearsed, unapplied** — and `chem_beo` is serving the public site. |
| [`deploy/83/systemd/`](../deploy/83/systemd/) | The four production units, and the staged retirement plan for the legacy stack after the port swap. |
| [`scripts/verify-docking-response.mjs`](../scripts/verify-docking-response.mjs) | **Run before cutting docking over.** Pushes a candidate payload through both production parsers byte-for-byte and prints the pose table the dashboard would render. Exit 0 = it reaches the user. |
| [`scripts/verify-tanimoto-restore.sh`](../scripts/verify-tanimoto-restore.sh) | Restores the Tanimoto dump and **asserts 2,951,975 rows** — `pg_restore` can exit 0 having restored a schema and no data. |

## Deleted, and how to get them back

The 2026-08-01 cleanup removed ~2,400 lines of superseded planning. Everything is at the tag
**`docs-archive-2026-08-01`**:

```bash
git show docs-archive-2026-08-01:docs/COMPUTE-BOX-MIGRATION.md
git checkout docs-archive-2026-08-01 -- docs        # the whole tree
```

| Removed | Why | Where its content went |
|---|---|---|
| `COMPUTE-BOX-MIGRATION.md` (850 lines) | Its plan was explicitly superseded — it predates the production inventory and assumed the whole backend and database move to the box | CUDA/workload matrix → [BOX-SPEC.md](./BOX-SPEC.md) §4 |
| `BOX-BEFORE-AFTER.md` (449 lines) | A planning narrative whose "before" is now measured in PRODUCTION-83-INVENTORY and whose "after" duplicated BOX-ARCHITECTURE | physical-setup and hardware-acceptance steps → [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §3–§4 |
| `NEXT-SESSION.md` historical log (~1,130 lines) | A dated session-by-session log kept below a "this section outranks everything below it" header | — |
| `ARRIVAL-RUNBOOK.md` phases 0, 4.1, 4.2, 5 | Done, dead (the Mongo move), or superseded by the port swap | live parts folded into the new §2 and §8 |

Earlier archive tags: **`planning-archive`** (the 97-file `.planning/` tree),
**`saas-surface-v1`** (the seven marketing pages — the only copy of the macrocycle copy).

## Infrastructure notes that live outside this repo

- **Oracle VPS `151.145.91.17`** — ops notes are in a separate local repo, `~/projects/oracle`.
  ⚠ **Half of it is production:** the `tonomitosql` stack answers the Deep Similarity page via
  eight hardcoded proxy routes in `chem_beo`. Its Postgres holds the **only copy** of a
  2,951,975-molecule index. The three `medsaas-*` containers are genuinely discardable.
- **tonomitosql** — the Tanimoto/RDKit search API that `TANIMOTO_API_BASE` points at, in its
  own repo `kobimic887/tonomitosql`.
- **`83.229.87.94`** — a shared VPS, **2 cores and 1 GB of RAM**, hosting an unrelated project
  on `:4000` alongside all of our production. Its rules — do not modify nginx, TLS, DNS or the
  firewall — are documented in that project, not here.
