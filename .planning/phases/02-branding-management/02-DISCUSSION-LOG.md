# Phase 2: Branding Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 2-Branding Management
**Areas discussed:** Settings location, Palette controls

---

## Settings Location

### Management surface

| Option | Description | Selected |
|--------|-------------|----------|
| Branding tab in Company Admin | Reuse the existing admin-only page and navigation. | ✓ |
| Dedicated Branding page | Add a separate dashboard destination for branding. | |
| the agent decides | Leave surface selection to planning. | |

**User's choice:** Branding tab in Company Admin.

### Tab position

| Option | Description | Selected |
|--------|-------------|----------|
| First tab | Make company identity the primary admin setting. | |
| After Members | Keep team management first, then branding. | ✓ |
| Last tab | Preserve all current tab positions before branding. | |

**User's choice:** Place Branding after Members.

### URL behavior

| Option | Description | Selected |
|--------|-------------|----------|
| `/company-admin?tab=branding` | Make the selected tab bookmarkable and directly linkable. | |
| Local tab state only | Keep current tab behavior; refresh returns to Members. | ✓ |
| the agent decides | Leave URL behavior to planning. | |

**User's choice:** Local tab state only.

### Direct member navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Redirect to dashboard | Remove the member from the admin surface without rendering controls. | ✓ |
| Access-denied page | Explain the denial on a dedicated screen. | |
| the agent decides | Leave member routing behavior to planning. | |

**User's choice:** Redirect members to the dashboard.

---

## Palette Controls

### Editable palette size

| Option | Description | Selected |
|--------|-------------|----------|
| Four named colors | Primary, accent, light, and dark. | ✓ |
| Primary and accent only | Expose only the two core extracted colors. | |
| All extracted swatches | Expose every populated node-vibrant swatch. | |

**User's choice:** Four named colors.

### Color input

| Option | Description | Selected |
|--------|-------------|----------|
| Color picker plus hex input | Combine visual selection with precise text entry. | ✓ |
| Color picker only | Use visual selection without direct hex entry. | |
| Hex input only | Use compact precise text entry without a picker. | |

**User's choice:** Color picker plus hex input for every field.

### Missing extracted colors

| Option | Description | Selected |
|--------|-------------|----------|
| Derive light/dark variants | Complete the four-color proposal from primary/accent. | ✓ |
| Use default green palette | Fill missing values from the current application palette. | |
| Require admin entry | Leave missing fields empty until the admin fills them. | |

**User's choice:** Derive missing light and dark variants.

### Contrast handling

| Option | Description | Selected |
|--------|-------------|----------|
| Warn but allow | Show contrast warnings without blocking save. | |
| Block low contrast | Reject combinations below a contrast threshold. | |
| No contrast checks | Validate color syntax only. | ✓ |

**User's choice:** No contrast checks.

---

## the agent's Discretion

- Exact upload size limit and transport/API shape.
- Save transaction boundaries and extraction loading behavior.
- Preview composition and dashboard logo sizing/cropping.
- Exact swatch-to-field mapping and light/dark derivation algorithm.

## Deferred Ideas

- Palette contrast analysis or accessibility warnings.
- Dashboard-wide runtime color application in Phase 3.
- Email color application in Phase 4.
