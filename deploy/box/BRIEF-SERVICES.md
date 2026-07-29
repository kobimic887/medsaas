# Build brief: convertSTR, DiffDock, and the ADMET worker

**Hand this whole file to the implementing agent.** Self-contained. Companion to
[`docking/BRIEF.md`](./docking/BRIEF.md), which covers the docking service — read that one
first if you have not; the shared conventions (engine interface, replay backend, no-laptop
rule) are explained there and reused here.

Three services, in the order they are worth building.

| | Buildable and testable **today**? | Why it matters |
|---|---|---|
| **1. convertSTR** | **entirely** — CPU, RDKit, no GPU, no network | It is **down in production right now**, which is why DiffDock is broken. Smallest service, largest immediate win |
| **2. DiffDock** | wrapper yes, inference needs GPU | Runs on Asinex's Moscow hardware and dies with them |
| **3. ADMET worker** | **entirely** — CPU path testable | **Never deployed.** Every job any user ever queued is still `status: "queued"` |

## The rules, same as the docking brief

1. **Nothing runs on the owner's laptop.** Ship a Dockerfile plus tests that run inside it.
   No "pip install" on the reader's machine, no local GPU assumptions.
2. **Nothing waits for the GPU.** Anything GPU-bound goes behind an interface with a
   CPU/replay backend so the rest is testable now.
3. **Do not invent contracts.** What is below was read from the running production server on
   2026-07-29. Where something says *unknown*, it is genuinely unknown — surface it.
4. Build into `deploy/box/convertstr/`, `deploy/box/diffdock/`, and
   `services/admet/` (which already exists — extend it).

---

# 1. convertSTR — SMILES to 3D SDF

**The entire contract**, read from `chem_beo/index.js:2540`:

```
POST /convertSTR
Content-Type: application/json

{ "smiles": "CC(=O)Oc1ccccc1C(=O)O" }        ← RAW SMILES, not URL-encoded

200 OK
{ "sdf": "<SDF text>" }
```

That is all of it. One route, one field in, one field out.

**Its source code does not exist.** It ran on `83.229.87.94:8001`, nothing listens there now,
and there is no copy of it anywhere on that machine. It is a clean-room rebuild from this
contract — which is fine, because the contract is three lines.

### What the caller does with your output

```js
const sdfContent = sdfJson.sdf;
const normalizedSdf = sdfContent.replace(/\r\n/g, '\n');
const sdfWithDelimiter = normalizedSdf.includes('$$$$') ? normalizedSdf : `${normalizedSdf}\n$$$$\n`;
```

So: CRLF is normalised for you, and `$$$$` is appended if you omit it. Emit `\n` and a
trailing `$$$$` anyway — matching what the consumer expects unmodified is cheaper than relying
on its tolerance.

### Requirements

- **3D coordinates, not 2D.** The output feeds a docking engine. RDKit:
  `EmbedMolecule` (ETKDGv3) then `MMFFOptimizeMolecule`. A flat molecule silently produces
  garbage poses rather than an error.
- **Add explicit hydrogens** before embedding.
- **Invalid SMILES returns a real error status**, not a 2xx with an empty `sdf`. The caller
  checks `response.ok` and returns `400` to the user; a 2xx with junk is far worse.
- **Deterministic**: fix the embedding random seed so the same SMILES gives the same SDF.
  Production's behaviour here is unknown, but determinism is strictly easier to debug and
  nothing downstream depends on variation.
- `GET /health`.
- Note the SMILES may contain a `;` — the platform's frontend rewrites a `,` into one before
  sending. Handle or reject explicitly; do not crash.

### Acceptance

- Round-trip: `CC(=O)Oc1ccccc1C(=O)O` in, parse the SDF back with RDKit, canonical SMILES out,
  compare. Must match.
- Non-zero Z coordinates in the output (proves 3D).
- Garbage in (`"not a smiles"`) gives a non-2xx and a readable error.
- Runs with no network and no GPU.

---

# 2. DiffDock

**Currently broken in production** — it calls convertSTR, which is down. Fixing service 1
un-breaks it against Asinex, before any of this replaces anything.

### What the platform sends

Read from `chem_beo/index.js` (`makeDiffDockRequest`):

```
POST https://services.asinex.com:58000/molecular-docking/diffdock/generate

{
  "ligand":           "<SDF text, newline-escaped — see the bug below>",
  "ligand_file_type": "sdf",
  "protein":          "<PDB, ATOM LINES ONLY, newline-escaped>",
  "num_poses":        100,
  "time_divisions":   <caller-supplied>,
  "steps":            <caller-supplied>,
  "save_trajectory":  <caller-supplied>,
  "is_staged":        <caller-supplied>
}
```

The client reads `position_confidence`, `ligand_positions`, `protein`, `ligand` off the
response. **The full response shape is NOT captured** — unlike 1-click docking, no DiffDock
result was ever stored in the database, so there is no reference payload. **Capture one from
Asinex before Moscow goes dark**; without it this service is being built blind. Say so loudly
rather than guessing a schema.

### How the caller builds those two fields

```js
// protein: fetched from RCSB, ATOM lines only
const atomLines = pdbContent.split('\n').filter(l => l.startsWith('ATOM')).join('\n');
var protein_bytes = atomLines.replace(/\n/g, '\\\n');       // backslash + REAL newline

// ligand, path A — a 3-char ligand ID, fetched from RCSB
ligand_bytes = sdfWithDelimiter.replace(/\n/g, '\\\n');     // backslash + REAL newline

// ligand, path B — a SMILES, via convertSTR
ligand_bytes = sdfWithDelimiter.replace(/\n/g, '\\n');      // literal backslash-n  ← DIFFERENT
```

⚠ **The two ligand paths escape differently, and that is a bug.** `'\\\n'` is a backslash
followed by a real newline; `'\\n'` is the two characters `\` and `n`. Same field, same
endpoint, two encodings depending on whether the user picked a ligand ID or typed a SMILES.

The caller has a **retry that proves it bites**: if the response `details` contains
`"Fail to read ligand molecule description"`, it retries with the completely unescaped
`ligand_raw`. That fallback exists because the escaping is unreliable.

**Your service should accept all three forms** — backslash-newline, literal `\n`, and raw —
and normalise on the way in. Then the platform's retry never fires and the bug stops mattering
without anyone having to change `chem_beo`. Log which form arrived, so the caller can be
cleaned up later with evidence.

### Requirements

- `POST /molecular-docking/diffdock/generate`, same JSON shape, so the cutover is a URL swap.
- **Engine behind an interface** (docking brief §6): `oss` (real, `gcorso/DiffDock`, MIT) and
  `replay`. Everything except inference must be testable without a GPU.
- **OSS DiffDock, not the NIM container.** NVIDIA AI Enterprise was refused for this project
  and NIM does not support GeForce cards. Torch **cu128** for Blackwell `sm_120`.
- Model weights are a build-time or volume-mounted artifact (`/models`), never downloaded at
  request time.
- `num_poses: 100` is what the platform asks for. Note the runtime — 100 poses is not free, and
  the caller aborts at 600 s.
- `GET /health`.

---

# 3. ADMET worker

`services/admet/` exists and has **never been deployed**. `chem_beo:4085` publishes a job to
RabbitMQ whenever a docking result has no ADMET data, and no consumer has ever run. Users have
been seeing `status: "queued"` since the feature shipped, and nobody noticed, because nobody
watches a broker's queue depth.

### Replace RabbitMQ with a Mongo collection

Decided in [`docs/BOX-ARCHITECTURE.md`](../../docs/BOX-ARCHITECTURE.md) §5. CloudAMQP goes.

- No external account, no broker to operate.
- **Queryable** — "how many jobs are stuck" becomes a `find()`. That is exactly the property
  whose absence hid this bug for months.
- The workload is **four docking results in three months**. A network broker between two
  processes on one machine is solving a problem that does not exist.

```js
// collection: admet_jobs
{ _id, simulationKey, smiles, status: 'queued'|'running'|'done'|'error',
  attempts: 0, createdAt, startedAt, finishedAt, error, result }
```

- Claim work with a single atomic `findOneAndUpdate({status:'queued'}, {$set:{status:'running', startedAt}})`
  so two workers cannot take the same job.
- **Requeue stale `running` jobs** — a worker killed mid-job otherwise leaves one stuck
  forever, which is the failure this whole change is meant to make visible.
- Cap `attempts` and move to `error` with the message. Never retry forever silently.
- Write results back via `PUT /api/simulation/{simulationKey}/admet`, which already exists in
  this repo's server and is authenticated by `requireAdmetCallbackAuth`.

### Requirements

- **The current Dockerfile pulls a CPU-only torch wheel.** For GPU: base on
  `nvidia/cuda:12.8.x-runtime-ubuntu24.04`, install **cu128 torch BEFORE `admet-ai`**, then
  verify inside the built image:
  ```
  python -c "import torch; print(torch.cuda.is_available())"
  ```
  ⚠ Installing `admet-ai` after cu128 torch can silently reinstall the CPU wheel through
  chemprop's pins. **That failure never raises — it is just slow forever.** Assert it in the
  build.
- CPU must remain a supported mode, so the queue logic is testable with no GPU.
- The publisher side (`chem_beo` writing to RabbitMQ) is **not yours to change** unless the
  server swap has shipped. Write the worker so it can be fed by either, and note which.

---

## Deliverables

1. `deploy/box/convertstr/` — service, Dockerfile, tests. **Do this one first.**
2. `deploy/box/diffdock/` — service, Dockerfile, tests, `replay` backend, and a written note
   that the response schema is uncaptured.
3. `services/admet/` — Mongo-backed queue, GPU Dockerfile with the torch assertion, tests.
4. Each with a README: what is reproduced exactly, what deliberately differs, what is unknown.

[`deploy/box/compose.yml`](./compose.yml) already wires all three, with ports, GPU pinning,
healthchecks and the exposure warning. Match the service names and ports there rather than
inventing new ones.

**Do not** expose any of these to the internet, and do not add authentication-free routes that
cost GPU time. The platform reaches them from one fixed address.

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
