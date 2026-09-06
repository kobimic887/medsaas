# Protein design: research findings and implementation decisions

Recorded 2026-09-06 from the owner's supplied multi-agent research report
(reported source access date 2026-09-06). This preserves findings, sources,
uncertainties, and future work; it is not authorization to implement the backlog.
Research claims below are attributed to that report unless explicitly described
as independently checked. Recheck current contracts, prices, and licenses before use.

## Owner context and current work

- The compute box is planned, **not ordered and not received** (owner correction).
  Do not make current features depend on it. Older wording saying ordered is stale.
- Simulation stock search is being implemented by another agent. The separate
  Tanimoto picker did not complete that task. The previously verified stock import
  was scratch-only. Do not call stock search live without fresh evidence.
- Protein design is adjacent to small-molecule discovery, not the same workflow.
  Anna's stock fingerprint data is not a protein-binder training/benchmark dataset.
- Hosted NVIDIA is the current folding policy, not an immutable scientific rule.
  The owner can authorize another provider later. No provider switch is approved.
- No binder generator, Proteinbase import, laboratory order, or ESMFold2 integration
  has been implemented as part of this research.

## What was understood

A molecular fingerprint search finds similar catalog compounds. Protein sequence
or structure search finds related proteins. Folding predicts structure; complex
prediction proposes how molecules assemble. Binder generation designs new protein
sequences/backbones. Ranking prioritizes candidates; laboratory assays establish
binding under their measured conditions. A confidence score is not KD, and binding
alone does not prove biological function or therapeutic usefulness.

Existing Pyxis auth, credits, scientific-service adapters, viewers, and docking job
patterns are reusable. Protein campaigns additionally need target/epitope inputs,
generation, sequence design, complex prediction, filtering, diversity selection,
provenance, and experimental-result tracking.

## Code-backed findings and implemented response

The research found a Protein Folding UI and authenticated NVIDIA OpenFold3 proxy,
MolMIM generation, docking/DiffDock and Molstar. It did not establish live prediction
success or fold persistence. No protein sequence/structure search or binder-design
product surface was established. The MCP predict_protein_structure tool forwards
OpenFold3; public HTTPS/OAuth for the Life Sciences connector needs separate review.

Independently checked NVIDIA documentation confirmed UI contract mismatches:
`ccd_codes` versus `ccd_code`, protein alignment inputs, and results nested in
`outputs[].structures_with_scores[]`.

Commit **2c9cc61** implements:
- documented query-only A3M when custom CSV MSA is absent, with an explanation;
- CCD field correction and basic unique-chain/empty-input validation;
- extraction/selection of individual returned structures and confidence metrics;
- downloads tied to the submitted name and returned coordinate format;
- an inline Molstar preview with origin/source-checked messaging and mmCIF support,
  preserving the PDB default for existing docking messages;
- an explicit error for responses containing no predicted structures.

See [OPENFOLD-UI-CONTRACT.md](OPENFOLD-UI-CONTRACT.md). Frontend build, contract
fixtures, existing viewer lifecycle and authenticated-fetch checks passed on the
coding host. **No real keyed prediction or browser-rendering check was completed.**
This code is committed/pushed and was not deployed as of this record.

## Proteinbase evidence and possible use

The report describes Adaptyv's reference data: sequences, methods, targets,
expression outcomes, KD, kon/koff, negatives, kinetic curves and predicted-structure
confidence. Example: `/proteins/noble-bat-topaz`.

Reported public exports:
- `/download`: a full dump labelled ODC-BY, dated 2026-01-28 at inspection;
- collection CSV through `/api/proteins/download?collectionId=…&slug=…`;
- RBX1 collection export: 322 data records; fields include id, name, sequence,
  author, designMethod, and evaluations containing JSON metrics.

Do not assume an export endpoint constitutes a supported stable query API.
Adaptyv Foundry API is a separate paid experimental service.

Unresolved: generic ODC-BY versus RBX1 ODC-ODbL licensing; competition BLI wording
versus SPR-labelled metrics; stale full-dump date and inconsistent UI counts.
Verify applicable terms before rehosting. Links can provide references without
building a database mirror. A dashboard of links alone is lower priority than
fixing an existing scientific workflow; a benchmark/reference browser is useful
only if it supports an actual researcher task.

## ESMFold2 evidence and possible use

The report identifies Biohub ESMFold2 (EvolutionaryScale lineage), distinct from
older Meta ESMFold; announcement around May 2026, preprint June 2026. It reports
all-atom protein/DNA/RNA/ligand complexes, optional MSA on the full model,
MIT licensing, and hosted Biohub/OpenProtein options. No NVIDIA NIM SKU was found.
Reported outputs include pLDDT/PAE/pTM/ipTM. These do not establish binding affinity.

Adding ESMFold2 would introduce a new provider; replacing OpenFold3 would also
change current policy. Before implementation, verify exact checkpoint/hosted
version, accepted inputs, async/polling/cancellation, quotas, costs, data retention,
privacy, and commercial terms. The report's ~24 GB/~500-residue hardware comment
is an unvalidated estimate, not a capacity plan. Do not order hardware from it.

## Binder tools and scientific evidence

Research candidates, with terms to verify per exact version/dependency:
- RFdiffusion family: backbone generation; report describes BSD licensing.
- ProteinMPNN/SolubleMPNN: sequence design; report describes MIT licensing.
- BindCraft/FreeBindCraft: design pipeline; MIT code does not remove all dependency
  questions, particularly PyRosetta commercial licensing.
- BoltzGen: all-atom binder generation; report describes MIT licensing.
- Boltz/Boltz-2: co-folding; small-molecule affinity heads must not be generalized
  to arbitrary protein-binder KD. Report notes hosted NVIDIA Boltz-2 availability.
- AF2/AF3, Chai, OpenFold, Protenix, ESMFold2: prediction/filtering options with
  different code/weight/service terms; no blanket commercial-license conclusion.

These are multi-stage campaigns with GPU and assay costs. An LLM can orchestrate
such tools; a wrapper does not inherit published hit rates. Potential platform:
target intake → epitope → backbone → sequence → complex prediction → ranking →
diversity → lab export/results. Preserve versions, seeds, inputs and failed designs.

## Anthropic quotation and RBX1: preserve distinctions

The supplied research attributes the original “Mythos 5.1 / 10× affinity on three
targets / nearly 50% across 12 targets” quotation to the Fable/Mythos 5.1 announcement.
Its identified targets are EGFR, Nipah G and 15-PGDH; Nipah comparisons are
site-dependent. The report says full design denominators/selection details remain
thin. Earlier coordinating-agent searches found another campaign, so they did not
resolve this quotation. Do not substitute those other campaign numbers.

Separately, the report describes the August Opus 4.8/Mythos Preview campaign:
354/1320 (~26.8%) binders, success against 14/15 targets, pooled top-ranked hit rate
49%, single-target Preview 35.1%, and large compute budgets up to thousands of
H100-hours. These refer to different denominators/setups; do not pool them.
Adaptyv and Twist performed experimental evaluation.

RBX1 reported findings: 322 designs in the exported tested collection, 9 binders
(~2.8%), best KD ~23.7–26 nM depending on representation. A later Anthropic
same-plate re-assay reportedly measured the competition winner at 45 nM versus
3.9 nM for a Claude design. Do not directly merge measurements from different
assays. The competition copy cites 300, target page 321, and collection 322:
preserve these source differences. “12k+ submissions” was secondary-source only.
Tested subsets, curation and rank selection create substantial selection bias.

## Backlog and acceptance gates

1. **Finish current folding verification:** real hosted response through the
   authenticated proxy, credits/errors, PDB/mmCIF rendering, multi-result selection
   and downloads. Do not label fixture checks as successful scientific predictions.
2. **Protein references/benchmarks (candidate):** decide the concrete browsing or
   comparison task; links first or a licensed attributed snapshot. Preserve units,
   assay provenance, negatives and uncertainty. No private API scraping.
3. **Second folding provider (candidate):** compare hosted ESMFold2 against actual
   OpenFold3 needs using matched inputs; cost/privacy/contract approval first.
4. **Binder campaigns (larger product decision):** reproducible job orchestration,
   shortlist export, provenance, compute budget, experimental partner/budget.
   Not contingent on claiming Anthropic's success rates.

Validation has three layers: application correctness (API/UI/credits/viewer),
computational utility (held-out positives and negatives, enrichment/AP versus
baseline, prevent leakage), and wet-lab outcomes (assay-specific binding/KD).
Only the third proves experimentally measured binding. No clinical claims follow.

Owner decisions, when needed: whether binders are a product priority; whether to
allow another hosted folder; link-only versus rehosted reference data; campaign
compute/assay budget; and whether agentic research access/MCP integration is useful.
None blocks completing today's hosted folding fixes or Simulation search.

## Sources supplied by the research report

- https://proteinbase.com/
- https://proteinbase.com/download
- https://proteinbase.com/competitions/gem-adaptyv-rbx1
- https://proteinbase.com/proteins/noble-bat-topaz
- https://www.anthropic.com/claude-fable-and-mythos-5-1
- https://www.anthropic.com/research/Claude-accelerates-protein-design
- Anthropic technical-report file identified as `30bf50e22a01388bb29bf077ee3f244531594b7a.pdf`
  (full URL not supplied; locate from the original article before citing).
- https://www.adaptyvbio.com/blog/anthropic-1
- https://docs.nvidia.com/nim/bionemo/openfold3/1.3.0/example-requests.html
- https://docs.api.nvidia.com/nim/reference/openfold-openfold3-infer
- https://www.biohub.ai/models/esmfold2
- https://github.com/Biohub/esm
- ESMFold2 preprint DOI: `10.64898/2026.06.03.729735`
- Local context: AGENTS.md, docs/BOX-SPEC.md, docs/DATA-STOCK-COMPOUNDS.md,
  docs/CLAUDE-LIFE-SCIENCES.md, server/index.js, protein-folding.jsx,
  services/mcp-server/src/tools.js.

The report did not supply complete citations for every tool/version, hardware
estimate, price, or legal statement. Preserve them as research leads, not verified
procurement or implementation facts.
