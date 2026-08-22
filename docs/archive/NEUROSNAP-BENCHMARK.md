# Neurosnap benchmark and Pyxis feature roadmap

> **Archived 2026-08-22.** Aspirational capability roadmap — expands scope against
> [`../../GOAL.md`](../../GOAL.md). Not an execution plan. Host roles:
> [`../POST-PROMOTION-HANDOFF.md`](../POST-PROMOTION-HANDOFF.md).

**Date:** 2026-08-03  
**Purpose:** Use Neurosnap as a capability benchmark, not a branding, UI, or code template.

## Product direction

Pyxis should remain the Pyxis application users already recognise: the current dashboard,
Simulation, Deep Similarity, Molecular Viewer, Protein Folding, Literature and Control Panel
pages stay in place. The opportunity is to make those pages work together as a coherent research
workbench:

1. define a molecule, protein, or complex;
2. launch one or more analyses;
3. see a durable status and useful progress;
4. inspect structures, poses, metrics and evidence;
5. compare candidates;
6. download a reproducible result package or continue the workflow.

This is a feature roadmap, not permission to replace the current navigation with a Neurosnap-like
shell or to copy Neurosnap's visual design, code, naming, or proprietary implementation.

## Public benchmark findings

The following capabilities are documented in Neurosnap's public materials as of August 2026:

| Capability | What the benchmark exposes | Pyxis opportunity |
|---|---|---|
| Structure prediction | Protein and multimolecule prediction services, including protein/nucleic-acid/ligand inputs and confidence-style outputs | Keep NVIDIA OpenFold3 as the hosted backend. Improve Pyxis input validation, result rendering, confidence presentation and downloads rather than building a second folding stack |
| Docking | DynamicBind, DiffDock-L, GNINA and other docking services | Make Pyxis docking reliable and explainable: engine, score, pose count, runtime, status, comparison and Molstar inspection. Amsterdam should host qualified local engines; Asinex remains the rollback target until cutover is proven |
| Structure-conditioned design | LigandMPNN/ProteinMPNN and binder-design services are presented as advanced workflows | Possible later feature, but only after checking model licenses, GPU memory, scientific validation and safety. Do not promise a design model merely because a page exists |
| Molecular dynamics | GROMACS workflows with configurable force fields, solvent, temperature, duration and system setup | Turn the existing GROMACS page into a guided workflow with uploads, validation, durable jobs, progress, metrics, trajectory viewing and artifacts |
| MD analysis | RMSD, RMSF, radius of gyration, hydrogen bonds, SASA, DSSP and energy-style analysis | Strong differentiator for Pyxis once CUDA GROMACS is qualified on Amsterdam; show plots and a concise interpretation alongside raw downloads |
| 3D visualization | Molstar/PDB animation and structure inspection | Pyxis already has Molstar, Ketcher and 3Dmol. Add pose comparison, selected-pose state, clear status, overlays and export actions instead of replacing the viewers |
| Job lifecycle | Pending, running, failed, completed, deleted and cancelled states; polling, duplicate/rerun and job history | Build one shared job model and history surface behind the existing pages. This is the foundation for bulk screening and long-running MD/folding UX |
| Artifacts and reproducibility | Inputs, configuration and output files can be queried/downloaded | Add an authenticated artifact manifest, named downloads, configuration capture, result metadata and optional result notes |
| Collaboration | Notes, sharing controls, teams and shared compute pools | Add private-by-default notes and explicit share links only after tenant/RBAC and artifact authorization are proven |
| API/SDK | Service discovery, submission, status, listing, file retrieval and job duplication | Pyxis already has an MCP server with 14 tools. Make it reachable securely, fix unavailable service dependencies, then add workflow-oriented tools rather than another generic chat page |

### Public sources

- Neurosnap docs: <https://neurosnap.ai/docs/>
- Neurosnap API tutorial: <https://neurosnap.ai/blog/post/full-neurosnap-api-tutorial-the-quick-easy-api-for-informatics/66b00dacec3f2aa9b4be703>
- GROMACS service: <https://neurosnap.ai/service/GROMACS%20Molecular%20Dynamics>
- gmx_MMPBSA service: <https://neurosnap.ai/service/gmx_MMPBSA>
- DynamicBind: <https://neurosnap.ai/how-to-use/DynamicBind>
- GNINA: <https://neurosnap.ai/how-to-use/GNINA>
- LigandMPNN: <https://neurosnap.ai/how-to-use/LigandMPNN>
- BoltzGen announcement: <https://neurosnap.ai/blog/post/boltzgen-a-universal-generative-framework-for-biomolecular-binder-design/6914d2838b9522d6ffefa787>
- Neurosnap SDK: <https://github.com/NeurosnapInc/neurosnap>

These links are references for capability discovery. They are not evidence that every listed
service is open-source, licensed for redistribution, or scientifically appropriate for Pyxis.
License, model-card, data-use and validation review is required before integrating any model.

## What Pyxis already has

The current repository already contains useful building blocks:

- **Molecule Viewer:** RDKit-backed local parsing where available, 3Dmol fallback, examples,
  representation settings and exports.
- **Ketcher:** browser molecule drawing/editor.
- **Molstar:** protein/receptor and docked-pose viewing, SDF loading, pose overlays and explicit
  clear/reload controls.
- **One-click docking and DiffDock paths:** authenticated API routes, credit charging/refunds,
  result persistence and a documented docking response contract.
- **Deep Similarity:** exact, similarity and substructure searches over the Tanimoto/RDKit corpus,
  with fingerprint and metric controls.
- **Protein Folding:** a multimolecule OpenFold3 input form supporting protein, DNA, RNA and ligand
  entities plus optional MSA input; the backend is an NVIDIA hosted proxy by design.
- **Molecule generation:** NVIDIA MolMIM hosted proxy.
- **GROMACS API shape:** asynchronous job IDs, status polling, logs, file operations and workflow
  endpoints exist, but the production scientific deployment and guided UI are incomplete.
- **ADMET and glioblastoma interfaces:** code and MCP tools exist, but deployment/qualification is
  not complete according to the architecture docs.
- **Claude for Life Sciences MCP:** 14 declarative tools already map to search, generation,
  folding, docking, catalog, prices, ADMET, GROMACS and prediction routes.

## Important architecture boundaries

These are constraints, not suggestions:

- `84.13.81.51` (`oracleNew`) is the live application host. **`83` is scheduled for imminent
  shutdown** — not a long-lived standby/rollback host. Staging for this roadmap targets
  `84:5174` only unless a separate production approval is given. ⚠ “Rollback to `83`” wording
  elsewhere needs owner confirmation of the post-kill target.
- The Amsterdam machine is **compute-only**. It gets qualified docking, DiffDock, conversion,
  Tanimoto/Postgres/RDKit, GROMACS, ADMET and glioblastoma services. It does not receive the API,
  Pyxis MongoDB, billing or auth.
- MongoDB Atlas remains the application database. Jobs, ownership, credit accounting, notes and
  artifact metadata should remain tenant-scoped there.
- NVIDIA MolMIM and OpenFold3 remain hosted services. Do not start a local MSA/OpenFold rebuild as
  a side effect of this roadmap.
- Local compute must be protected by the application auth/credit layer, Caddy/TLS and a strict
  service allowlist. Never expose a raw GPU endpoint to the internet.
- Asinex catalog/stock data remains an external dependency where licensing or live stock requires
  it. Keep a rollback path while local docking is qualified.

## Prioritized roadmap

### P0 — MCP and workflow reliability (highest product leverage)

**Goal:** let Claude drive the existing Pyxis capabilities safely, while the normal dashboard
remains the primary UI.

1. Put the MCP endpoint behind the same authenticated HTTPS origin as the application; do not
   expose port 8080 directly.
2. Replace the current raw-JWT connector assumption with a deliberate authorization flow suitable
   for the target Claude connector, or explicitly keep it as a local/stdio integration until that
   flow exists.
3. Make tool availability honest: platform health should show which scientific services are live;
   unavailable GROMACS/glioblastoma/ADMET tools should return a clear capability state, not a
   mysterious 502.
4. Add workflow-level tools after the existing tools are proven:
   - `prepare_docking_run` — validate protein/ligand inputs without spending a credit;
   - `submit_docking_run` — explicitly spend/record a credit and return a job handle;
   - `get_job` / `list_jobs` — status and ownership-aware history;
   - `compare_poses` — summarize scores and selected artifacts;
   - `export_result_package` — create a reproducible, authorized bundle.
5. Keep every tool declarative and reuse the existing platform routes; do not create a second
   business-logic implementation in the MCP server.

### P1 — Shared jobs and results foundation

**Goal:** make long operations feel reliable and make every later feature cheaper.

Create a common job contract for docking, DiffDock, ADMET, folding and MD:

```text
id, companyId, userId, kind, status, createdAt, startedAt, completedAt,
progress, stage, inputSummary, config, creditEventId, error,
artifactManifest, parentJobId, retryOf
```

Required behavior:

- statuses: `queued`, `running`, `completed`, `failed`, `cancelled`, `expired`;
- tenant/RBAC checks on every read, cancel, retry, delete and artifact download;
- idempotency key to prevent double submission and double charging;
- credit reservation before dispatch, refund on pre-execution failure, and an audit trail;
- bounded retries with no automatic retry after an ambiguous charge unless the operation is
  idempotent;
- polling first; realtime updates only after measuring the need;
- retention and cleanup rules for large PDB/SDF/trajectory artifacts;
- a result page that links back to the originating inputs and configuration.

This should be implemented before exposing bulk screening or user-facing GPU scheduling.

### P2 — Useful UI features while preserving current pages

**Simulation / docking**

- Add a compact status strip: receptor, ligand, engine, queue state, elapsed time and credit
  status.
- Add “Compare poses” beside the existing Open Viewer/Save SDF actions.
- Show pose score, rank, engine and confidence/quality fields only when the backend actually returns
  them; never invent confidence values.
- Allow selecting a pose and sending it into Molstar, Ketcher or a download package.
- Add a bounded batch input for SMILES with validation, maximum batch size, progress and partial
  results. This is the first major Neurosnap-style feature, but it depends on P1.

**Protein Folding**

- Keep the existing entity form, but add sequence validation, character counts, estimated input
  summary and a clear “hosted NVIDIA service” label.
- Render returned PDB/mmCIF in Molstar when the response contains a structure instead of showing
  only a raw text block.
- Display confidence/metric fields only when present in the response and preserve raw output
  download.
- Save request configuration and result metadata in the shared job model.

**Deep Similarity**

- Add result selection and “send selected molecules to screening/cart/viewer.”
- Add bounded multi-select export (CSV/SDF where available), not an unbounded browser download.
- Preserve exact/substructure modes and current fingerprint/metric controls.

**Molecular Viewer / Ketcher**

- Add a consistent artifact/status toolbar, not another dashboard inside the viewer.
- Support side-by-side or toggled pose comparison, receptor/ligand visibility and a selected-pose
  indicator.
- Keep the visible Ketcher workspace frame and fix overflow at 200% zoom before adding controls.

### P3 — Amsterdam compute features

Ship only after each service has its own health test, resource limit and rollback:

1. **Reliable local docking:** CPU Vina/AutoDock-compatible path first; AutoDock-GPU only after
   hardware qualification. Record engine, version, queue wait and runtime.
2. **DiffDock local service:** validate the response against the committed docking contract, cap
   concurrency by GPU memory, and reject unauthenticated direct access.
3. **Bulk virtual screening:** queue bounded batches, stream or poll partial top hits, cancel work,
   and retain the top results plus a manifest rather than every intermediate blob by default.
4. **CUDA GROMACS:** guided setup, trajectory artifacts, RMSD/RMSF/energy extraction and Molstar
   trajectory playback after the CUDA build is qualified.
5. **ADMET batch:** deploy the worker, define retry behavior for old queued records, show property
   cards with model/version metadata, and never imply clinical validity.
6. **Glioblastoma:** deploy only after key rotation and service qualification; label it as research
   prediction, not diagnosis or treatment advice.

### P4 — Advanced research features (later, gated)

- gmx_MMPBSA/MMGBSA-style binding-energy analysis after trajectory provenance is solid.
- Structure-conditioned sequence design (ProteinMPNN/LigandMPNN or alternatives) only after model
  license, input/output safety, GPU memory and scientific validation review.
- Binder design or generative design only as an explicitly research workflow with strong input,
  output and attribution controls.
- Team notes, explicit share links, and reproducible project bundles after artifact authorization
  and deletion semantics are tested.

## What not to do

- Do not copy Neurosnap's UI, wording, code or brand identity.
- Do not build every model in its catalog. A long model list is not a product advantage if half the
  services are unavailable or unvalidated.
- Do not move API/auth/billing/MongoDB to Amsterdam.
- Do not expose GPU controls, raw service ports, or arbitrary GROMACS command execution to ordinary
  users.
- Do not add a second job queue or second result storage system for each feature.
- Do not add WebSockets, Kubernetes or multi-GPU scheduling before polling, limits and measured
  workloads justify them.
- Do not claim clinical, diagnostic or therapeutic conclusions from research predictions.

## Recommended first implementation batch

Preserve the current UI and build the first visible value around **MCP plus result continuity**:

1. Create the shared job/artifact contract and capability-health response.
2. Add a read-only Jobs/Recent Runs panel to the existing dashboard or Control Panel; do not
   remove recognised pages.
3. Add “Open Viewer,” “Compare,” “Download package” and “Retry” only where a real artifact/result
   exists.
4. Add MCP `get_job`, `list_jobs`, `compare_poses` and `export_result_package` after the platform
   routes are authorized and tested.
5. Then implement bounded bulk docking using the same job model.

This gives Pyxis the most visible Neurosnap-class benefits—reliable workflows, history, artifacts,
comparison and automation—without replacing the current UI or prematurely building unqualified
AI services.
