# The docking output contract

**Captured 2026-07-28 from production, while Asinex was still answering.** This is Phase 0.1
of [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) — the one task whose deadline was set by the war
rather than by hardware delivery. It is now done, and this file is the reference the OSS
AutoDock rebuild has to match.

Source: the `simulation_logs` collection of the production database (MongoDB Atlas, database
name `test`). §1–§5 are observed, not inferred, except where marked.

**§0 was added 2026-07-29 and is a different kind of evidence** — it is read from
`server/index.js`, not from production data. It is the half that was missing: §1–§5 say what the
engine must *return*, §0 says what it must *accept*. You cannot build the service from the
response shape alone.

---

## 0. The request contract — what the box's docking service must accept

The whole 1-click path, end to end:

```
 user picks a molecule from the Asinex catalog  →  SMILES lands in `searchCode`
 user types a 4-char PDB ID
 user clicks Dock
        │  client/src/pages/dashboard/simulation.jsx:679-693
        │  smiles = searchCode.replace(',', ';').trim()       ← comma becomes SEMICOLON
        │  body   = { pdbid, smiles: encodeURIComponent(smiles) }
        ▼
 POST /api/simulation                              server/index.js:3131
        │  authenticateToken → requireActiveUser → company active? → monthly cap?
        │  CACHE LOOKUP: simulation_logs.findOne({ ...tenantFilter, pdbid, smiles })
        │     ← hit returns free, before any charge. Matches the ENCODED smiles (§4)
        │  CHARGE one credit, atomically, refundOnDisconnect: false
        ▼
 POST {dockingApiUrl}                              ← THE BOX REPLACES THIS
        │  { pdbID: "1cx7", smiles: "<url-encoded>" }
        │  10 minute timeout
        ▼
 non-2xx → throw → REFUND → 502 "Docking service is unavailable"
 2xx     → store { username, companyId, pdbid, smiles, result, simulationKey, method:'POST' }
        ▼
 { ...result, simulationKey }  →  Molstar renders result.pdb, poses from result.sdf
```

### The two call shapes

| | Request |
|---|---|
| **POST** (`:3191`) — **the live path** | `POST {dockingApiUrl}`, JSON body `{ pdbID, smiles }` |
| **GET** (`:3034`) | `GET {dockingApiUrl}/{encodeURIComponent(pdbid)}&{encodeURIComponent(smiles)}` |

Default `dockingApiUrl`: `https://services.asinex.com:8000/docking` (`server/index.js:87`),
per-company overridable via `ligandServiceConfig`.

### Four things that will be got wrong

1. **The body field is `pdbID` — capital D.** Every other layer says `pdbid`. Get it wrong and
   the box receives `undefined` for the receptor.
2. **`smiles` arrives URL-encoded, and must be decoded before any toolkit sees it.** The client
   encodes once; the server's guard —
   `smiles === decodeURIComponent(smiles) ? encodeURIComponent(smiles) : smiles` — sees it is
   already encoded and passes it through unchanged. So the engine gets
   `Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C`, not the raw SMILES.
3. **The GET form puts both parameters in one path segment joined by a literal `&`** — it is not
   a query string. `…/docking/1cx7&Cc1c(non1)…`. Anything routing on `?` will not match it.
   No production record uses GET (§5), but the route exists and is authenticated, so the box
   should serve it or the platform should drop it — decide, do not leave it half-wired.
4. **A comma in the SMILES becomes a semicolon** before encoding, client-side. Presumably a
   multi-ligand separator. Whatever the box does with it must match, because the cache key is
   the post-transformation string.

### The performance requirement is a ceiling, not a target

**10 minutes** (`EXTERNAL_HTTP_TIMEOUT_LONG_MS = 600000`, `server/index.js:217`). Past that the
platform aborts, refunds, and returns 502. Asinex answers inside it today, so the box only has
to be *not slower* to be correct — everything beyond that is the actual user-visible win, and
it is unmeasured until the cards exist.

The first dock against a receptor pays for preparation and `autogrid` maps; subsequent ligands
against the same receptor should not. Caching those is where the box beats Moscow by more than
raw GPU speed — see §2's note that this is an improvement over the reference, not parity.

⚠ **Unverified against `chem_beo`.** §0 is read from *this repo's* server. Production runs
`chem_beo`, and its request shape was not re-checked in the session that wrote this. §1–§5 come
from production data and are unaffected. **Before building against §0, confirm it on 83:**

```bash
grep -n 'pdbID\|docking' /root/chem_beo/index.js
```

---

## 1. What the platform stores

```js
{
  _id:           ObjectId,
  user:          { username: string, iat: number, exp: number },   // ← the raw JWT payload
  pdbid:         string,      // 4 chars, e.g. "1cx7"
  smiles:        string,      // URL-ENCODED — see §4
  result: {
    pdb:         string,      // ~210 KB — the prepared receptor
    sdf:         string,      // 5–10 KB — the docked poses
  },
  simulationKey: string,      // 12 chars, [a-z0-9], generated client-side of the engine
  timestamp:     Date,
  method:        "POST"
}
```

**The engine contract is `result`, and only `result`.** Everything else is the platform's own
bookkeeping. A replacement engine has to produce `{ pdb, sdf }` and nothing more.

> **Note — this is the *legacy* shape.** `user: {username, iat, exp}` is what the currently
> deployed `chem_beo` server writes. This repo's `server/index.js` writes `username`,
> `companyId` and `companyName` as separate top-level fields instead. Both shapes will exist in
> the collection after the migration. Anything reading `simulation_logs` must tolerate both.
> See [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md).

## 2. `result.pdb` — the prepared receptor

Not the docked complex. The receptor alone, prepared and protonated:

```
REMARK   1 CREATED WITH OPENMM 8.2, 2026-05-12
ATOM      1  N   MET A   1      44.130  -3.214   9.264  1.00  0.00           N
ATOM      2  H   MET A   1      44.679  -3.758   8.342  1.00  0.00           H
...
ATOM   2597  OXT LYS A 162      49.193   1.597   0.690  1.00  0.00           O
TER    2598      LYS A 162
END
```

Observed properties:

- **Prepared with OpenMM 8.2.** The `REMARK` date **tracks the date of the dock** — the three
  distinct values observed are `2026-05-12`, `2026-06-01` and `2026-07-08`, matching each
  record's own `timestamp`.
- **Explicit hydrogens** (`H`, `H2`, `H3`, `HA`, `HB2`…). This is a protonated, minimised
  structure, not a raw RCSB download.
- Single chain `A`, terminated `TER` / `END`, with `OXT` on the C-terminal residue.
- Occupancy `1.00` and B-factor `0.00` throughout — B-factors were dropped in preparation.
- **`result.pdb` is receptor-specific.** `1cx6` and `1cx7` give different coordinates from the
  first atom onward, so the requested `pdbid` is honoured. (Both happen to be 210,435 bytes and
  2,601 lines — they are the same protein at the same length, not the same file.)

### ❌ Corrected 2026-07-28: the receptor is **not** cached and **not** byte-stable

An earlier version of this file said the receptor was byte-identical per `pdbid` and concluded
Asinex prepares each one once and reuses it. A hash comparison disproves it:

| Pair | Result |
|---|---|
| two `1cx7` records | **1,308 of 2,601 lines differ** |
| two `1cx6` records | **1,308 of 2,601 lines differ** |

The differing lines are **the hydrogens**. Heavy atoms are identical across runs — `ATOM 1 N
MET A 1` is byte-for-byte the same — while every `H`/`H2`/`H3` line carries different
coordinates:

```
A: ATOM   2  H  MET A  1   44.679  -3.758   8.342     ← 2026-05-12 run
B: ATOM   2  H  MET A  1   43.721  -3.902  10.160     ← 2026-06-01 run, same receptor
```

So the pipeline is: **deterministic heavy-atom structure from RCSB, then a fresh protonation and
minimisation on every dock.** Hydrogen placement is stochastic; nothing is reused. That is also
why the `REMARK` date moves.

**Implication for the rebuild — this is the part that changed.** The box needs a receptor
preparation step producing the same *kind* of artifact, but:

- **Do not assert byte-stability anywhere**, in the service or in a test. The reference
  implementation is not byte-stable, and a test that demands it fails against the thing it is
  supposed to match.
- **Caching the prepared receptor is an improvement over what Asinex does, not a copy of it.**
  It is still the right call — it makes the second dock against a protein much faster, which is
  a stated goal of the box — but it is a behavioural *change*, and it makes hydrogen positions
  stable where production varies them. Say so rather than presenting it as parity.
- The `autogrid` map cache in the runbook is unaffected: maps derive from the receptor, and
  caching both together with the same key is coherent.

## 3. `result.sdf` — the poses

A multi-record V2000 SDF written by RDKit, one record per pose:

```
0:0:0
     RDKit          3D

 18 19  0  0  0  0  0  0  0  0999 V2000
   33.2970   -0.6980   10.1950 C   0  0  0  0  0  2  0  0  0  0  0  0
...
>  <MODEL>  (1)
>  <TORSDO>  (1)
>  <SCORE>  (1)
>  <ligand_id>  (1)
>  <original_smiles>  (1)
>  <smiles>  (1)
$$$$
```

- **5 poses per dock** in every record observed (`$$$$` count = 5).
- Title line is the literal string `0:0:0`.
- Writer line is RDKit's (`     RDKit          3D`).
- Per-pose property tags, in this order: **`MODEL`, `TORSDO`, `SCORE`, `ligand_id`,
  `original_smiles`, `smiles`**.
- `SCORE` values from one dock: `-4.547, -4.505, -4.468, -4.423, -4.345` — descending, i.e.
  **sorted best-first**, in the kcal/mol range and sign convention of AutoDock binding affinity.

### The exact bytes — read 2026-07-29 from a production record

```
44: ">  <MODEL>  (1) "
45: "1"
46: ""
47: ">  <TORSDO>  (1) "
48: "F 5"
49: ""
50: ">  <SCORE>  (1) "
51: "-4.547"
52: ""
53: ">  <ligand_id>  (1) "
54: "0"
55: ""
56: ">  <original_smiles>  (1) "
57: "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"
58: ""
59: ">  <smiles>  (1) "
60: "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"
```

Four things a rebuild must copy exactly, because a parser downstream depends on each:

- **`>` then TWO spaces**, then `<TAG>`, then two spaces, `(1)`, and a **trailing space**.
  `/api/sanitizedminimalsdf` matches with `line.startsWith('>  <smiles>')` — a literal. One
  space instead of two and every pose is dropped. See §7.
- **The value is on the NEXT line**, followed by a blank line.
- **`<smiles>` is lowercase, `<SCORE>` is uppercase.** Both are matched case-sensitively.
- **`smiles` and `original_smiles` are the DECODED SMILES**, even though the engine was *sent*
  the URL-encoded form (§0, §4) and the platform *stores* the encoded form. The engine decodes
  on the way in and echoes plain text on the way out.

**`TORSDO` is the tell — and it is a bug.** ⚠ *Corrected 2026-07-29; this previously said the
tag was AutoDock's `TORSDOF` "carried through the conversion", which is not what the bytes show.*
The tag name is `TORSDO` and its **value is the string `"F 5"`**. AutoDock's PDBQT records
torsional degrees of freedom as `TORSDOF 5`; Asinex's PDBQT→SDF converter split that line at a
fixed column, so the `F` ended up in the value. It is a truncation artifact, faithfully stored
for months.

That makes it **stronger** evidence, not weaker: nothing but an AutoDock PDBQT produces a
mangled `TORSDOF`. Together with the score range it independently confirms what the
Asinex/Pyxis CEO stated — **the 1-click `/api/simulation` engine is AutoDock.** Nothing here is
DiffDock-shaped.

**Decide deliberately whether to reproduce the bug.** The dashboard reads `TORSDO` and displays
it; emit a clean `<TORSDOF>` with value `5` and that column reads `N/A`, because
`properties.TORSDO` is undefined. Either emit `<TORSDO>` / `"F 5"` bug-for-bug, or emit
`<TORSDOF>` and change `molstar3d.jsx:52` in the same release. Do not do one without the other.

## 4. `smiles` is stored URL-encoded

Observed values:

```
Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C     →  Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C
c1ccc2c(c1)nc(o2)SCC(%3DO)O                         →  c1ccc2c(c1)nc(o2)SCC(=O)O
C%23Cc1ccc(cc1)C%23C                                →  C#Cc1ccc(cc1)C#C
```

`[`, `]`, `+`, `=`, `#` arrive percent-encoded and are **stored that way**. This comes from the
POST handler's `smiles === decodeURIComponent(smiles) ? encodeURIComponent(smiles) : smiles`
double-encoding guard. Any replacement must decode before handing SMILES to a toolkit, and the
cache lookup (`findOne({pdbid, smiles})`) matches on the **encoded** form — so re-encoding
differently silently misses the cache and charges the user again.

## 5. What the sample actually is

| | |
|---|---|
| Records | **4** |
| Distinct receptors | **2** — `1cx7`, `1cx6` |
| Date range | 2026-05-12 → 2026-07-08 |
| Method | `POST` on all four (no `GET` record exists) |
| Poses per dock | 5 |

**Four docks in three months.** The engine contract is well determined — the format is rigid
and consistent — but this is not a behavioural sample. Unknown from this data:

- What an **error** looks like. No failed dock was ever stored, which follows: the handler only
  writes on success. So the failure shape of the Asinex API is still uncaptured, and the fix in
  `956f9d9` (treat non-2xx as a failure rather than caching the body) was written blind.
- Whether pose count varies, or is fixed at 5.
- Behaviour for a receptor with multiple chains, or a ligand that fails preparation.
- Any `GET` path result, though the code writes the same `result` shape.

**If Asinex is still reachable, run a handful of deliberate docks** — a bad SMILES, an unknown
PDB ID, a multi-chain receptor — and record the responses here. That is the remaining gap, and
it closes when Moscow does.

## 6. Acceptance test for the replacement

The box's AutoDock service passes when, for `pdbid=1cx7` and a SMILES from §5, it returns:

- `result.pdb` — prepared receptor, explicit hydrogens, single chain, `TER`/`END`, with heavy
  atoms matching the RCSB structure for that `pdbid`. **Do not test for byte-equality across
  calls** — the reference implementation re-minimises every time and its hydrogens move (§2). If
  the box caches the prepared receptor, its output *will* be byte-stable; that is a deliberate
  improvement, and the test should assert heavy-atom agreement, not file equality
- `result.sdf` — V2000, RDKit writer line, N poses each carrying `MODEL`, `TORSDO`, `SCORE`,
  `ligand_id`, `original_smiles`, `smiles`, sorted by `SCORE` ascending (best first)
- Scores in a plausible AutoDock range for the pair — **compare against the stored values
  before trusting a new build**; the four records here are the only ground truth that exists

The client renders `result.pdb` in Molstar and `result.sdf` as poses. Getting the field names
right matters more than matching scores exactly — a different-but-valid docking result is
acceptable, a differently-shaped payload breaks the dashboard.

---

## 7. How the response reaches the screen — and how it silently doesn't

**The client never renders `result` directly.** `POST /api/simulation` returns
`{pdb, sdf, simulationKey}`, and `simulation.jsx:775` throws the payload away, keeps only
`simulationKey`, and sends the browser to Molstar with two **URLs**:

```
POST /api/simulation ──► { pdb, sdf, simulationKey }
        │  simulation.jsx:775-793 — keeps simulationKey, stores two URLs in localStorage
        ▼
 /dashboard/molstar3d
        ├─► GET /api/sanitizedpdb/{key}          → receptor, \n converted to CRLF → Molstar
        └─► GET /api/sanitizedminimalsdf/{key}   → REDUCED poses → parseSdfData() → the table
```

So the engine's output is re-read from Mongo and passed through **two more transforms** before
anyone sees it. Both endpoints are `authenticateToken` + `buildTenantFilter`, so the JWT
`companyId` trap (ARRIVAL-RUNBOOK §5.3) makes the *viewer* 404 as well.

### The reduction, and why 5 poses become 1

`/api/sanitizedminimalsdf` (`server/index.js:3359`) splits on `$$$$`, and for each block reads
`>  <smiles>` and `>  <SCORE>` **as literal string prefixes**. It then keys a map on the SMILES
value, keeping the block with the **lowest** score. Every pose of one ligand carries the same
`<smiles>`, so **5 poses collapse to 1 — the best-scoring one.** That is the "minimal" in the
route name, and it is why the viewer lists one row per ligand, not five.

Two consequences for the box:

- **Emit one `<smiles>` shared by all poses of a ligand.** If each pose carries a different
  SMILES the reduction does nothing and the user sees 5 rows where production shows 1.
- **Omit `<smiles>` and every block is dropped.** The map stays empty.

### The failure mode that matters: it returns HTTP 200

If no block matches, `reducedSDF` is `"" + "\n$$$$\n"` — and it is sent with **status 200** and
`Content-Type: chemical/x-sdf`. The client's `parseSdfData` filters empty entries and gets zero
molecules.

**What the user sees: the dock succeeds, a credit is spent, the receptor renders in Molstar, and
the ligand table is empty. No score. No poses. No error, in the browser or in any log.**

The two parsers disagree about strictness, which is what makes this possible — the client's is
a regex (`/<([^>]+)>/`, spacing-agnostic) and would have coped fine. It never gets the chance.

### `scripts/verify-docking-response.mjs` — run this before cutting over

Runs a candidate payload through **both parsers, byte-for-byte the production logic**, and
prints what the dashboard would show.

```bash
# against the box
node scripts/verify-docking-response.mjs --url http://<box>:8000/docking \
  --pdbid 1cx7 --smiles 'Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C' --save candidate.json

# against a saved payload, optionally compared to a captured Asinex reference
node scripts/verify-docking-response.mjs --file candidate.json --baseline asinex-real.json
```

Exit 0 means the receptor renders and the pose table populates with numeric scores. **Validated
2026-07-29 against a real production Asinex response** (2,597 atoms, 1,307 hydrogens, 5 poses →
1 row, `SCORE -4.547`) — it passes. Fed the same payload with `> <smiles>` instead of
`>  <smiles>`, it fails with all three symptoms named.

It checks **plumbing, not chemistry.** Scores still have to be compared against the four stored
reference docks by someone who can judge them.

⚠ **Note what the real scores do to the UI.** `molstar3d.jsx:980` colours a score green below
−7, amber below −5, red otherwise. Production's reference values are −4.345 to −4.547, so **every
real dock the platform has ever produced shows a red badge.** Do not read red as a regression
caused by the box.
