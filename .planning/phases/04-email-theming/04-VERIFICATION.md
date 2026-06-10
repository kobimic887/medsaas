---
phase: 04-email-theming
verified: 2026-06-11T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "From a company with a saved custom palette, invite a new member (POST /api/company/members via the dashboard) and/or request a password reset, then open the received email in a real client (Gmail/Outlook)"
    expected: "Header gradient and primary button render in the company's custom brand colour; for a company with no saved palette the same email renders in the default olive (#B4B239) — no unstyled/blue fallback"
    why_human: "Actual SMTP delivery (Titan) and email-client CSS handling cannot be verified by grep or rendering tests; the HTML string is proven correct programmatically, but receipt and visual rendering in a real inbox need a human"
---

# Phase 4: Email Theming Verification Report

**Phase Goal:** Branded emails sent by the platform (invite, verification, and other company-branded sends) use the company's saved brand colour, inlined directly into the email HTML per-send — separate from the CSS-variable dashboard mechanism.
**Verified:** 2026-06-11 (HEAD 24a8e43, working tree clean)
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | Email for a company with a custom palette contains the brand colour as an inline style attribute (ROADMAP SC1 / EMAIL-01) | ✓ VERIFIED | `headerStyle`/`primaryButtonStyle`/`titleStyle`/`accentTextStyle` interpolate palette hexes into `style="..."` attributes (emailTemplates.js:41-55, used at :261, :276, :405, :494, :602, :613). Test run: 20/20 PASS including "custom primary inline" for all 4 templates. `grep -c 'var(--brand'` = 0 — no CSS-variable brand colour |
| 2   | Email for a company with no saved palette uses the default brand colour — no broken/unstyled fallback (ROADMAP SC2 / EMAIL-02) | ✓ VERIFIED | `resolveBrandPalette` defaults via `normalizeBrandPalette({})` → DEFAULT_BRAND_PALETTE fields; tests assert `#B4B239` inline + no leak markers (undefined / empty gradient / bare `#` colour) for all 4 templates |
| 3   | Palette fetch/normalize errors fail open to DEFAULT_BRAND_PALETTE and the send proceeds | ✓ VERIFIED | Template-side try/catch (emailTemplates.js:30-36); server-side `resolveCompanyEmailPalette` try/catch (index.js:1962-1968); reset-path company lookup wrapped in its own try/catch with warn (index.js:1991-1996); 4 malformed-palette fail-open tests PASS |
| 4   | Contact-form (/api/send-email) and SMTP-test (/api/send-test-email) sends unchanged | ✓ VERIFIED | Neither handler contains `htmlContent` or `palette`; `git diff 6d2a1f9..HEAD -- server/index.js` shows no +/- lines touching those handlers |

**Score:** 4/4 truths verified (roadmap SC1/SC2 are restated by PLAN truths 1/2; merged)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `server/utils/emailTemplates.js` | Palette-driven templates with inline style colours | ✓ VERIFIED | 625 lines; 4 exported templates accept `palette` option; contains "palette"; plus `escapeHtml` (CR-01 fix); `node --check` passes |
| `server/index.js` | Branded HTML wired into live invite + password-reset sends with fail-open resolution | ✓ VERIFIED | Contains `DEFAULT_BRAND_PALETTE` (imported line 32, used in helper); reset send passes `htmlContent: resetHtml` (line 2013); invite send passes `htmlContent: inviteHtml` (line 3553); `node --check` passes |
| `server/test/email-theming.test.mjs` | Custom-vs-default inline-colour assertions | ✓ VERIFIED | 148 lines, `check()` harness; 20 checks covering all 4 templates (custom, default, no-leak, fail-open) + 4 CR-01 injection regressions; exits 0 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| index.js password-reset send (~1998) | company.branding.palette | `companiesCollection.findOne({ companyId: user.companyId })` + `resolveCompanyEmailPalette` | ✓ WIRED | index.js:1991-2001; fail-open on lookup error and on normalize throw |
| index.js member-invite send (~3534) | company.branding.palette | in-scope `company` doc → `resolveCompanyEmailPalette(company)` | ✓ WIRED | index.js:3533-3542; `htmlContent: inviteHtml` passed to sendTitanEmail |
| emailTemplates.js templates | rendered HTML style attributes | palette fields interpolated into inline style strings | ✓ WIRED | `style="${headerStyle(brand)}"` etc. on header/button/title/accent elements |
| sendTitanEmail htmlContent | actual outgoing mail | `mailOptions.html = htmlContent \|\| fallback` | ✓ WIRED | emailService.js:78 — branded HTML reaches the nodemailer `html` field; plain-text `message` retained as `text` fallback |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Invite send | `invitePalette` | already-fetched, 404-guarded `company` doc (`company.branding.palette`, saved by Phase 2 branding editor) | Yes — real DB document | ✓ FLOWING |
| Reset send | `resetPalette` | `companiesCollection.findOne({ companyId: user.companyId })` real query | Yes | ✓ FLOWING |
| Templates | `brand` | `normalizeBrandPalette(options.palette)` with frozen DEFAULT_BRAND_PALETTE fallback | Yes — never empty/undefined | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite | `node server/test/email-theming.test.mjs` | "Result: 20 passed, 0 failed", exit 0 | ✓ PASS |
| Server/template syntax | `node --check server/index.js && node --check server/utils/emailTemplates.js` | exit 0 | ✓ PASS |
| No CSS-variable brand colour | `grep -c 'var(--brand' server/utils/emailTemplates.js` | 0 | ✓ PASS |

### Code Review Fix Verification (04-REVIEW.md)

| Finding | Claimed Fix | Present at HEAD | Evidence |
| ------- | ----------- | --------------- | -------- |
| CR-01 HTML injection (critical) | 0d0cb5b + 2b174ea | ✓ YES | `escapeHtml` applied to brandName/username/inviter/invitee/role/passwordLine in all 4 templates (escaped before `.toUpperCase()` output at e.g. emailTemplates.js:66-68); 4 injection regression tests PASS |
| WR-01 invite template untested | 2b174ea | ✓ YES | `generateInviteEmailHTML` in the test's `TEMPLATES` array (test.mjs:66-81) with full custom/default/leak/fail-open coverage |
| WR-02 Math.random temp passwords | 0d0cb5b | ✓ YES | `generateTemporaryPassword` uses `crypto.randomInt` over a 10-char unambiguous alphabet; no `Math.random`/`Date.now` segment (index.js:968-979) |
| IN-01 dead generateVerificationEmailHTML import | 0d0cb5b | ✓ YES | index.js:26 imports only `generatePasswordResetEmailHTML, generateInviteEmailHTML` |

All claimed commits (67e126c, 1d8187a, 2ee2570, 0d0cb5b, 2b174ea) exist in git history.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| EMAIL-01 | 04-01-PLAN | Branded emails use the company's brand colour, inlined into email HTML per-send | ✓ SATISFIED | Truths 1, key links 1-3; live invite + reset sends pass palette-branded htmlContent |
| EMAIL-02 | 04-01-PLAN | No-palette companies fall back to the default brand colour | ✓ SATISFIED | Truth 2; DEFAULT_BRAND_PALETTE fail-open at template and server layers |

No orphaned requirements: REQUIREMENTS.md maps only EMAIL-01/EMAIL-02 to Phase 4, both claimed by the plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None (no TBD/FIXME/XXX/TODO/stub returns in phase-modified files) | — | — |

Note (informational, by design per CONTEXT.md): `generateVerificationEmailHTML` and `generateWelcomeEmailHTML` are palette-parameterized but have no live call-site — the verification/welcome flows are currently disabled (pre-existing, acknowledged in review finding IN-01). The live branded sends are member-invite and password-reset, which satisfies the roadmap's "invite or verification email" criterion via the invite path.

### Human Verification Required

### 1. Received-email brand colour in a real client

**Test:** From a company with a saved custom palette, create a member invite (Team page) and/or request a password reset for a user of that company; open the received email in a real client (Gmail/Outlook). Repeat for a company with no saved palette.
**Expected:** Custom-palette email shows the company colour in the header gradient and button; no-palette email shows the default olive (#B4B239). No unstyled or old-blue rendering.
**Why human:** Actual Titan SMTP delivery and email-client CSS handling cannot be verified programmatically; the HTML string handed to nodemailer is proven correct, but inbox receipt and visual rendering require a human.

### Gaps Summary

No gaps. All four must-have truths, all three artifacts (exists / substantive / wired / data-flowing), all key links, both requirements, and all four code-review fixes are verified at HEAD with the 20/20 test suite passing. The single remaining item is end-to-end visual confirmation of a received email, which is inherently human-verifiable.

---

_Verified: 2026-06-11_
_Verifier: Claude (gsd-verifier)_
