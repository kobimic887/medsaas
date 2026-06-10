---
phase: 04-email-theming
plan: 01
subsystem: server / email
tags: [email, branding, palette, multi-tenant]
requires:
  - server/utils/companyBranding.js (DEFAULT_BRAND_PALETTE, normalizeBrandPalette — Phase 2)
  - server/utils/emailService.js (sendTitanEmail htmlContent support)
provides:
  - Palette-driven inline-styled verification/welcome/password-reset/invite email HTML
  - Live invite and password-reset sends resolve and pass the company brand palette
  - Pure rendering verification harness for inline brand colour
affects:
  - server/utils/emailTemplates.js
  - server/index.js (password-reset send ~1971, member-invite send ~3499)
tech-stack:
  added: []
  patterns:
    - "Brand colours emitted as inline style attributes (never CSS classes/variables) to survive email-client CSS stripping"
    - "Palette resolution fails open to DEFAULT_BRAND_PALETTE so a send never breaks on missing/malformed branding"
key-files:
  created:
    - server/test/email-theming.test.mjs
  modified:
    - server/utils/emailTemplates.js
    - server/index.js
decisions:
  - "Added a dedicated generateInviteEmailHTML template rather than reusing the verification copy, so invite emails carry invite-appropriate text while sharing the inline palette helpers"
  - "Four-field-to-element mapping: primary→accent gradient header, primary→dark gradient buttons, accent→titles/links"
  - "Brand-colour CSS removed from <style> blocks and moved to inline style attributes; non-brand styling (layout, neutral greys, security-note amber) left in <style>"
metrics:
  duration: ~5 min
  completed: 2026-06-10
  tasks: 3
  files: 3
---

# Phase 4 Plan 01: Email Theming Summary

Company-branded platform emails (member invite, verification, welcome, password reset) now render the sending company's saved brand colour inlined directly into the email HTML per-send, with a fail-open fallback to `DEFAULT_BRAND_PALETTE` so a send never breaks on missing or malformed branding.

## What Was Built

- **Palette-parameterized templates** (`server/utils/emailTemplates.js`): `generateVerificationEmailHTML`, `generateWelcomeEmailHTML`, and `generatePasswordResetEmailHTML` accept a `palette` option. Each resolves it through `normalizeBrandPalette` wrapped in a try/catch that falls back to `DEFAULT_BRAND_PALETTE`, then emits the brand hexes via inline `style="..."` attributes on the header, primary button, and accent title/link elements. Brand-colour declarations were removed from the `<style>` blocks (header gradient, button gradients, accent title/link colours) and moved inline so they survive email-client CSS stripping. A new `generateInviteEmailHTML` provides invite-specific branded copy using the same shared inline-style helpers.
- **Wired live sends** (`server/index.js`): A `resolveCompanyEmailPalette(company)` helper returns a normalized four-field palette and fails open to `DEFAULT_BRAND_PALETTE`. The password-reset send (~1971) fetches the company by `companyId` inside its own try/catch and passes branded `htmlContent` via `generatePasswordResetEmailHTML`. The member-invite send (~3499) resolves the palette from the already-in-scope `company` doc and passes branded `htmlContent` via `generateInviteEmailHTML`. Both retain their existing plain-text `message` as the text fallback.
- **Verification harness** (`server/test/email-theming.test.mjs`): A pure rendering test (no server boot, no MongoDB) following the Phase 2 `check()` pass/fail pattern. Asserts custom-hex-inline and default-hex-inline for all three templates, absence of leaked colour markers, and fail-open on a malformed palette. 12/12 checks pass.

## How to Verify

- `node server/test/email-theming.test.mjs` — exits 0, prints "12 passed, 0 failed".
- `npm run check` — server bundle + client build, exits 0.
- `node --check server/utils/emailTemplates.js` and `node --check server/index.js` — both exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `DEFAULT_BRAND_PALETTE` import to server/index.js**
- **Found during:** Task 2
- **Issue:** The plan's `<interfaces>` stated `DEFAULT_BRAND_PALETTE` was already imported in `server/index.js`, but the actual import block only imported `normalizeBrandPalette`. The new fail-open helper references `DEFAULT_BRAND_PALETTE`, so the file would not run without it.
- **Fix:** Added `DEFAULT_BRAND_PALETTE` to the existing `./utils/companyBranding.js` import.
- **Files modified:** server/index.js
- **Commit:** 1d8187a

**2. [Rule 1 - Test precision] Tightened the "bare #" leak detector in the test**
- **Found during:** Task 3
- **Issue:** The naive `#"` leak check matched legitimate placeholder `href="#"` links (empty website/sign-in URLs default to `'#'`), producing false-positive failures on the verification and welcome templates.
- **Fix:** Scoped the leak regex to a bare `#` appearing inside a CSS `color`/`background` value (the actual colour-leak case the plan intends), so empty `href="#"` placeholders are not flagged.
- **Files modified:** server/test/email-theming.test.mjs
- **Commit:** 2ee2570

### Discretionary Choices (allowed by CONTEXT.md)

- Added a dedicated `generateInviteEmailHTML` rather than reusing the verification template's copy for invites — the invite needs distinct text (inviter, role, getting-started line) while sharing the inline palette helpers.
- Four-field mapping: header gradient = primary→accent, primary buttons = primary→dark, titles/links/accent spans = accent.

## Requirements Satisfied

- **EMAIL-01** — branded emails for a custom-palette company carry the company's brand hex inside a `style="..."` attribute (verified for all three templates).
- **EMAIL-02** — no-palette companies render `DEFAULT_BRAND_PALETTE` hexes inline; never an empty/undefined colour.

## Excluded / Untouched (per plan)

- `/api/send-email` (contact form) and `/api/send-test-email` (SMTP test) sends remain plain/unbranded — `git diff` shows no edits to those handlers.
- The invite temporary-password flow (`generatedPassword`, `mustChangePassword`, the temp-password text line) is unchanged; only branded `htmlContent` was added alongside the existing text fallback.

## Known Stubs

None. All rendered colours derive from live palette resolution; no placeholder/empty data sources.

## Self-Check: PASSED

- All three modified/created source files exist on disk.
- All three task commits (67e126c, 1d8187a, 2ee2570) exist in git history.
