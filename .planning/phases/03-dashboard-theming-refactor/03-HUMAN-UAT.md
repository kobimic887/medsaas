---
status: partial
phase: 03-dashboard-theming-refactor
source: [03-VERIFICATION.md]
started: 2026-06-10T00:00:00Z
updated: 2026-06-10T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Custom-palette re-theming
expected: Log in as a company with a custom palette — all previously-green brand chrome (buttons, highlights, CTAs, Search Result CardHeader) re-tints to the company colour without a page reload, with no gray Material Tailwind default bleed-through on the dropped-enum Buttons/CardHeader.
result: [pending]

### 2. Pixel-identical fallback
expected: A company with no custom palette looks identical to pre-v3 green. In devtools, `--brand-500` resolves to `76 175 80` with no inline override on `document.documentElement`.
result: [pending]

### 3. Tenant isolation
expected: Changing company A's palette does not alter what company B's users see. A direct A→B login (no intervening logout) clears A's colours immediately during B's branding fetch.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
