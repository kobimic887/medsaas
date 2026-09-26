# Design preview maintenance

This directory contains inputs for the design-system export. It is not an
application entry point or generated runtime output.

- `config.json` maps preview components to application sources and configures
  viewports. Keep its component map aligned with the exports in `client/.ds-entry.jsx`.
- `client/.ds-entry.jsx` provides router, auth, controller, and a fixed light-theme
  context for isolated previews. Real application screens use the normal providers.
- `cssEntry` points to a generated frontend CSS filename. After rebuilding the app,
  update it to the actual artifact before exporting previews.
- Keep the hand-maintained prop descriptions aligned with source PropTypes.
- Disable chart animations for static captures and use a desktop viewport for the
  sidebar, which is hidden below the `xl` breakpoint.

The export keeps its existing `ChemBench` JavaScript global for compatibility.
User-facing documentation and product text use Pyxis Discovery. See
[conventions.md](conventions.md) for component usage.
