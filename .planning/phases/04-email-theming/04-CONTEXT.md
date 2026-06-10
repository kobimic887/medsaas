# Phase 4: Email Theming - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — recommended answers accepted per user directive (no checkpoints)

<domain>
## Phase Boundary

Branded emails sent by the platform use the sending company's saved brand
colour, inlined directly into the email HTML per-send (style attributes /
inline values — never CSS classes or variables, which email clients strip).
Companies with no saved palette fall back to the default brand colour with no
broken or unstyled output.

Out of scope: dashboard CSS-variable theming (Phase 3, done), palette editing
(Phase 2, done), redesigning email layouts beyond colour substitution.

</domain>

<decisions>
## Implementation Decisions

### Which sends are company-branded (EMAIL-01)
- Branded: **member invite** (POST /api/company/members, ~server/index.js:3499),
  **verification email** (generateVerificationEmailHTML call-site),
  **welcome email** (generateWelcomeEmailHTML, if sent), and
  **password-reset email** (~server/index.js:1971).
- Not branded (documented exclusions): the public **contact form**
  (/api/send-email — no tenant context) and the admin **SMTP test email**
  (/api/send-test-email — diagnostic).

### Mechanism
- Colours are applied as **inline values per-send**: hardcoded hexes in
  `server/utils/emailTemplates.js` (header/button gradients, accent colours)
  become palette-driven parameters threaded through the existing `options`
  argument. No `<style>`-class or CSS-variable approach for brand colour.
- Plain-text sends (invite, password reset) gain branded HTML via the existing
  `htmlContent` parameter of `sendTitanEmail`, using a small shared branded
  layout helper; the existing plain-text `message` is retained as the
  text fallback.

### Palette source and fallback (EMAIL-02)
- The palette is read from the **company document at send time** (the company
  record or companyId is already in scope at each branded call-site). Use
  `normalizeBrandPalette` / `DEFAULT_BRAND_PALETTE` from
  `server/utils/companyBranding.js` as the single server-side source of truth.
- Any error fetching/normalizing the palette fails open to
  `DEFAULT_BRAND_PALETTE` — email sending must never break because branding is
  missing or malformed.

### Claude's Discretion
- Exact mapping of the four palette fields (primary/accent/light/dark) onto
  template elements (header gradient, buttons, links, footers), including any
  derived hover/gradient stops.
- The shared branded-layout helper's structure and file location.
- Whether welcome/verification templates share a layout helper or keep their
  current structure with parameterized colours.
- Test organization (server has script-style tests under server/ — follow the
  Phase 2 branding API test precedent if useful).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/utils/emailService.js` — `sendTitanEmail({ name, subject, message,
  recipientEmail, htmlContent })`: htmlContent already supported.
- `server/utils/emailTemplates.js` — `generateVerificationEmailHTML(username,
  verificationUrl, options)`, `generateWelcomeEmailHTML(username, options)`,
  `generatePasswordResetEmailHTML(username, resetUrl, options)`; hardcoded
  hexes: verification header `#1e3a8a→#3b82f6` gradient, buttons
  `#3b82f6→#1e40af`, welcome header `#10b981→#059669`, accents.
- `server/utils/companyBranding.js` — `DEFAULT_BRAND_PALETTE`,
  `normalizeBrandPalette(rawPalette, fallback)`, `serializeCompanyBranding`.
- `server/config/branding.js` — `getBrandName(companyName)`,
  `getEmailFromLabel(companyName)`.

### Call-sites (server/index.js)
- ~1971: password reset send (plain text).
- ~3499: member invite send (plain text, includes temporary password — note
  security finding #6 about invite links is out of scope here, do not expand).
- Verification/welcome template call-sites: grep `generateVerificationEmailHTML`.

### Established Patterns
- ESM modules; companies collection has `branding.palette` saved by Phase 2.
- Verification gate: `npm run check` (server syntax check + client build).

</code_context>

<specifics>
## Specific Ideas

- Success is measurable: a received invite/verification email for a
  custom-palette company contains the company's hex in a `style="..."`
  attribute; the same email for a no-palette company contains the default
  brand hex — never an empty/undefined colour.

</specifics>

<deferred>
## Deferred Ideas

- Invite-link (single-use token) flow replacing temporary passwords — tracked
  as security finding #6 in docs/SECURITY-FINDINGS.md, separate work.
- Per-company email logo embedding (only colour is in scope for EMAIL-01/02).

</deferred>
