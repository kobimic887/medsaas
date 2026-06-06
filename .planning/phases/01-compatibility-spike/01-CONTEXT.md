# Phase 1: Compatibility Spike - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove — empirically, before any feature code depends on it — that `node-vibrant` and
`sharp` install and run under **Bun on linux/arm64 inside the `oven/bun` production
container**, and can extract a colour palette from a sample logo. This is a
de-risking spike (COMPAT-01 only), mirroring the v2 spike-before-commit precedent.

**In scope:**
- `bun install` of `node-vibrant` + `sharp` completing without native-binding errors on arm64
- Running an extraction script inside the `oven/bun` arm64 container, exiting 0 with a non-empty palette
- Verifying the palette has the **structure Phase 2 will consume** (dominant + accent), not just truthy output
- Probing whether SVG → palette works in-container (flagged finding, not a gate)
- A documented go/no-go decision before Phase 2 begins

**Out of scope (Phase 2, not here):**
- Upload validation / file-type-and-size rejection (LOGO-03) — this spike tests *library
  format compatibility*, not *upload handling*
- The admin branding-settings page, persistence to MongoDB, dashboard logo display
- Manual palette override / editing
- Production wiring of the library into server routes (spike code is throwaway/reference)

</domain>

<decisions>
## Implementation Decisions

### Spike harness (Claude's discretion — pre-decided)
- **D-01:** Mirror the existing v2 `spike/` pattern rather than inventing a new structure:
  a numbered TypeScript spike script (next in sequence, e.g. `spike/06-vibrant.ts`,
  alongside `05-rdkit.ts`), reusing `spike/Dockerfile.bun` (or a minimal variant) and the
  `spike/run-container-check.sh` container-run harness. Spike code is throwaway/reference —
  it does not need to live in `server/`.
- **D-02:** The image must build and report `arch == arm64` (the v2 harness already asserts
  this via `docker image inspect --format '{{.Architecture}}'`); keep that assertion.

### Input formats / SVG (delegated → decided)
- **D-03:** **Raster (PNG + JPG)** extraction is the go/no-go gate. The spike must prove a
  raster logo → palette inside the container.
- **D-04:** **SVG → palette is a probe, not a gate.** Attempt it in-container. `sharp`'s SVG
  rasterization depends on how libvips was built in `oven/bun:slim` arm64 and is NOT assumed
  to work. Whatever the result, **document it** — a working SVG path is a bonus; a failing one
  is a recorded Phase-2 finding (SVG logos will need pre-rasterization or an alternative path).
  Do not fail the spike on SVG.

### Palette shape (delegated → decided)
- **D-05:** Prove the **structure Phase 2 consumes**, not mere truthiness. The script must
  extract and print a structured palette — at minimum a **dominant colour + accent colour(s)**
  (e.g. node-vibrant's Vibrant / Muted / LightVibrant / DarkVibrant swatches) rendered as hex
  strings — and assert it is non-empty. This closes the gap between success-criterion #1
  ("non-empty palette object") and PALETTE-01 ("dominant + accent").

### Go/no-go recording (delegated → decided)
- **D-06:** Record the decision in a spike findings doc, mirroring v2 (update/extend
  `spike/README.md` and/or a short `spike/VIBRANT-FINDINGS.md`). Must state: install result,
  raster extraction result (with sample palette output), SVG probe result, image arch, and a
  clear **GO / NO-GO** verdict.
- **D-07:** **PASS criteria:** container exits 0 with a non-empty *structured* palette
  (dominant + accent hex) from a raster logo, AND `bun install` of `node-vibrant` + `sharp`
  completes with no native-binding errors on arm64.
- **D-08:** **On NO-GO** (raster path fails under Bun/arm64): do not pre-pick a fallback now —
  surface alternatives (e.g. other extraction libs, or pre-rasterize+quantize) and re-decide
  before Phase 2. The fallback choice is a contingency, not a decision to make blind.

### Claude's Discretion
- Exact spike file naming, sample-logo sourcing (a small checked-in raster fixture + a small
  SVG fixture; a synthetic generated image is acceptable if no suitable real asset exists),
  and whether to fold the new check into `run-container-check.sh` or add a sibling script.
- Library versions and whether `node-vibrant` v3 (browser/`@vibrant/*` modular) vs v4 — the
  researcher should confirm the current Bun-compatible release and import shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria (3), COMPAT-01 mapping
- `.planning/REQUIREMENTS.md` — COMPAT-01 statement (Compatibility section); LOGO-01
  (PNG/JPG/SVG) and PALETTE-01 (dominant + accent) define what the spike must de-risk for Phase 2
- `.planning/PROJECT.md` — milestone goal, "no AI/LLM extraction" + "no new infra" constraints,
  arm64 deploy constraint, the v3 Key Decisions table rows for `node-vibrant`/`sharp`

### Spike precedent to mirror (v2)
- `spike/run-container-check.sh` — v2 container-run harness (mongo up → build → arm64 assert →
  run → health check); the structural model for the new spike runner
- `spike/Dockerfile.bun` — minimal `oven/bun:1.3.14-slim` spike image
- `spike/05-rdkit.ts` — closest analog: a single-purpose native/WASM-dependency spike script
- `spike/README.md` — where v2 spike findings were recorded; extend the same pattern
- `.planning/milestones/v2-phases/04-compatibility-spike-baseline/` — full v2 spike phase
  (RESEARCH, PLANs, VERIFICATION) for how a compatibility spike was structured and verified

### Production target
- `Dockerfile` — production multi-stage `oven/bun:1.3.14-slim` arm64 build; the spike must
  reflect this base image and arm64 target

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `spike/run-container-check.sh`: ready-made harness — boots mongo, builds the spike image,
  asserts arm64, runs the container. Adapt (extraction need not require mongo; the palette
  check can replace the `/health` poll, or run as a one-shot `docker run` that prints the palette and exits 0).
- `spike/Dockerfile.bun`: minimal Bun spike image; add `node-vibrant`/`sharp` to a throwaway
  package set or install ad-hoc inside the build.
- `spike/05-rdkit.ts`: pattern for a focused dependency spike (init module → exercise → assert valid → `process.exit(1)` on failure).

### Established Patterns
- **Spike-before-commit** (v2): prove the tightest native/arm64 constraint in an isolated
  `spike/` harness inside the real `oven/bun` container before feature phases — exactly this phase.
- **arm64 assertion** via `docker image inspect --format '{{.Architecture}}'` — keep it.
- **Pinned base image** `oven/bun:1.3.14-slim` across Dockerfile, spike/Dockerfile.bun — match it.
- **Bun native-binding risk** is the known failure class (cf. v2: amqplib, RDKit-WASM, Stripe
  async crypto). `sharp` ships prebuilt platform binaries — arm64 musl/glibc availability under
  the slim image is the specific thing to verify.

### Integration Points
- None wired this phase by design — spike output is a go/no-go decision, not production code.
  The library only integrates into `server/` in Phase 2.

</code_context>

<specifics>
## Specific Ideas

- Palette output should be printed to stdout as readable hex (so the go/no-go is visible in
  CI/container logs), e.g. `{ dominant: "#aabbcc", accent: "#112233", muted: ... }`.
- Test fixtures: one raster logo (PNG, ideally with a couple of distinct brand colours so the
  dominant/accent split is observable) and one SVG, both small and checked into the spike dir.

</specifics>

<deferred>
## Deferred Ideas

- Choosing the actual fallback extraction approach if `node-vibrant`/`sharp` fail — deferred
  to the NO-GO contingency (see D-08), decided only if the spike fails.
- SVG pre-rasterization strategy for uploads — Phase 2 concern, informed by the D-04 probe result.

None of the above expand this phase's scope; the spike stays a pure compatibility proof.

</deferred>

---

*Phase: 1-Compatibility Spike*
*Context gathered: 2026-06-06*
