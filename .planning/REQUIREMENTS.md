# Requirements: ChemBench — v3 Company Brand Colour

**Defined:** 2026-06-06
**Core Value:** Labs and customers get a professional, focused tool for their chemistry work — each company's space reflects its own brand, not a shared hardcoded green.

## v3 Requirements

Requirements for the Company Brand Colour milestone. Each maps to exactly one roadmap phase.

### Compatibility (COMPAT)

- [x] **COMPAT-01**: The chosen palette-extraction library (`node-vibrant`/`sharp`) installs and extracts a palette from a sample logo under Bun on linux/arm64 in the `oven/bun` production container — proven before any feature code depends on it (mirrors the v2 spike-before-commit precedent)

### Logo (LOGO)

- [ ] **LOGO-01**: Owner/admin can upload a company logo image (PNG/JPG/SVG) from the admin branding settings
- [ ] **LOGO-02**: An uploaded logo is stored in MongoDB (binary field on the company) and persists across sessions and deploys
- [ ] **LOGO-03**: Logo uploads are validated for file type and size, and an invalid file is rejected with a clear error message
- [ ] **LOGO-04**: A company's logo is displayed in the dashboard chrome (navbar/sidebar) for that company's users, alongside or in place of the text brand label

### Palette (PALETTE)

- [ ] **PALETTE-01**: On logo upload, the system automatically extracts a brand palette (dominant + accent colours) from the image in-process
- [ ] **PALETTE-02**: Owner/admin can manually edit or override any colour in the extracted palette before saving
- [ ] **PALETTE-03**: Owner/admin can set the brand palette manually without uploading a logo (fallback when there is no logo or extraction is poor)
- [ ] **PALETTE-04**: A company's saved palette persists per-company in MongoDB and is loaded for that company's users

### Theming (THEME)

- [ ] **THEME-01**: The dashboard's brand colour is driven by a runtime CSS-variable layer fed from the logged-in user's company palette (no hardcoded brand colour)
- [ ] **THEME-02**: The existing hardcoded brand colour usages (~14 Material Tailwind `color="green"` props + ~37 `green/emerald` utility classes) are migrated onto the company-driven theming mechanism
- [ ] **THEME-03**: A company with no custom palette falls back to a sensible default theme (current appearance preserved)
- [ ] **THEME-04**: Changing one company's palette re-themes only that company's users — tenants are visually isolated from each other

### Email (EMAIL)

- [ ] **EMAIL-01**: Branded emails (invite, verification, and other company-branded sends) use the company's brand colour, inlined into the email HTML per-send
- [ ] **EMAIL-02**: Emails for a company with no custom palette fall back to the default brand colour

### Admin (ADMIN)

- [ ] **ADMIN-01**: Branding (logo + palette) is managed from an admin branding-settings page, gated to owner/admin via `requireCompanyAdmin`
- [ ] **ADMIN-02**: Admin can preview how the palette looks before saving it
- [ ] **ADMIN-03**: Members (non owner/admin) cannot upload a logo or change the palette — both UI and server enforce the restriction

## Future Requirements

Deferred to a later milestone. Tracked but not in this roadmap.

### Subdomain (SUBDM)

- **SUBDM-01**: Each company gets a custom subdomain (e.g. `acme.chembench.app`) routing to its branded space
- **SUBDM-02**: Brand colour can be auto-detected from the company's website domain (not just the uploaded logo)

## Out of Scope

Explicitly excluded for v3. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom subdomain / vanity domain | Deferred by user to a later milestone; routing + DNS + TLS is its own track |
| Website/domain colour scraping | Heavier, more failure modes; logo upload already covers the brand-colour need |
| Colour entry at signup | Branding is admin-settings-only by decision; signup stays minimal |
| Vision-LLM / OpenRouter / n8n palette extraction | In-process `node-vibrant`/`sharp` is deterministic, free, and faster; external AI adds cost, latency, flakiness for marginal gain |
| Object storage (S3) for logos | Logos sit under the 16 MB BSON limit; MongoDB binary field avoids new infra/credentials |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMPAT-01 | Phase 1 | Complete |
| LOGO-01 | Phase 2 | Pending |
| LOGO-02 | Phase 2 | Pending |
| LOGO-03 | Phase 2 | Pending |
| LOGO-04 | Phase 2 | Pending |
| PALETTE-01 | Phase 2 | Pending |
| PALETTE-02 | Phase 2 | Pending |
| PALETTE-03 | Phase 2 | Pending |
| PALETTE-04 | Phase 2 | Pending |
| THEME-01 | Phase 3 | Pending |
| THEME-02 | Phase 3 | Pending |
| THEME-03 | Phase 3 | Pending |
| THEME-04 | Phase 3 | Pending |
| EMAIL-01 | Phase 4 | Pending |
| EMAIL-02 | Phase 4 | Pending |
| ADMIN-01 | Phase 2 | Pending |
| ADMIN-02 | Phase 2 | Pending |
| ADMIN-03 | Phase 2 | Pending |
| SUBDM-01 | Future milestone | Deferred |
| SUBDM-02 | Future milestone | Deferred |

**Coverage:**
- v3 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-06-06*
*Last updated: 2026-06-06 — traceability filled during roadmap creation (18/18 mapped)*
