# The DiffDock contract, captured from production

Captured **2026-07-29** from `83.229.87.94:/root/chem_beo/diffdock_api.log` — 7.9 MB of
request/response traffic that `chem_beo` has been writing since 2026-02-25 and that nobody had
looked at. It holds **24 request/response pairs**, of which 8 succeeded.

`docs/NEXT-SESSION.md` §3 said the DiffDock response schema was "**completely uncaptured**" and
called capturing one from Moscow "the highest value item on this list". That is no longer true,
and no call to Asinex was needed: it was already on disk. **This directory is that contract.**

## Upstream

```
POST https://services.asinex.com:58000/molecular-docking/diffdock/generate
```

Asinex running NVIDIA's DiffDock NIM container on their own Moscow hardware — not NVIDIA-hosted.
It dies with Asinex. `deploy/box/BRIEF-SERVICES.md` builds the replacement from OSS DiffDock;
build it against these files.

## Request

`request-canonical.json`. Eight fields, and `chem_beo` has never varied six of them:

| Field | Type | Observed |
|---|---|---|
| `protein` | string | PDB `ATOM` records, `\n`-joined. ~100 KB typical |
| `ligand` | string | a full SDF, from `/convertSTR` — **not** SMILES |
| `ligand_file_type` | string | always `"sdf"` |
| `num_poses` | int | `1` (2026-02) then `100` (2026-03 onward) |
| `time_divisions` | int | always `20` |
| `steps` | int | always `18` |
| `save_trajectory` | bool | always `false` |
| `is_staged` | bool | always `false` |

## Response

Seven keys, **the same seven on success and on failure**. `protein` and `ligand` are echoed back
verbatim, so the response is roughly twice the request.

| Key | Type | On success | On failure |
|---|---|---|---|
| `status` | string | `"success"` | `"failed"` |
| `details` | string | `"success without retry"` | see below |
| `ligand_positions` | string[] | `num_poses` SDF blocks | `num_poses` **empty strings** |
| `position_confidence` | (float\|null)[] | `num_poses` floats | `num_poses` **nulls** |
| `trajectory` | string[] | `num_poses` entries | `num_poses` empty strings |
| `protein` | string | echoed | echoed |
| `ligand` | string | echoed | echoed |

### Three things a reimplementation must get right

**1. Failure is HTTP 200.** Every failed dock in the log came back `200` with a well-formed JSON
body carrying `status: "failed"`. **Checking the HTTP status does not detect a failed dock.**
Read `status`.

**2. The arrays are padded to `num_poses` even when nothing was produced.** A failure returns 100
empty strings and 100 nulls, not an empty array. **Array length is not a pose count** — a caller
that trusts `ligand_positions.length` reports 100 poses for a dock that produced none. Test
element emptiness.

**3. `position_confidence` is ranked best-first and index-aligned with `ligand_positions`.**
Strictly descending in all 8 captured successes:

| Captured | poses | best | worst |
|---|---|---|---|
| 2026-03-02T12:05:06Z | 1 | −1.290 | −1.290 |
| 2026-03-02T16:58:46Z | 100 | −0.583 | −5.562 |
| 2026-03-02T17:03:29Z | 100 | −0.359 | −4.460 |
| 2026-03-02T17:10:47Z | 100 | −0.602 | −4.384 |
| 2026-03-02T19:18:10Z | 100 | −0.758 | −4.836 |
| 2026-03-02T19:43:32Z | 100 | −0.556 | −7.308 |
| 2026-03-03T11:10:35Z | 100 | −0.102 | −4.892 |
| 2026-03-03T11:10:55Z | 100 | −0.288 | −5.247 |

`ligand_positions[i]` pairs with `position_confidence[i]`. **The client used to violate this** —
it stored `ligand_positions[0]` and `position_confidence[length-1]`, so the viewer showed the
best pose labelled with the worst pose's confidence (−0.10 displayed as −4.89 on the run above).
Fixed in `client/src/pages/dashboard/simulation.jsx`. A rebuilt service must preserve the
descending order or that bug comes back as a data problem instead of a code one.

### Failure `details` strings, both observed

```
Fail to read ligand molecule description
Fail to generate complex graph -need at least one array to concatenate
```

Free text, not a code. Do not parse it; surface it.

### And it is not always JSON

`response-html-error-page.txt` — on 2026-02-25 and again on 2026-03-02, seven requests came back
as an HTML error page with no JSON body at all. `JSON.parse` throws on it. **A client must not
assume a JSON body on any status code.**

## `/convertSTR`, captured in the same log

SMILES→SDF, `83.229.87.94:8001`, in front of every DiffDock call. Request `{"smiles": "..."}`,
response `{"sdf": "<V2000 block>"}`.

Two things the log settles:

- **It has been down since 2026-06-04.** The last line of the log is a `SMILES->SDF REQUEST` at
  `12:15:34.015Z` with **no matching response**, and nothing after it. That is the moment
  DiffDock broke in production, and it is why `deploy/box/convertstr/` exists.
- **Input arrives untrimmed.** That final request was `{"smiles":" C#Cc1ccc(cc1)C#C"}` — a leading
  space. Whatever replaces it must trim, or reject with a message that says so.

## Files

| File | What |
|---|---|
| `request-canonical.json` | a real request, `protein` truncated |
| `response-success-1pose.json` | complete, untrimmed — the smallest whole success |
| `response-success-100pose-trimmed.json` | 100-pose success, arrays cut to 3; original lengths recorded in the file |
| `response-failed-unreadable-ligand.json` | `status: "failed"`, padded arrays |
| `response-failed-complex-graph.json` | the second failure string |
| `response-html-error-page.txt` | the non-JSON response |

Trimming is noted inside each file it applies to. **The array length is part of the contract; the
trimming is not** — read `_original_array_lengths` before writing a test against these.

The unabridged 7.9 MB log stays on 83 at `/root/chem_beo/diffdock_api.log`. It is the only copy
and it is not in git — 105 KB of protein per line, 24 times over. Pull it again if a question
here goes unanswered; do not delete it.
