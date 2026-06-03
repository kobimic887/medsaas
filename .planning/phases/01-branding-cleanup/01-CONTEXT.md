# Phase 1: Branding Cleanup - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove all Pyxis Discovery branding remnants from client and server source — files, imports, strings, and image references. No new capabilities or architectural changes.

</domain>

<decisions>
## Implementation Decisions

### Image Replacement
- **D-01:** Replace the 3 Pyxis images in `about-us.jsx` with science-themed CSS gradients (Dark blue to teal: #0d1b2a → #1b4965 → #62b6cb) to maintain a professional chemistry lab feel.
- **D-02:** Replace them as `<div>` elements with `background: linear-gradient(...)` and the same classes/styles as the current `<img>` tags, or apply inline styles to their containers.

### Server Email Text
- **D-03:** Update the server email subject and JSDoc examples to exactly use "ChemBench" (e.g., "Test Email from ChemBench").

### Dead Data File
- **D-04:** `pyxisImages.js` is never imported. It will be renamed to `libraryImages.js` per the requirement, but left as-is otherwise.

### Services Images
- **D-05:** `pyxisServicesImages.js` references neutral images. The file and export will be renamed to `servicesImages.js` and `servicesImages` respectively. Import references in `services.jsx` will be updated.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Definitions
- `.planning/REQUIREMENTS.md` — Core requirements and phase tracing
- `.planning/PROJECT.md` — Project definition and decisions

No external specs — requirements fully captured in decisions above
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `linear-gradient(...)`: `about-us.jsx` already uses a gradient for the hero background, showing the pattern for inline gradient application.

### Established Patterns
- Client data exports: The project uses explicit exports from `.js` files in `client/src/data/` for configuration.

### Integration Points
- `client/src/pages/main/about-us.jsx` (Hero, team, and lab images)
- `client/src/pages/main/services.jsx` (Imports from `pyxisServicesImages.js`)
- `client/src/data/pyxisImages.js` (To be renamed to `libraryImages.js`)
- `client/src/data/pyxisServicesImages.js` (To be renamed to `servicesImages.js`)
- `server/index.js` (Email subject and JSDoc example)

</code_context>

<specifics>
## Specific Ideas

Science-themed gradient specifically requested: Dark blue to teal (`#0d1b2a` → `#1b4965` → `#62b6cb`).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 1-Branding Cleanup*
*Context gathered: 2026-06-03*
