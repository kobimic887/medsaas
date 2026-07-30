# DiffDock, rebuilt

Replaces `https://services.asinex.com:58000/molecular-docking/diffdock/generate` — NVIDIA's
DiffDock NIM running on Asinex's own hardware in Moscow. It dies when they do, which is the
whole reason the box exists.

Built against [`reference/`](reference/), the 24 request/response pairs recovered from
`chem_beo`'s own log. Nothing here is a guess at the schema.

```
POST /molecular-docking/diffdock/generate
GET  /health
```

The path is upstream's, unchanged, so the cutover is one variable:

```
DIFFDOCK_API_URL=https://<box-domain>/molecular-docking/diffdock/generate
```

and rollback is putting the Asinex hostname back.

---

## 1. Run it

```bash
# tests — no GPU, no network, no weights, ~0.1 s
docker build --target test -t pyxis-diffdock-test deploy/box/diffdock
docker run --rm pyxis-diffdock-test

# the real image — x86_64 only, needs CUDA. Build it ON THE BOX.
docker compose -f deploy/box/compose.yml --env-file deploy/box/.env build diffdock
```

Before the first real start, populate the weights volume once:

```bash
sudo deploy/box/diffdock/fetch-weights.sh /srv/models/diffdock
```

Then `docker compose ... up -d diffdock`, and confirm the card assignment the compose file
promises:

```bash
docker exec box-diffdock nvidia-smi -L    # exactly one GPU, and not docking's
```

---

## 2. Three things the contract does that look like bugs

**Failure is HTTP 200.** Every failed dock in the captured log came back `200` with a
well-formed body carrying `status: "failed"`. Checking the HTTP status does not detect a
failed dock. This service reproduces that exactly, because the platform's parser depends on
it — see `errors.DockFailure`, the one error class that becomes a 200.

**The arrays are padded to `num_poses` even when nothing was produced.** A failure returns 100
empty strings and 100 nulls. `ligand_positions.length` is *not* a pose count. Tested both
ways: total failure, and a partial success that yields fewer poses than requested.

**`position_confidence` is ranked best-first and index-aligned** with `ligand_positions`. The
dashboard used to pair pose 0 with `confidence[length-1]` and show the best pose labelled with
the worst score. Preserving the order here is what keeps that fixed as a data property rather
than a client-side one.

A structurally invalid request — no `protein`, a protein with no ATOM records — gets a real
`400`, not a failed envelope. Those are caller bugs, not chemistry, and chem_beo already
validates them before calling. What upstream did in that case was never captured.

---

## 3. The escaping bug, fixed here instead of in the caller

`server/index.js` escapes the same field three different ways depending on which branch built
it:

| Path | Escaping | Result |
|---|---|---|
| ligand ID, from RCSB | `\` before each real newline | worked |
| SMILES, via convertSTR | the two characters `\` and `n` | **failed** |
| the retry | none, raw | worked |

The captured log shows the consequence directly: a dock at `12:05:03` came back
`Fail to read ligand molecule description` with the literal-`\n` ligand echoed in the response,
and the *same molecule*, raw, succeeded at `12:05:06`. That three-second gap is the platform's
retry firing in production.

`normalization.decode_escaped` accepts all three forms and reports which arrived, so the
retry never fires again and `chem_beo` can be cleaned up later with evidence rather than
argument. Protein records go through the same path — every protein ever sent was
backslash-newline, and it worked only because PDB parsers read fixed columns and ignore a
trailing backslash past column 80.

The echoed `protein` and `ligand` are still **verbatim what arrived**, escaping included.
That is the observed upstream behaviour, and a caller comparing what it sent against what came
back must not see it silently rewritten.

---

## 4. Engines

`DIFFDOCK_ENGINE` selects the backend.

| Engine | What it is |
|---|---|
| `replay` | four real Asinex poses from the captured reference. **Default**, and what the tests run on. No GPU, no network, no weights |
| `oss` | upstream [gcorso/DiffDock](https://github.com/gcorso/DiffDock) (MIT), pinned to `9a22cbc` (v1.1.3), as a subprocess |

Not the NIM container: NVIDIA AI Enterprise was refused for this project and NIM does not
support GeForce cards, which is what the box has.

### The parameter mapping

NVIDIA's NIM API and upstream DiffDock name the same two knobs differently:

| Request field | Upstream flag | Production sends | Upstream default |
|---|---|---|---|
| `time_divisions` | `--inference_steps` | 20 | 20 |
| `steps` | `--actual_steps` | 18 | 19 |
| `num_poses` | `--samples_per_complex` | 100 | 10 |

Both production values sit on top of upstream's own defaults, which is the strongest available
evidence that the mapping is right. It is asserted in `tests/test_oss_engine.py` so a later
edit cannot quietly change it.

### One deliberate difference from Asinex

DiffDock writes each pose to `rank{N}_confidence{X:.2f}.sdf` and the confidence exists
**only in that filename**, formatted to two decimals. Asinex returned full float64
(`-1.2901878356933594`); this service returns `-1.29`. Nothing downstream computes on the
value — the dashboard prints it — but it is a visible difference and it is recorded here
rather than hidden. Recovering full precision means patching upstream's `inference.py`, which
costs more than it is worth.

---

## 5. What is verified, and what is not

**Verified** — 28 tests, no GPU, no network:

- the seven-key envelope on success and failure, against the captured payloads
- padding to `num_poses`, including a partial success
- best-first ranking and index alignment
- verbatim echo of `protein` and `ligand`
- all three wire escapings, decoded from the real captured strings
- the argv the OSS engine builds, including the NIM parameter mapping
- pose collection from a real DiffDock output layout, including that `rank1.sdf` is written
  twice and must not be counted twice
- `preflight` refusing to serve without a checkout or weights

**Not verified, and cannot be until the box exists:**

- inference itself — the model has never been run
- the dependency set in `requirements-oss.txt` resolving on x86_64. Every pin was checked to
  have a cp310 wheel, but no install has been performed; this Mac is arm64 and Docker was not
  running
- whether DiffDock v1.1.3's code runs unmodified under torch 2.7.1 (upstream pins 1.13.1).
  This is the largest remaining risk in the image and the first thing to exercise on arrival:

  ```bash
  docker compose -f deploy/box/compose.yml run --rm diffdock \
    python -m diffdock_service preflight
  ```

  then a single real dock against `reference/request-canonical.json`.

---

## 6. Notes on the environment

| Variable | Default | Meaning |
|---|---|---|
| `DIFFDOCK_ENGINE` | `replay` (`oss` in the runtime image) | backend |
| `DIFFDOCK_REPO_DIR` | `/opt/diffdock` | upstream checkout |
| `DIFFDOCK_MODEL_DIR` | `/models` | weights volume, read-only |
| `DIFFDOCK_WORK_DIR` | `/tmp/diffdock` | scratch, one directory per request, always removed |
| `DIFFDOCK_TIMEOUT_SECONDS` | `540` | chem_beo aborts at 600 s; finishing inside that leaves room to serialize 100 poses |
| `DIFFDOCK_MAX_POSES` | `100` | requests above this are clamped, not rejected |
| `DIFFDOCK_BATCH_SIZE` | `10` | upstream inference batch |
| `CONVERTSTR_URL` | unset | optional; see below |

`CONVERTSTR_URL` is wired by compose but unused in production today, because the platform
converts SMILES itself before calling. It exists so that a caller which *doesn't* gets a
molecule instead of a confusing `Fail to read ligand molecule description`. With it unset, a
non-SDF ligand produces exactly that upstream string, so the platform's existing handling
still matches.

Access logging is off: a request carries ~100 KB of protein and uvicorn would put it in a log
line. The service logs what matters itself.
