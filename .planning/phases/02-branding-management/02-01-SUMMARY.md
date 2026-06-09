---
phase: 02-branding-management
plan: 01
subsystem: api
tags: [branding, mongodb, node-vibrant, sharp, bun, express, tenant-isolation]

requires:
  - phase: 01-compatibility-spike
    provides: Proven node-vibrant@4.0.4 and sharp@0.34.5 Bun/arm64 extraction stack
provides:
  - Tenant-scoped company branding read, extract, and save API
  - Bounded PNG/JPEG/SVG normalization to PNG and population-ranked palette extraction
  - BSON binary logo persistence with four-color palette defaults and serialization
  - Bun and Node live integration coverage for authorization, validation, persistence, and isolation
affects: [02-02 shared branding state, 02-03 branding editor, phase-03 dashboard theming, phase-04 email theming]

tech-stack:
  added: [node-vibrant@4.0.4, sharp@0.34.5]
  patterns: [normalize-before-persist, JWT-derived tenant filters, non-persistent extraction endpoint, dual-runtime integration tests]

key-files:
  created:
    - server/utils/companyBranding.js
    - server/test/branding.test.mjs
  modified:
    - server/index.js
    - server/package.json
    - server/bun.lock
    - server/package-lock.json

key-decisions:
  - "Normalize every accepted logo to a bounded PNG before extraction or persistence, including SVG input"
  - "Return logo data as a PNG data URL while storing only BSON binary bytes on the company document"
  - "Allow all active tenant users to read branding; require a current owner/admin database role for extraction and saves"

patterns-established:
  - "Branding writes derive companyId only from the authenticated user and never accept a client-selected tenant"
  - "Palette extraction is a review-only POST; persistence occurs only through the explicit PATCH save"
  - "Missing extracted variants are deterministically derived into primary/accent/light/dark uppercase hex values"

requirements-completed: [LOGO-02, LOGO-03, PALETTE-01, PALETTE-04, ADMIN-03]

duration: 4min
completed: 2026-06-09
---

# Phase 2 Plan 01: Branding Backend Summary

**Secure tenant branding APIs with bounded image normalization, four-color extraction, BSON persistence, and 30 live assertions under both Bun and Node**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-09T18:59:21Z
- **Completed:** 2026-06-09T19:03:24Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added exact production pins for `node-vibrant@4.0.4` and `sharp@0.34.5` with both lockfiles refreshed.
- Added tenant-safe GET, admin-only extraction, and admin-only save endpoints with no persistence during extraction.
- Stored normalized PNG bytes as BSON binary and returned only sanitized branding responses.
- Proved validation, role denial, palette-only save, logo preservation, audit redaction, tenant isolation, and restart durability under Bun and Node.

## Task Commits

1. **Task 1: Production dependencies and image/palette helpers** - `473a089`
2. **Task 2: Tenant-safe branding routes** - `a1ffb8d`
3. **Task 3: Live branding API integration coverage** - `8adf368`

## Files Created/Modified

- `server/utils/companyBranding.js` - Strict upload validation, sharp normalization, palette extraction/completion, and safe serialization.
- `server/index.js` - Branding routes, company normalization, and 8 MB JSON transport ceiling.
- `server/test/branding.test.mjs` - Real server plus MongoDB integration suite.
- `server/package.json` - Runtime dependencies and Bun/Node branding test scripts.
- `server/bun.lock` - Bun dependency lock.
- `server/package-lock.json` - npm dependency lock.

## Decisions Made

- The 5 MB limit applies to decoded input bytes; the Express ceiling is 8 MB only to accommodate base64 JSON overhead.
- Existing logos are preserved when a PATCH supplies only a palette.
- Companies without saved branding receive the current green fallback without a database write and with `isCustom: false`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserve the custom-branding marker across in-memory normalization**
- **Found during:** Task 2
- **Issue:** Adding a fallback palette to `getCompanyRecord` could make an unbranded company appear custom because serialization saw a palette object.
- **Fix:** Added a transient `isCustom` marker based only on persisted branding and excluded it from the saved document shape.
- **Files modified:** `server/index.js`, `server/utils/companyBranding.js`
- **Verification:** Tenant B integration assertion returns the fallback palette, no logo, and `isCustom: false`.
- **Committed in:** `a1ffb8d`

**Total deviations:** 1 auto-fixed bug.
**Impact:** Correct fallback semantics with no scope expansion.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- Plan 02-02 can consume `GET /api/company/branding` for shared authenticated branding state.
- Plan 02-03 can use extraction and PATCH contracts without further backend work.

## Self-Check: PASSED

- `bun --cwd=server run test:branding`: 30 passed, 0 failed.
- `npm --prefix server run test:branding:node`: 30 passed, 0 failed.
- `bun build server/index.js --target=bun --outfile=/dev/null`: passed.
- `node --check server/index.js`: passed.

---
*Phase: 02-branding-management*
*Completed: 2026-06-09*
