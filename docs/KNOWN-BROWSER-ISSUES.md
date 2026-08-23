# Known browser issues

## Molstar ball-and-stick geometry is invisible in desktop Safari

**Observed:** 2026-08-14 on the owner's Mac with Safari 27.0 and the legacy Pyxis frontend.

### Symptoms

- The protein cartoon renders, but waters, ions, and docked molecules rendered as ball-and-stick
  geometry are invisible.
- Clicking a Docking Results row appears to clear or refresh the viewer without adding the
  selected molecule.
- The missing red dots visible on working devices are mostly the PDB water/ion atoms; their
  absence is an early indication that the affected ball-and-stick shaders did not render.

### Evidence and scope

- The affected SDF endpoints returned HTTP 200 with identical response bytes through both the 83
  and 84 application hosts.
- Safari downloaded and parsed the SDF and Molstar reported the structures as loaded.
- Safari logged hundreds of `WebGL: INVALID_OPERATION: ... program not linked` errors from
  Molstar 5.11.0.
- Chromium on the same Mac rendered the 1CX7 cartoon, ligand, waters, and ions correctly through
  the same hostname and server.
- Mobile Safari on an iPhone also rendered the view and allowed the docking-result row to load.

This is therefore not a DNS, hosts-file, Asinex, MongoDB, simulation-result, or 83-versus-84
failure. It is a desktop Safari/WebGL rendering failure on the observed Mac. Do not generalize it
to every Safari device; browser version, operating system, GPU, and driver all participate in
WebGL shader compilation.

### Legacy/deployed workaround

The legacy deployment is unchanged, so use Chrome/Chromium or Firefox on the affected Mac there.
Mobile Safari is known to work on the tested iPhone. The maintained `pyxis-web` fix described
below takes effect only when that build is deployed.

### Fix and rejected alternative

For the maintained `pyxis-web` viewer, desktop Safari on macOS is detected narrowly and Molstar's
`tryUseImpostor` representation parameter is disabled before any structure loads. This makes
Molstar use ordinary mesh geometry for atoms and bonds instead of the failing sphere/cylinder
impostor shaders. Chromium and touch-based Apple devices retain the normal, faster renderer.

Forcing Molstar's supported `preferWebgl1: true` option was tested first on the affected Mac. The
viewer confirmed that WebGL 1 was active, but it produced the same program-link failures and the
same invisible atoms, so WebGL 1 is **not** a workaround for this issue.

The mesh fallback was then tested on the same loaded 1CX7 structure. All four affected
representations were rebuilt and the ligand, ions, and water atoms—including the missing red
dots—became visible. A future Molstar upgrade may make the fallback unnecessary, but it should
only be removed after the exact desktop Safari path is retested. Molstar's official
[changelog](https://github.com/molstar/molstar/blob/master/CHANGELOG.md) records Safari- and
WebGL-specific compatibility fixes.

No legacy-code workaround was applied during the 2026-08-14 diagnosis; the compatibility change
is limited to the maintained `pyxis-web` viewer.

## Bare Molstar visit (TTL restore)

Opening `/dashboard/molstar3d` with **no** query handoff restores the last docking /
DiffDock localStorage bundle only while it is within ~5 minutes of being saved
(`molstar_result_saved_at`). After the TTL (or Clear / new dock / logout), the
page stays an empty workspace — do not auto-load demo PDBs.
