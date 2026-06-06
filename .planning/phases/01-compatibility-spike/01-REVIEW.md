---
phase: 01-compatibility-spike
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - spike/06-vibrant.ts
  - spike/Dockerfile.vibrant
  - spike/run-vibrant-check.sh
  - spike/vibrant-package.json
  - spike/fixtures/logo.svg
  - spike/README.md
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Six files reviewed: the TypeScript spike script, Dockerfile, shell harness, throwaway
package manifest, SVG fixture, and README. This is a container-isolated, one-shot
compatibility spike (COMPAT-01) with no user input, no secrets, and no production wiring.
It was empirically verified GO on the real arm64 target (oracle).

One warning-level finding: the SVG probe reads a relative path (`"fixtures/logo.svg"`)
that resolves correctly only when the process working directory is `/app`. This is always
true in the supported Docker run, but the catch block swallows errors and prints
`SVG PROBE: FAILED` — which obscures whether a future run that *changes* the invocation
path failed due to a path bug rather than a genuine compat issue. Two info-level findings:
one dead-code guard and one non-frozen dependency install.

No critical issues found.

---

## Warnings

### WR-01: SVG probe uses a relative path that silently fails outside the expected cwd

**File:** `spike/06-vibrant.ts:102`
**Issue:** `sharp("fixtures/logo.svg")` resolves relative to whatever the process working
directory is at runtime. The supported execution path (`docker run … bun 06-vibrant.ts`
from WORKDIR `/app`) places `fixtures/` at `/app/fixtures`, so it works correctly.
However, the entire SVG section is wrapped in a try/catch that catches *any* error and
prints `SVG PROBE: FAILED` (line 114). If someone runs the spike directly on a host with
a different cwd — e.g. `bun spike/06-vibrant.ts` from the repo root, where `fixtures/`
does not resolve — the catch block will mask the path failure as a compat failure. A
Phase 2 developer reading logs of a failed probe cannot easily distinguish "sharp cannot
rasterize SVGs on this platform" from "the fixture path was wrong."
**Fix:** Use `import.meta.dir` (Bun) or `__dirname` / `new URL` (Node/Bun ESM) to anchor
the path to the script's location rather than the process cwd:
```typescript
// Replace line 102:
const svgInput = new URL("fixtures/logo.svg", import.meta.url).pathname;
await sharp(svgInput).png().toFile(svgPng);
```
Alternatively, add a discriminating error log in the catch:
```typescript
} catch (e) {
  const msg = (e as Error).message ?? String(e);
  const tag = msg.includes("No such file") ? "[path]" : "[compat]";
  console.log(`SVG PROBE: FAILED ${tag}`, msg);
}
```

---

## Info

### IN-01: Dead-code guard on dominant/accent hex — always evaluates false

**File:** `spike/06-vibrant.ts:84-87`
**Issue:** `structured()` only returns swatches whose `hex` field already passes
`isHex()` (line 29 filters on `isHex(s.hex)`). Every element of `sw[]` is therefore
guaranteed to have a valid hex. The guard at lines 84-87 — `if (!isHex(dominant) ||
!isHex(accent))` — can never be true; it is dead code. This is harmless defensive
redundancy in a throwaway spike, but it slightly misrepresents what is actually being
tested (the check does not add safety; it merely adds noise).
**Fix:** Remove lines 84-87 or add a comment acknowledging the redundancy is intentional:
```typescript
// dominant and accent are guaranteed valid by structured(); this guard is belt-and-suspenders.
```

### IN-02: Transitive dependencies float — no lockfile in the Dockerfile

**File:** `spike/Dockerfile.vibrant:11` / `spike/vibrant-package.json`
**Issue:** Direct deps (`node-vibrant@4.0.4`, `sharp@0.34.5`) are exact-pinned, but
`bun install` (no `--frozen-lockfile`) resolves transitive deps from the registry at
build time. The spike has no `bun.lock` committed alongside `vibrant-package.json`, so
a rebuild months later could pick up different transitive versions. For a throwaway
spike this is acceptable; it becomes relevant if the Phase 2 production integration
copies this Dockerfile pattern without adding a lockfile.
**Fix** (spike scope): Add `--frozen-lockfile` to the `RUN bun install` line and commit
a `bun.lock` next to `vibrant-package.json` if reproducibility across rebuilds matters.
For the spike as-is, document the caveat in the README note for COMPAT-01.

---

## Out-of-Scope Forward Note

The SVG probe comment calls this "the Phase-2-relevant path." If Phase 2 ever passes
a user-supplied file to `sharp()` for SVG rasterization, libvips will follow XML entity
references and potentially `xlink:href` attributes, which can be a local-file-read
vector on a server. This is **not a finding against this spike** (the input is a static
committed fixture), but the Phase 2 implementation should sanitize or reject SVG content
before handing it to sharp.

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
