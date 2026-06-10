---
phase: 04-email-theming
reviewed: 2026-06-10T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - server/utils/emailTemplates.js
  - server/index.js
  - server/test/email-theming.test.mjs
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 4 Code Review — Email Theming

## Verified correct

- **Fail-open palette resolution:** `resolveCompanyEmailPalette` (index.js) and the
  template-side `resolveBrandPalette` both wrap `normalizeBrandPalette` in
  try/catch → `DEFAULT_BRAND_PALETTE`. Password-reset company lookup is
  try/caught with a warn; invite path uses the already-fetched, 404-guarded
  company. No defect.
- **Invite temp-password flow:** byte-identical behavior; `passwordLine`
  computed once and reused for HTML + plaintext; `temporaryPassword` response
  field and `mustChangePassword` untouched.
- **Contact form & SMTP-test sends:** untouched, no `htmlContent`.

## Critical Issues

### CR-01: HTML injection — username / company name interpolated into email HTML without escaping
**File:** `server/utils/emailTemplates.js` (invite, reset, verification templates)
**Wired by:** `server/index.js` invite (~3525) and password-reset (~1989) sends (NEW this phase)
`brandName` (from `company.name`), `invitee`, and `inviter` (`req.user.username`)
are interpolated raw into HTML. `normalizeCompanyName` only trims/collapses
whitespace — `<`, `>`, `"`, `&` are stored verbatim. A company named
`Acme</title><img src=x onerror=...>` renders as stored HTML injection in
company-branded emails (link spoofing/phishing inside legitimate emails).
**Fix:** add an `escapeHtml` helper; apply to every interpolated text value
(not server-derived URLs). Escape before `.toUpperCase()`.

## Warnings

### WR-01: `generateInviteEmailHTML` has zero test coverage
The test's `TEMPLATES` array exercises verification/welcome/password-reset but
never the invite template — the central deliverable of this phase.
**Fix:** add `generateInviteEmailHTML` to `TEMPLATES` so it gets the same
custom/default/malformed-palette and no-leak assertions.

### WR-02: Invite path issues temporary passwords from `Math.random()` (pre-existing, in modified call chain)
`generateTemporaryPassword` (index.js ~966) uses `Math.random().toString(36)`
+ `Date.now()` — predictable. **Fix:** use `crypto.randomBytes`/`crypto.randomInt`;
drop the time-derived segment.

## Info

### IN-01: `generateVerificationEmailHTML` imported but never called in `server/index.js`
Dead import (verification flow disabled). Harmless; drop from the index.js
import until the verification send is reinstated.
