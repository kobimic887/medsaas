# Viewer compatibility

## Desktop Safari atom and bond rendering

Some desktop Safari/WebGL combinations can load a structure while leaving
ball-and-stick atoms and bonds invisible. Protein cartoons may still render.

The maintained [Molstar page](../client/public/molstar/index.html) detects
desktop Safari on macOS and disables `tryUseImpostor` before structures load.
This uses mesh geometry instead of sphere/cylinder impostor shaders. Chromium
and touch-based Apple devices keep the default rendering path.

Retain that narrow fallback until a Molstar upgrade has been tested on the
affected desktop Safari path. Check ligand, water, and ion visibility as well
as protein cartoons and selection behavior. Forcing WebGL 1 alone did not
resolve the original shader-link failure. Chromium or Firefox is a useful
comparison when diagnosing an affected browser.

## Opening the Molstar page directly

A bare `/dashboard/molstar3d` visit restores the last docking or DiffDock
browser-storage bundle only within its five-minute lifetime, tracked by
`molstar_result_saved_at`. After expiry, Clear, a new docking handoff, or logout,
the page may correctly show an empty workspace. It should not silently load
a demo structure.

Relevant checks:

```bash
bun run test:viewer-handoff
bun run test:molecule-viewer
```

Lifecycle checks do not replace visual verification on the affected browser.
