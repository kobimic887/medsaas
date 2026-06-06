# COMPAT-01 — node-vibrant / sharp Compatibility Spike Findings

**Requirement:** COMPAT-01 (v3 Phase 1) · **Verdict:** ✅ **GO**
**Verified:** 2026-06-06 on `oracle` (Oracle Cloud Ampere, native **arm64** / aarch64), Docker 29.2.1
**Image:** `medsaas:vibrant-spike` built from `spike/Dockerfile.vibrant` (`FROM oven/bun:1.3.14-slim`, the production base)
**Command:** `bash spike/run-vibrant-check.sh`

## Verdict

**GO.** `node-vibrant` and `sharp` install under Bun on linux/arm64 inside the
`oven/bun:1.3.14-slim` production container and extract a structured palette
(dominant + accent hex) from a raster logo. **Phase 2 may proceed on
`node-vibrant@4` + `sharp@0.34`.** SVG → palette also works in-container (bonus —
see SVG Probe below).

## Evidence (against D-07 PASS criteria)

### Install (no native-binding errors on arm64) — PASS
```
bun install v1.3.14
Resolved, downloaded and extracted [323]
+ node-vibrant@4.0.4
+ sharp@0.34.5
71 packages installed [3.04s]
```
`sharp@0.34.5` pulled its prebuilt **linux-arm64 (glibc)** binary cleanly into the
Debian-based slim image — no compile, no `node-gyp`, no missing-libvips error.
`bun install` saved a lockfile. This was the specific native-binding risk; it
passed.

### Image architecture — PASS
```
==> Image architecture: arm64
```
Asserted by the harness via `docker image inspect --format '{{.Architecture}}'`
on a real arm64 host (not qemu-emulated).

### Raster extraction (structured dominant + accent hex) — PASS
Raster fixture synthesized in-process by `sharp` (5 hue/luminance bands; no binary
fixture committed). `node-vibrant/node` (jimp decoder) extracted:
```
RASTER PALETTE: { dominant: "#f49c0c", accent: "#1c3c8c" }
populated swatches: Vibrant #f49c0c (pop 200), DarkVibrant #1c3c8c (200),
                    LightVibrant #fce4f4 (200), DarkMuted #141c24 (200),
                    Muted #925d06 (0), LightMuted #890f60 (0)
```
`dominant` / `accent` = the two most-populous non-null swatches (names not
hardcoded). Both are valid `#rrggbb`. Container exited 0.

### SVG probe (D-04 — recorded, not a gate) — WORKS (bonus)
`sharp.versions` reports **`vips: 8.17.3` built with `rsvg: 2.61.2`**, so libvips
in `oven/bun:1.3.14-slim` arm64 **does** include librsvg. The probe rasterized
`fixtures/logo.svg` with sharp, then extracted a palette:
```
SVG PROBE: OK (sharp rasterized SVG -> palette):
  DarkVibrant #1c3c8c, Vibrant #f39b0c, Muted #6cac54
```

## Decisions resolved for Phase 2 (the question delegated to absent research)

- **node-vibrant major + import shape:** Use **v4** (`node-vibrant@4.0.4`). The
  package **root export intentionally throws** in v4 — import the platform build
  via the subpath: `import { Vibrant } from "node-vibrant/node";` then
  `await Vibrant.from(src).getPalette()`.
- **node-vibrant's Node decoder is jimp** (PNG/JPEG/BMP/TIFF/GIF — **not SVG**).
  Do not hand an `.svg` straight to node-vibrant.
- **SVG path for Phase 2:** rasterize the SVG with `sharp(...).png()...` first,
  then extract the palette. Confirmed working in-container (librsvg present), so
  no external pre-rasterization service is needed.
- **Palette shape:** `node-vibrant` returns up to 6 named swatches
  (Vibrant/Muted/Light*/Dark*), any of which may be `null`. Select dominant/accent
  as the two most-populous non-null swatches rather than hardcoding swatch names.
- **`sharp` is a justified Phase-2 dependency** in its own right (raster
  synth/resize and SVG rasterization), independent of node-vibrant.

## NO-GO contingency (not triggered — recorded per D-08)

The raster path passed, so no fallback is needed. Had it failed, D-08 requires
surfacing alternatives (e.g. another extraction lib such as `colorthief`/`get-image-colors`,
or a pre-rasterize + MMCQ-quantize path) and **re-deciding before Phase 2** rather
than pre-selecting one here. N/A given the GO verdict.

## Reproduce

```bash
# On a real arm64 host (Apple Silicon, or the v2 'ssh oracle' precedent):
bash spike/run-vibrant-check.sh
# No local Docker? Ship the committed spike/ tree and run on the arm64 box:
git archive HEAD spike | ssh oracle 'rm -rf ~/vibrant-spike && mkdir -p ~/vibrant-spike && tar -x -C ~/vibrant-spike'
ssh oracle 'cd ~/vibrant-spike && bash spike/run-vibrant-check.sh'
```
