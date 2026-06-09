---
phase: 2
slug: branding-management
status: approved
shadcn_initialized: false
preset: none
created: 2026-06-09
---

# Phase 2 - UI Design Contract

> Visual and interaction contract for Branding Management. This contract extends
> the existing Company Admin design system; it does not introduce a new UI kit.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | Material Tailwind React 2.1.4 |
| Icon library | Heroicons React 2.0.18, outline set for actions |
| Font | Existing Tailwind sans stack |

Use existing `Card`, `CardHeader`, `CardBody`, `Typography`, `Button`, `Alert`,
`Input`, and `Spinner` components. Native `<input type="color">` and
`<input type="file">` controls are allowed where Material Tailwind has no
equivalent. Do not add a new component or form library.

---

## Screen Structure

### Company Admin navigation

- Keep the existing page title `Company Admin` and company-name subtitle.
- Tab order is exactly: `Members`, `Branding`, `Usage`, `Audit`.
- Branding uses local component state. Refreshing the page returns to Members.
- The Branding tab icon is `SwatchIcon` from Heroicons outline.
- Members do not see the Company Admin navigation item. Direct member navigation
  redirects to `/dashboard/dashboardHome`.

### Branding tab layout

Desktop (`xl` and wider):

- Use a two-column grid: flexible editor column plus a 360px preview column.
- Editor column order: Logo card, Palette card, action row.
- Preview column: sticky within the content area with `top-24`.

Tablet and mobile:

- Stack all cards in one column.
- Order: Logo, Palette, Preview, action row.
- Buttons become full-width below 640px.
- Do not introduce horizontal scrolling.

### Logo card

- Heading: `Company logo`.
- Show the saved logo first when one exists; otherwise show the empty state.
- Use a standard file input with `accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"`.
- Supporting text states accepted formats and the 5 MB limit.
- Selecting a file validates type and size immediately, then requests palette
  extraction. Selection/extraction does not persist branding.
- While extraction runs, disable Save and show `Extracting palette...`.
- A newly selected logo replaces the preview only. The saved logo remains
  authoritative until Save succeeds.

### Palette card

- Heading: `Brand palette`.
- Render four fields in a two-column grid from `md` upward and one column below:
  `Primary`, `Accent`, `Light`, `Dark`.
- Each field contains:
  - 44x44px native color picker with 8px radius.
  - Hex text input using uppercase `#RRGGBB`.
  - Label above both controls.
- Picker and text input stay synchronized.
- Invalid hex input shows inline text `Enter a color as #RRGGBB.` and disables Save.
- Missing extracted light/dark values are derived before fields are displayed.
- Do not show contrast scores, warnings, or save blockers.
- Manual palette entry works when no logo is selected or saved.

### Preview card

- Heading: `Preview`.
- Preview a compact dashboard sidebar header, not a full dashboard mockup.
- Surface contains:
  - Logo constrained to 160x48px with `object-contain`.
  - Company name below the logo.
  - A primary-color active navigation sample.
  - An accent-color compact button sample.
  - Four labeled palette swatches.
- If no logo exists, show the company name in the logo position.
- Preview updates immediately from local form state.
- Preview is illustrative only; Phase 3 owns application-wide dashboard theming.

### Dashboard chrome result

- After save, display the company logo in the existing sidebar header for all
  company users.
- Use logo plus company name, not logo-only.
- Constrain the logo to 160x48px with `object-contain`; never crop or stretch.
- When no logo is saved or the image fails to load, render the existing company
  name text without a broken-image placeholder.
- Do not duplicate the company logo in the top navbar in this phase.

---

## Interaction Contract

1. Opening Branding loads saved branding metadata and logo preview.
2. Selecting a valid logo starts extraction and fills all four local palette
   fields when extraction returns.
3. Editing either a picker or hex input updates the preview immediately.
4. `Save branding` persists the selected logo, if changed, and all four palette
   values in one operation.
5. After save succeeds, refresh shared branding state so the sidebar updates
   without requiring logout.
6. If save fails, keep all unsaved inputs and show the server error.
7. Replacing an existing logo follows the same select, extract, review, save flow.

Do not add auto-save. Do not persist the extracted palette before the admin
presses Save.

---

## States

| State | Required treatment |
|-------|--------------------|
| Initial loading | Centered small spinner plus `Loading branding...` |
| No saved branding | Empty logo state; palette starts from current default brand colors |
| Extracting | Inline spinner, `Extracting palette...`, Save disabled |
| Unsaved changes | Save enabled; helper text `You have unsaved branding changes.` |
| Saving | Button label `Saving...`; file and palette controls disabled |
| Saved | Green alert `Branding saved.` and dirty state cleared |
| Invalid file type | Red alert `Choose a PNG, JPG, or SVG logo.` |
| Oversized file | Red alert `Logo must be 5 MB or smaller.` |
| Invalid hex | Inline field error; Save disabled |
| Extraction failure | Red alert `We could not extract colors from this logo. Enter the palette manually or choose another file.` |
| Load/save failure | Red alert with server message plus `Try again.` when no actionable detail exists |

Alerts use the Company Admin page's existing temporary alert placement below the
page heading. Field errors remain visible until corrected.

---

## Spacing Scale

Declared values are multiples of 4:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Label-to-control and icon gaps |
| sm | 8px | Compact control gaps, swatch labels |
| md | 16px | Form-field gaps and card internals |
| lg | 24px | Card padding and grid gaps |
| xl | 32px | Major content separation |
| 2xl | 48px | Empty-state vertical padding |
| 3xl | 64px | Reserved; not required in this tab |

Exceptions: Native file input internal browser spacing.

Use the existing page rhythm: `mt-8 space-y-6`, 24px card gaps, and 16px form
stacks. Minimum interactive target height is 40px; color pickers are 44px.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 14px | 500 | 1.4 |
| Heading | 20px | 600 | 1.3 |
| Display | 30px | 600 | 1.2 |

- Page title continues to use Material Tailwind `variant="h3"`.
- Card headings use `variant="h5"`.
- Helper and error text use `variant="small"`.
- Hex values use the existing monospace stack.
- Do not use all-caps headings. Uppercase is limited to normalized hex values
  and existing small metadata labels.

---

## Color

These values govern the admin editing surface only. User-selected palette values
appear inside the preview and color controls but do not retheme the admin page
in Phase 2.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#FFFFFF` | Cards and input surfaces |
| Secondary (30%) | Tailwind `blue-gray-50/50` and `blue-gray-100` | Page background, borders, muted regions |
| Accent (10%) | `#B4B239` | Selected Branding tab, primary Save action, active preview sample |
| Destructive | Material Tailwind `red` / `#EF4444` | Validation and request errors only |

Accent reserved for: selected Company Admin tab, `Save branding`, active preview
navigation sample, and small brand-related icons. It is not applied to every
interactive control.

Color swatches must use a visible `blue-gray-200` border so white or very light
colors remain distinguishable.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Tab label | `Branding` |
| Logo heading | `Company logo` |
| Palette heading | `Brand palette` |
| Preview heading | `Preview` |
| Primary CTA | `Save branding` |
| Empty state heading | `No company logo yet` |
| Empty state body | `Upload a PNG, JPG, or SVG logo to extract a starting palette, or enter colors manually.` |
| File helper | `PNG, JPG, or SVG. Maximum 5 MB.` |
| Unsaved helper | `You have unsaved branding changes.` |
| Success | `Branding saved.` |
| Invalid type | `Choose a PNG, JPG, or SVG logo.` |
| Oversized file | `Logo must be 5 MB or smaller.` |
| Extraction error | `We could not extract colors from this logo. Enter the palette manually or choose another file.` |
| Hex error | `Enter a color as #RRGGBB.` |
| Generic error | `{Server message} Try again.` |

Use sentence case. Use `logo`, not `brand image`; use `palette`, not `theme`,
because full dashboard theming is deferred to Phase 3.

---

## Accessibility and Input Behavior

- Every file, picker, and hex input has a visible label or associated
  `aria-label`.
- Color meaning is always accompanied by the field name and hex text.
- Alerts use the existing `Alert` component and are readable by assistive
  technology.
- Keyboard users can reach tabs, file input, all color controls, and Save in
  visual order.
- Focus rings remain visible; do not suppress browser or Material Tailwind focus
  styles.
- Logo preview `alt` text is `{Company name} logo`.
- Redirect authorization logic must not depend only on hidden navigation.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not required |
| Third-party registries | none | no registry code permitted |

No shadcn initialization or registry components are required.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-06-09
