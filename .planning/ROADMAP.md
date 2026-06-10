# Roadmap: ChemBench

## Milestones

- ✅ **v1 — ChemBench Cleanup** — Phases 1–3 (shipped 2026-06-04)
- ✅ **v2 — Bun Migration** — Phases 4–7 (shipped 2026-06-05)
- 🚧 **v3 — Company Brand Colour** — Phases 1–4 (in progress)

## Phases

<details>
<summary>✅ v1 — ChemBench Cleanup (Phases 1–3) — SHIPPED 2026-06-04</summary>

- [x] Phase 1: Branding Cleanup — completed 2026-06-04
- [x] Phase 2: Login Code Cleanup — completed 2026-06-04
- [x] Phase 3: CI/CD Pipeline — completed 2026-06-04

Full archive: `.planning/milestones/v1-ROADMAP.md`

</details>

<details>
<summary>✅ v2 — Bun Migration (Phases 4–7) — SHIPPED 2026-06-05</summary>

- [x] Phase 4: Compatibility Spike + Baseline (4/4 plans) — completed 2026-06-04
- [x] Phase 5: Server Runtime on Bun (3/3 plans) — completed 2026-06-04
- [x] Phase 6: Package Management (2/2 plans) — completed 2026-06-05
- [x] Phase 7: Docker, CI/CD, and Scripts (3/3 plans) — completed 2026-06-05

Outcome: Bun is the default server runtime (idle RSS below the Node baseline — MEAS-03 PASS),
package manager, and production `oven/bun` arm64 image; one-change Node fallback retained at
every layer. Full archive: `.planning/milestones/v2-ROADMAP.md`

</details>

### 🚧 v3 — Company Brand Colour (In Progress)

**Milestone Goal:** Each company controls its own brand palette (logo-driven), replacing the hardcoded green and theming the dashboard, emails, and invites per-tenant.

- [x] **Phase 1: Compatibility Spike** - Prove `node-vibrant`/`sharp` installs and extracts a palette under Bun on linux/arm64 in `oven/bun` before any feature depends on it (completed 2026-06-06)
- [x] **Phase 2: Branding Management** - Admin can upload a logo, extract and edit a palette, and persist branding per-company, gated to owner/admin (completed 2026-06-09)
- [x] **Phase 3: Dashboard Theming Refactor** - The ~51 hardcoded green call-sites are migrated onto a runtime CSS-variable layer driven by the company palette (completed 2026-06-10)
- [ ] **Phase 4: Email Theming** - Branded emails use the company's colour, inlined per-send into the HTML

## Phase Details

### Phase 1: Compatibility Spike
**Goal**: Prove that `node-vibrant` and `sharp` install under Bun on linux/arm64 in the `oven/bun` production container and can extract a colour palette from a sample logo image — before any feature code depends on the library
**Depends on**: Nothing (first phase)
**Requirements**: COMPAT-01
**Success Criteria** (what must be TRUE):
  1. Running the spike script inside the `oven/bun` arm64 container exits 0 with a non-empty palette object printed to stdout
  2. `bun install` with `node-vibrant` and `sharp` added completes without native-binding errors on linux/arm64
  3. A documented go/no-go decision exists: either both libraries are confirmed, or an alternative is chosen, before Phase 2 begins
**Plans**: 1 plan
  - [x] 01-01-PLAN.md — Prove node-vibrant/sharp install + extract a structured palette under Bun on arm64; record GO/NO-GO

### Phase 2: Branding Management
**Goal**: Owner/admin can upload a company logo, see an automatically extracted palette, edit or set it manually, save it to MongoDB, and see the logo displayed in the dashboard chrome — with the admin settings page gated to owner/admin and members denied both in the UI and on the server
**Depends on**: Phase 1
**Requirements**: LOGO-01, LOGO-02, LOGO-03, LOGO-04, PALETTE-01, PALETTE-02, PALETTE-03, PALETTE-04, ADMIN-01, ADMIN-02, ADMIN-03
**Success Criteria** (what must be TRUE):
  1. An owner or admin can open a branding-settings page, upload a PNG/JPG/SVG logo, and see an automatically extracted palette offered for review
  2. The admin can override any extracted colour or set the palette from scratch (no logo required) and save it; the palette persists after logout and redeploy
  3. An invalid file (wrong type or oversized) is rejected immediately with a clear error message
  4. The company's logo appears in the dashboard navbar/sidebar for all users of that company after upload
  5. A member (non-admin) attempting to reach the branding-settings page or call the upload/palette API receives an access-denied response — neither the UI nor the server permits the action
**Plans**: 3 plans
**Wave 1**
  - [x] 02-01-PLAN.md — Secure branding persistence, palette extraction, and API coverage
**Wave 2** *(blocked on Wave 1 completion)*
  - [x] 02-02-PLAN.md — Shared branding state and dashboard sidebar identity
**Wave 3** *(blocked on Waves 1–2 completion)*
  - [x] 02-03-PLAN.md — Company Admin branding editor, validation, and live preview
**UI hint**: yes

### Phase 3: Dashboard Theming Refactor
**Goal**: The dashboard's brand colour is fully runtime-variable — the ~14 Material Tailwind `color="green"` props and ~37 `green/emerald` Tailwind utility classes are replaced with a CSS-variable mechanism fed by the logged-in user's company palette, and tenant colour isolation is guaranteed
**Depends on**: Phase 2
**Requirements**: THEME-01, THEME-02, THEME-03, THEME-04
**Success Criteria** (what must be TRUE):
  1. Logging in as a company with a custom palette (e.g. blue) shows all previously-green brand chrome (buttons, highlights, accents) in that company's colour, without a page reload
  2. Logging in as a company with no custom palette shows the same green appearance as before v3 — the default fallback is visually identical to the current app
  3. Changing company A's palette does not alter the colour seen by users of company B — tenants are visually isolated
  4. No hardcoded `color="green"`, `green-`, or `emerald-` brand-colour occurrences remain in the migrated call-sites
**Plans**: 3 plans
**Wave 1**
  - [x] 03-01-PLAN.md — Theming infrastructure: brand Tailwind family, MD-green :root defaults, shade-derivation utility, BrandingProvider variable-writer (THEME-01/03/04)
**Wave 2** *(blocked on Wave 1 completion; 03-02 and 03-03 run in parallel — no file overlap)*
  - [x] 03-02-PLAN.md — Migrate brand call-sites on the six dashboard feature pages; semantic-green exclusions documented (THEME-02)
  - [x] 03-03-PLAN.md — Migrate brand call-sites in the dashboard navbar chrome and blog admin page (THEME-02)
**UI hint**: yes

### Phase 4: Email Theming
**Goal**: Branded emails sent by the platform (invite, verification, and other company-branded sends) use the company's saved brand colour, inlined directly into the email HTML per-send — separate from the CSS-variable dashboard mechanism
**Depends on**: Phase 2
**Requirements**: EMAIL-01, EMAIL-02
**Success Criteria** (what must be TRUE):
  1. An invite or verification email received by a user of a company with a custom palette contains the company's brand colour as an inline style attribute (not a CSS class or variable)
  2. The same email for a company with no saved palette uses the default brand colour — no broken or unstyled fallback
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Branding Cleanup | v1 | 1/1 | Complete   | 2026-06-04 |
| 2. Login Code Cleanup | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 3. CI/CD Pipeline | v1 | 3/3 | Complete    | 2026-06-10 |
| 4. Compatibility Spike + Baseline | v2 | 4/4 | ✅ Complete | 2026-06-04 |
| 5. Server Runtime on Bun | v2 | 3/3 | ✅ Complete | 2026-06-04 |
| 6. Package Management | v2 | 2/2 | ✅ Complete | 2026-06-05 |
| 7. Docker, CI/CD, and Scripts | v2 | 3/3 | ✅ Complete | 2026-06-05 |
| 1. Compatibility Spike | v3 | 1/1 | ✅ Complete | 2026-06-06 |
| 2. Branding Management | v3 | 3/3 | ✅ Complete | 2026-06-09 |
| 3. Dashboard Theming Refactor | v3 | 0/3 | Planned | - |
| 4. Email Theming | v3 | 0/TBD | Not started | - |

---

*Roadmap updated: 2026-06-10 — Phase 3 Dashboard Theming Refactor planned (3 plans, 2 waves)*
