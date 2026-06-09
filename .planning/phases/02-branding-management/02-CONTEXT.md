# Phase 2: Branding Management - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver company-scoped branding management for owner/admin users: upload and
validate a PNG/JPG/SVG company logo, extract a palette for review, allow manual
palette entry or overrides, persist the logo and palette on the MongoDB company
record, and display the saved logo in dashboard chrome for that company's users.
Members must be denied branding-management access in both the client and server.

This phase creates the branding data and management workflow. Migrating the
dashboard's hardcoded green styles to runtime palette variables belongs to Phase
3, and applying the palette to email HTML belongs to Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Settings location and access
- **D-01:** Branding management lives as a new tab inside the existing Company
  Admin page rather than as a separate dashboard route.
- **D-02:** The tab order is Members, Branding, Usage, Audit.
- **D-03:** The active Company Admin tab remains local component state. Do not
  add a query parameter or dedicated URL for the Branding tab.
- **D-04:** If a member navigates directly to
  `/dashboard/company-admin`, redirect them to the dashboard rather than showing
  the admin page or a standalone access-denied screen.
- **D-05:** Client-side hiding/redirecting is only presentation behavior. All
  branding read/write operations that expose admin management data must remain
  protected server-side by `requireCompanyAdmin`.

### Palette controls
- **D-06:** Expose exactly four named editable palette fields: `primary`,
  `accent`, `light`, and `dark`.
- **D-07:** Every palette field provides both a visual color picker and a
  synchronized hexadecimal text input.
- **D-08:** When extraction yields fewer than four usable colors, derive missing
  light/dark variants from the available primary/accent colors instead of
  falling back to the current green palette or forcing the admin to fill every
  field.
- **D-09:** Validate color syntax as hexadecimal values, but do not calculate,
  warn about, or block low-contrast color combinations in this phase.

### Decisions carried forward
- **D-10:** Store the logo and palette on the MongoDB company document. Do not
  add GridFS, S3, or other object-storage infrastructure.
- **D-11:** Use `node-vibrant@4` through `node-vibrant/node` and `sharp@0.34`
  for in-process palette extraction. Rasterize SVG input with `sharp` before
  passing it to node-vibrant.
- **D-12:** Treat node-vibrant swatches as nullable and rank populated swatches
  by population rather than assuming specific named swatches are present.
- **D-13:** Branding management is available to company `owner` and `admin`
  roles only. Members cannot upload a logo or change a palette.

### the agent's Discretion
- Exact maximum logo file size, within the project's MongoDB/BSON storage
  constraint, and the precise validation error wording.
- Whether logo upload and branding save use one request or staged requests,
  provided extracted values are reviewable before the final persisted update.
- Exact preview composition and the logo sizing/cropping treatment in dashboard
  chrome, while satisfying ADMIN-02 and LOGO-04.
- Mapping extracted swatches into the four named fields beyond the locked
  dominant/population rules, including the color transformation used to derive
  missing light/dark variants.
- API endpoint naming, response shape, loading states, and test organization,
  following existing project patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and product requirements
- `.planning/ROADMAP.md` — Phase 2 goal, dependencies, success criteria, and
  the boundary with dashboard and email theming phases.
- `.planning/REQUIREMENTS.md` — LOGO-01 through LOGO-04, PALETTE-01 through
  PALETTE-04, and ADMIN-01 through ADMIN-03.
- `.planning/PROJECT.md` — milestone-level storage, extraction, multi-tenant,
  dependency, and infrastructure decisions.

### Proven extraction behavior
- `.planning/phases/01-compatibility-spike/01-CONTEXT.md` — locked compatibility
  criteria and intended palette structure.
- `.planning/phases/01-compatibility-spike/01-01-SUMMARY.md` — Phase 1 outcome,
  dependency versions, import shape, and SVG findings.
- `spike/VIBRANT-FINDINGS.md` — reproducible Bun/arm64 evidence and production
  guidance for node-vibrant and sharp.

### Existing application patterns
- `client/src/pages/dashboard/company-admin.jsx` — Company Admin tabs, forms,
  messages, company data loading, and existing company-scoped upload workflow.
- `client/src/routes.jsx` — `adminOnly` route metadata for Company Admin.
- `client/src/widgets/layout/sidenav.jsx` — admin menu filtering and dashboard
  brand header/logo integration point.
- `client/src/layouts/dashboard.jsx` — dashboard shell and current branding
  hook usage.
- `client/src/context/auth.jsx` — owner/admin role detection and stored user
  context.
- `client/src/hooks/useBranding.js` — current company-name branding hook to
  extend with persisted company branding.
- `server/index.js` — company document normalization, `requireCompanyAdmin`,
  audit events, company endpoints, and the existing ligand-upload persistence
  pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CompanyAdmin`: Existing tabbed admin surface with loading, save-state, alert,
  and company-data patterns. Add Branding after Members instead of creating a
  new administration shell.
- `companyRequest`: Existing authenticated JSON request helper local to Company
  Admin. It can support branding endpoints if the chosen upload representation
  remains JSON-compatible.
- `buildLigandUploadPayload` and the ligand upload form: Closest current pattern
  for immediate client size checks, base64 transport, MongoDB persistence, and
  clear upload errors.
- `requireCompanyAdmin` and `recordAuditEvent`: Existing server authorization
  and company-change audit patterns.
- `useBranding`: Existing shared branding access point used by the dashboard
  layout; it can become the client-facing source for saved logo/palette data.

### Established Patterns
- Dashboard route visibility uses `adminOnly` metadata plus `isAdmin()`, while
  server mutations independently enforce `requireCompanyAdmin`.
- Company configuration is normalized in server helpers, persisted as nested
  fields on the company document, and returned as sanitized metadata from
  company endpoints.
- Frontend forms use Material Tailwind cards/inputs, local React state, explicit
  save buttons, spinner states, and temporary success/error alerts.
- API calls remain same-origin through `API_CONFIG.buildApiUrl`.

### Integration Points
- Extend the Company Admin tab registry and render the Branding panel after
  Members.
- Extend company normalization and API responses in `server/index.js` with a
  sanitized branding object and a separate authenticated logo-delivery path if
  raw binary content should not be embedded in general company responses.
- Extend dashboard branding state so all users in the authenticated company can
  load the saved logo for `Sidenav`/dashboard chrome, while only admins receive
  management controls.
- Replace the current hardcoded `brandImg="/img/logo-ct.png"` input with the
  saved company logo plus the existing text fallback.

</code_context>

<specifics>
## Specific Ideas

- Keep branding visually and navigationally part of Company Admin.
- The palette editor should be approachable and precise: four labeled swatches,
  each with a color picker and editable hex value.
- Missing extracted values should be completed automatically so an admin starts
  with a full four-color proposal.

</specifics>

<deferred>
## Deferred Ideas

- Contrast analysis and accessibility warnings for palette combinations are not
  part of this phase.
- Runtime application of palette colors across dashboard components remains
  Phase 3.
- Palette-driven email styling remains Phase 4.

</deferred>

---

*Phase: 2-Branding Management*
*Context gathered: 2026-06-09*
