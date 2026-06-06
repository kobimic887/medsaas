# Phase 1: Compatibility Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 1-Compatibility Spike
**Areas discussed:** Input formats / SVG, Palette shape proven, Go/no-go recording

---

## Input formats / SVG

| Option | Description | Selected |
|--------|-------------|----------|
| Verify SVG in-container | Treat SVG→palette as a gated requirement | |
| Raster gate + SVG probe | Raster (PNG/JPG) is the go/no-go gate; SVG attempted as a documented finding, not a gate | ✓ |
| Raster only | Skip SVG entirely this phase | |

**User's choice:** No preference — delegated to Claude.
**Notes:** Resolved to "raster gate + SVG probe" per advisor guidance. `sharp` SVG
rasterization on `oven/bun:slim` arm64 isn't guaranteed; probing surfaces it for Phase 2
without false-failing the spike. Boundary held: library compatibility, not upload validation (Phase 2).

---

## Palette shape proven

| Option | Description | Selected |
|--------|-------------|----------|
| Truthiness only | Prove extraction returns a non-empty object | |
| Phase-2 structure | Prove dominant + accent (hex) structure Phase 2 (PALETTE-01) consumes | ✓ |

**User's choice:** No preference — delegated to Claude.
**Notes:** Proving the structure costs nothing extra and closes the gap between success
criterion #1 ("non-empty palette object") and PALETTE-01 ("dominant + accent").

---

## Go/no-go recording

| Option | Description | Selected |
|--------|-------------|----------|
| Findings doc + explicit verdict | Record in spike README/FINDINGS with install/raster/SVG results + GO/NO-GO | ✓ |
| Inline-only | Leave the decision in the spike script output / commit message | |

**User's choice:** No preference — delegated to Claude.
**Notes:** Mirror v2's spike findings recording. PASS = container exits 0 with non-empty
structured palette from a raster logo AND clean `bun install` on arm64. Fallback library is a
NO-GO contingency, not pre-decided.

---

## Claude's Discretion

- All three areas were delegated ("No preference"); decisions made per advisor framing and
  the v2 spike precedent.
- Spike harness form (mirror v2 `spike/` pattern), file naming, sample-fixture sourcing,
  and `node-vibrant` version/import shape (researcher to confirm Bun-compatible release).

## Deferred Ideas

- Fallback extraction approach if `node-vibrant`/`sharp` fail — decided only on NO-GO.
- SVG pre-rasterization strategy for uploads — Phase 2, informed by the SVG probe result.
