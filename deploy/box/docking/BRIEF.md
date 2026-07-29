# Build brief: the docking service for the Amsterdam box

**Hand this whole file to the implementing agent.** It is self-contained. Read it before writing
anything; the constraints are unusual and several of them are the result of measurement rather
than preference.

---

## The one-paragraph version

A drug-discovery platform (`app.pyxis-discovery.com`) runs its 1-click docking by proxying one
HTTP call to a third-party service in Moscow, which goes down because of the war. That service
is being replaced by a machine in Amsterdam. **Your job is to build the replacement service**,
matching the existing response byte-shape exactly, because the platform's frontend parses it
with brittle string matching that fails silently. **You are not building the GPU engine** — you
are building the four things around it, and making the engine pluggable so all of this is
testable today, with no GPU and no access to the platform.

## Hard constraints

1. **This must be developed and tested WITHOUT a GPU and WITHOUT running anything on the
   owner's laptop.** Everything ships as a Dockerfile plus a test suite that runs in that
   container against a committed fixture. Assume the reviewer runs `docker build && docker run`
   on a remote host, or CI does. **Do not write instructions that assume a local Python env, a
   local GPU, or `pip install` on the reader's machine.**
2. **The docking engine is behind an interface with a `replay` backend** that returns the
   committed reference payload. Every other stage must be fully exercisable through it. If the
   only way to test your code is "wait for the GPU", the design is wrong.
3. **Do not invent the contract.** Every byte-level requirement below was measured from
   production output. Where something is marked *unknown*, it is genuinely unknown — surface it,
   do not guess and do not paper over it.
4. **No network calls at request time except RCSB**, and those must be cached (see §5).
5. Python is the sensible choice (RDKit, OpenMM, Meeko are all Python). Nothing forces it.

## Repo context

| Path | What |
|---|---|
| `deploy/box/docking/reference/1cx7-asinex.json` | **the ground truth** — a real production response, `{pdb, sdf}` |
| `deploy/box/docking/reference/README.md` | its provenance and what it cannot tell you |
| `scripts/verify-docking-response.mjs` | **the acceptance test.** Node, no deps. Exit 0 required |
| `docs/DOCKING-CONTRACT.md` | the full analysis this brief summarises |

Build into `deploy/box/docking/service/`.

---

## 1. The HTTP contract

One endpoint. The platform calls it and nothing else.

```
POST /docking
Content-Type: application/json

{ "pdbID": "1cx7", "smiles": "Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C" }

200 OK
{ "pdb": "<prepared receptor, PDB text>", "sdf": "<docked poses, multi-record V2000 SDF>" }
```

**Four traps, all real, all measured:**

- **The field is `pdbID` — capital D.** Every other layer of the platform says `pdbid`. Accept
  `pdbID`; accepting `pdbid` too is harmless and kind.
- **`smiles` arrives URL-ENCODED.** `%5B` = `[`, `%2B` = `+`, `%3D` = `=`, `%23` = `#`.
  `urllib.parse.unquote` it before RDKit sees it. Idempotence matters: a caller may send it
  unencoded, so decode only if decoding changes it.
- **A comma in the SMILES has already been turned into a semicolon** by the platform's frontend.
  Treat `;` as whatever separator makes sense, or reject it — but do not crash.
- **Return only `pdb` and `sdf`.** The platform adds `simulationKey` itself; anything you put
  there is overwritten.

**Also implement `GET /docking/{pdbid}&{smiles}`** — both parameters in **one path segment**
joined by a literal `&`, not a query string. The platform has a code path for it. Percent-decode
each half.

**Timeout: the caller aborts at 600 s** and refunds the user's credit. Answer well inside it.

**Any non-2xx is treated as a total outage** — credit refunded, user sees `502`. So return 2xx
only for a genuinely usable result, and use a real error status otherwise. Include a readable
`{"error": "..."}` body; nothing parses it, humans read it in logs.

---

## 2. `result.pdb` — receptor preparation. **Exact, and NOT minimised.**

Measured against a fresh RCSB download of `1CX7.pdb`:

```
raw 1CX7.pdb heavy atoms       1289
production receptor heavy      1290
matched by (name, resname, seq) 1289 / 1290
MAX COORDINATE DEVIATION       0.0000 Å
the one extra atom             OXT on LYS 162
hydrogens added                1307
```

**Zero deviation means heavy atoms are copied from RCSB untouched. Do not minimise, do not
relax, do not re-optimise anything.** A minimisation moves heavy atoms and would fail the
acceptance test below.

```
1. GET https://files.rcsb.org/download/{PDBID}.pdb        (uppercase in the URL)
2. keep ATOM records; DROP every HETATM — ligand, waters, ions
3. add OXT at the C-terminus
4. add hydrogens (the reference used OpenMM 8.2) — heavy atoms must not move
5. emit:  REMARK   1 CREATED WITH OPENMM 8.2, YYYY-MM-DD
          ATOM records, then TER, then END
```

Observed properties to reproduce: single chain `A`, occupancy `1.00`, B-factor `0.00`
throughout (B-factors are dropped in preparation), `OXT` on the C-terminal residue.

**Acceptance:** every heavy atom matches the RCSB file at `0.0000 Å`, with exactly one addition
(`OXT`). **Hydrogens are explicitly free to differ** — the reference re-places them stochastically
on every dock, and 1,308 of its 2,601 lines differ between two runs of the same input. **Never
write a test that asserts byte-equality of `result.pdb`.**

---

## 3. The search box — centred on the stripped co-crystal ligand

Not in the payload. Recovered by measuring where the poses landed:

| | |
|---|---|
| pose centroid spread across 5 poses | 1.2 / 2.0 / 2.1 Å — one tight cluster |
| protein bounding box | 36.5 × 41.6 × 50.0 Å |
| pose centroid → protein centroid | 13.7 Å — nowhere near the middle |
| **pose centroid → `HED` centroid** (the co-crystal ligand in `1CX7`) | **1.23 Å** |
| → `HOH` centroid / → `CL` centroid | 14.1 Å / 18.6 Å — not those |

**This is redocking.** Before stripping HETATMs in §2 step 2, record the centroid of the
co-crystallised ligand and centre the AutoDock grid there.

⚠ **Pick the largest NON-WATER, NON-ION HETATM group.** In `1CX7` waters outnumber the real
ligand 114 atoms to 8, and their centroid is 14 Å wrong. Exclude `HOH`, `WAT`, `DOD` and
monoatomic ions (`CL`, `NA`, `MG`, `ZN`, `CA`, `K`, `SO4`, `PO4`, `GOL`, `EDO`, and the rest of
the usual crystallisation-additive set). Make the exclusion list a visible constant, not a
buried regex.

⚠ **What to do for an apo structure with no co-crystal ligand is UNKNOWN.** Every stored
production dock uses a receptor that has one. Implement a documented fallback — whole-protein
blind box, or a pocket detector — **and log loudly when it is used**, because it is new
behaviour that production has never exhibited. Do not silently guess.

**Unknown, and affecting scores rather than shape:** grid box *dimensions*, exhaustiveness,
random seed, scoring-function version. Make all four **configurable, with the defaults in one
file**, so they can be tuned against the reference scores later.

---

## 4. `result.sdf` — the poses. This is where silent failure lives.

A multi-record V2000 SDF, one record per pose, `$$$$`-separated. Real bytes from production:

```
0:0:0
     RDKit          3D

 18 19  0  0  0  0  0  0  0  0999 V2000
   33.2970   -0.6980   10.1950 C   0  0  0  0  0  2  0  0  0  0  0  0
   ...
M  END
>  <MODEL>  (1) 
1

>  <TORSDO>  (1) 
F 5

>  <SCORE>  (1) 
-4.547

>  <ligand_id>  (1) 
0

>  <original_smiles>  (1) 
Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C

>  <smiles>  (1) 
Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C

$$$$
```

**Reproduce exactly:**

- Title line is the literal string `0:0:0`. Writer line is RDKit's `     RDKit          3D`.
- Tag line is `>` + **TWO SPACES** + `<TAG>` + two spaces + `(1)` + **a trailing space**.
- The **value is on the next line**, then a blank line.
- Tag order: `MODEL`, `TORSDO`, `SCORE`, `ligand_id`, `original_smiles`, `smiles`.
- `<smiles>` is **lowercase**; `<SCORE>` is **uppercase**. Matched case-sensitively downstream.
- `smiles` and `original_smiles` carry the **DECODED** SMILES, even though the request delivered
  it encoded.
- Sorted by `SCORE` **numerically ASCENDING** — most negative first, best first. ⚠ *An earlier
  draft said "descending numerically", which contradicted its own "most negative first". The
  reference is `-4.547, -4.505, -4.468, -4.423, -4.345`: each value is larger than the last.*
- **5 poses in every observed dock — but do NOT hard-fail on a different count.** See below.
- `SCORE` is AutoDock binding affinity in kcal/mol. Negative. The reference range is −4.345 to
  −4.547.

### ⚠ Do NOT hard-fail on a pose count other than 5

Every observed dock returned 5 poses, and it is right to emit 5 by default. **It is wrong to
reject a dock that produced a different number.**

**The user cannot perceive the pose count.** The platform de-duplicates the SDF on the
`<smiles>` value and keeps a single best-scoring block, so 5 poses and 3 poses both render as
**exactly one row**. Turning a usable result into a non-2xx therefore:

- returns `502` to the user and refunds the credit,
- for a dock that actually worked,
- over a difference nothing downstream can observe.

Docking engines legitimately return fewer poses for small or rigid ligands. A strict
`len(poses) == 5` check converts that into an outage.

**Correct behaviour:** emit whatever the engine produced. `WARN` when the count is not 5, with
the count and the inputs. Fail only on **zero** poses, which is a genuinely unusable result.
Make the expected count a config value, not an assertion.

### Why the spacing is not a style question

The platform reduces this SDF with a literal string match:

```js
if (line.startsWith('>  <smiles>')) { ... }     // server/index.js:3372 — TWO spaces
```

Emit `> <smiles>` with one space and **every pose is dropped**, the endpoint returns **HTTP 200**
with an empty body, and the user sees a rendered protein, an empty pose table, no score, and no
error in any log. It looks like the dock worked. `scripts/verify-docking-response.mjs` exists
specifically to catch this.

### `<TORSDO>` with the value `"F 5"` is a bug you must decide about

AutoDock's PDBQT records torsional degrees of freedom as `TORSDOF 5`. Asinex's PDBQT→SDF
converter split that line at a fixed column, so the tag became `TORSDO` and the value became
`"F 5"`. It has been stored that way for months, and the platform's frontend reads
`properties.TORSDO`.

**Default: reproduce it bug-for-bug** — tag `TORSDO`, value `F 5` where 5 is the real torsional
count. Emitting a clean `<TORSDOF>` makes that column display `N/A` unless the frontend changes
in the same release. Put it behind a config flag and default to the bug.

### All poses of one ligand must share one `<smiles>` value

The platform de-duplicates on the `<smiles>` value and keeps the single lowest-scoring block, so
5 poses collapse to **1 row** in the UI. If your poses carry per-pose canonical SMILES that
differ, the user sees 5 rows where production shows 1.

---

## 5. Caching — the biggest real win, and it is safe

Asinex **re-downloads and re-protonates the receptor on every single dock.** That is why its
`REMARK` date tracks the dock date and why its hydrogens move between runs. Caching it is pure
upside and changes no byte of the contract.

```
/srv/cache/receptors/{pdbid}/
    source.pdb        raw RCSB download
    receptor.pdb      prepared, exactly what result.pdb returns
    receptor.pdbqt    engine input
    box.json          {center: [x,y,z], size: [x,y,z], ligand_resname: "HED"}
    maps/             autogrid grid maps
    META.json         {rcsb_fetched_at, prep_version, engine_version}
```

- **Key on lowercased `pdbid`.** The platform sends lowercase; RCSB wants uppercase in the URL.
- **First dock against a protein pays for download, preparation and grid maps. Every later
  ligand against that protein skips all three.** This is where the box beats Moscow by more than
  raw GPU speed, and it is most of the perceived speedup.
- **Write atomically.** Prepare into a temp directory and `os.rename` it into place, so two
  concurrent docks on a cold protein cannot interleave and half-write a cache entry. Take a
  per-`pdbid` lock; the loser waits for the winner rather than duplicating the work.
- **Include `prep_version` in `META.json` and bump it whenever preparation changes**, so stale
  entries are invalidated rather than silently served.
- Record the **actual measured size per receptor** somewhere visible. The ~60 MB figure in the
  older planning docs is an estimate that has never been checked.
- Provide a way to purge one entry and to warm a list of `pdbid`s ahead of time.

⚠ **State this in the README as a deliberate behavioural change:** caching makes hydrogen
positions **stable** for a given receptor, where production varies them every run. This is an
improvement, not parity. Anyone comparing two docks of the same input will see identical
receptors from the box and different ones from Asinex.

---

## 6. The engine interface

```python
class DockingEngine(Protocol):
    def dock(self, receptor_pdbqt: Path, ligand_pdbqt: Path, box: Box, cfg: EngineConfig) -> list[Pose]: ...
```

Ship **three** implementations:

| Backend | Purpose |
|---|---|
| `replay` | returns the committed reference payload. **Default in tests.** Makes every other stage testable with no GPU |
| `vina` | AutoDock Vina, CPU. Runs anywhere, including CI. The correctness reference |
| `autodock-gpu` | the real one. **Do not attempt to build or verify this — see §8** |

Select with `DOCKING_ENGINE=replay|vina|autodock-gpu`. The whole pipeline must pass its tests
under `replay` and under `vina` before anyone touches a GPU.

---

## 7. Acceptance

```bash
docker build -t pyxis-docking deploy/box/docking/service
docker run --rm -e DOCKING_ENGINE=replay -p 8000:8000 pyxis-docking &

curl -s -X POST localhost:8000/docking -H 'Content-Type: application/json' \
  -d '{"pdbID":"1cx7","smiles":"Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C"}' \
  > candidate.json

node scripts/verify-docking-response.mjs --file candidate.json \
  --baseline deploy/box/docking/reference/1cx7-asinex.json
```

**Exit 0 is the bar.** That script runs the payload through both of the platform's parsers,
byte-for-byte, and prints the pose table the dashboard would render. It has been validated: the
real Asinex response passes; the same response with one-space tags fails.

Also required:

- Receptor heavy atoms match RCSB at `0.0000 Å` (§2), asserted in a test.
- A second dock against the same `pdbid` is served from cache, asserted by timing or a counter.
- Concurrent cold-cache docks on the same `pdbid` produce one cache entry, not a corrupt one.
- A bad SMILES and an unknown PDB ID return non-2xx with a readable error — **never** a 2xx with
  an empty or partial payload, because 2xx means "charge the user".

---

## 8. AutoDock-GPU: `nvcr.io/hpc/autodock:2020.06`

The owner suggested this image. **Evaluate it; do not assume it works.** Unverified here — the
target GPUs do not exist yet. What to actually check, on the box, once it arrives:

- **Architecture support is the live question.** The target is **2× RTX 5090 — Blackwell,
  `sm_120`, requiring CUDA ≥ 12.8 and driver ≥ 570.** A `2020.06` image is CUDA 11.x era and was
  built years before `sm_120` existed. It will only run at all if its binaries embed forward-
  compatible PTX that the driver can JIT, and a CUDA 11 → `sm_120` JIT is a long jump. **Assume
  it does not work until it demonstrably does**, and verify with
  `nvidia-smi` + a trivial dock inside the container before building anything on it.
- **Licensing is probably fine, unlike the alternatives.** NGC **HPC** containers are not NIM
  and not NVIDIA AI Enterprise. NVAIE was refused for this project and NIM does not support
  GeForce cards — neither restriction applies to an HPC container. Confirm the image's own
  licence terms; do not carry over the NIM conclusion.
- **It gives you one of five pieces.** The container is the docking binary. Receptor prep, box
  detection, PDBQT conversion, SDF writing and the HTTP wrapper are all still yours.
- **The likely better path is building upstream** `ccsb-scripps/AutoDock-GPU` from source with
  `make DEVICE=CUDA TARGETS=120`, which targets Blackwell directly instead of hoping a 2020
  binary JITs onto it. Treat the NGC image as a **reference for how they wire it up**, and as a
  fallback.

**Nothing in §8 blocks §1–§7.** Build against `replay` and `vina`, keep the engine behind the
interface from §6, and the GPU decision stays a one-line swap made later, with hardware in hand.

---

## 9. Deliverables

1. `deploy/box/docking/service/` — the service, Dockerfile, tests.
2. A README covering: what is reproduced bug-for-bug and why; what deliberately differs (the
   cache, §5); every tunable and its default; what is still unknown (apo receptors, error shape,
   grid dimensions).
3. Tests that pass under `DOCKING_ENGINE=replay` with **no GPU and no network** (fixture the
   RCSB fetch), and under `vina` with network.
4. **No compose file.** `deploy/box/compose.yml` already defines the `docking` service —
   build `deploy/box/docking/service` on port 8000, `CACHE_DIR=/srv/cache`, `/srv/cache`
   mounted, `DOCKING_ENGINE` selecting the backend, and a `GET /health` for its healthcheck.
   **Conform to it.** If something there is wrong, say so in your README rather than editing it.

**Do not modify** `scripts/verify-docking-response.mjs` — it encodes the platform's real
parsers, and loosening it to make your output pass defeats the entire point. If you believe it
is wrong, say so and explain; do not edit it.

---

## Concurrency — this brief runs in parallel with the other one

`deploy/box/docking/BRIEF.md` and `deploy/box/BRIEF-SERVICES.md` are built **at the same time by
different agents**. Their build directories are disjoint and neither depends on the other, so
there is no ordering requirement.

**To keep it that way, do not edit any shared file.** Specifically:

| Do not touch | Why |
|---|---|
| `deploy/box/compose.yml` | already wires every service, with ports, GPU pinning and healthchecks. **Match it.** If it is wrong, say so in your README — do not edit it |
| `deploy/box/.env.example` | same |
| `docs/README.md`, `CLAUDE.md`, `docs/*.md` | the other agent may be editing them |
| `scripts/verify-docking-response.mjs` | it encodes the platform's real parsers. Loosening it to make your output pass defeats the point |

Work on your own branch or git worktree and do not commit outside your own directories. Anything
you believe belongs in a shared file goes in **your** README as a proposed change, with the
reason. A human merges it.
