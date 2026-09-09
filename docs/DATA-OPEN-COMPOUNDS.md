# Open compounds (ChEMBL) — Simulation search source

Third “Search in” source on the Simulation page: public ChEMBL similarity
candidates, re-scored locally with RDKit Morgan fingerprints. Does **not**
replace Internal catalog or Stock compounds, and never falls back to them.

## Chosen v1 source

| | |
|---|---|
| Provider | **ChEMBL** Data Web Services (EMBL-EBI) |
| Endpoint | `GET {OPEN_COMPOUNDS_BASE}/similarity/{smiles}/{pct}?format=json&limit=&offset=` |
| Default base | `https://www.ebi.ac.uk/chembl/api/data` |
| Why not PubChem for v1 | PubChem `fastsimilarity_2d` uses the **PubChem 881-bit** fingerprint, not Morgan. Usable as a candidate pool later, but ChEMBL already returns structures + stable `CHEMBLnnn` IDs and (measured 2026-09-09) matches our Morgan scores. |
| Local DB | None — no bulk download. |

Reference probe (2026-09-09):

`c1ccc2c(c1)nc(s2)SCC(=O)O` at 70% → six ChEMBL molecules including
`CHEMBL1373993` at 100%. Local `@rdkit/rdkit` Morgan r=2 / 2048-bit Tanimoto
matched ChEMBL’s reported percentages to `< 1e-6`.

## Declared final score

Identical settings for query and every candidate:

| Setting | Value |
|---|---|
| Fingerprint | RDKit Morgan bit vector |
| radius | 2 |
| nBits | 2048 |
| useChirality | **false** |
| useBondTypes | true |
| useFeatures | false |
| Metric | Tanimoto |
| Standardization | `RDKit.get_mol` as written — **no** charge/bond repair |
| Identity / dedup | InChIKey when ChEMBL provides one, else RDKit canonical SMILES |

Upstream ChEMBL similarity is used only to **retrieve** candidates (path
threshold is an integer percent, floor 40). Displayed scores are always
recomputed locally. UI/API copy states results are ranked among retrieved
candidates — **not** guaranteed exhaustive database-wide top-N.

Retrieval cap: 300 ChEMBL molecules / request. Requested final count: ≤ 100.

## Attribution

ChEMBL / EMBL-EBI. Each row links to
`https://www.ebi.ac.uk/chembl/compound_report_card/{CHEMBL_ID}/`.
Licence: ChEMBL attribution terms (CC Attribution family). CSV/SDF include
source URL + fingerprint settings. SDF sets `DOCKING_READY=false` (no ligand
preparation performed).

## API (authenticated)

| Route | Role |
|---|---|
| `GET /api/open-compounds/status` | Availability, fingerprint declaration, AI status |
| `GET /api/open-compounds/similarity?smiles=&threshold=&offset=&limit=&maxResults=` | Ranked page |
| `GET /api/open-compounds/export?format=csv\|sdf&smiles=&threshold=&maxResults=` | Full ranked window export |

Status codes: `400` validation, `401` dead session, `403` inactive user,
`503 OPEN_COMPOUNDS_UNAVAILABLE`, `502` / partial upstream failures. Never
silent fallback to catalog/stock.

Env (optional):

| Var | Meaning |
|---|---|
| `OPEN_COMPOUNDS_ENABLED` | default true; `false` → 503 |
| `OPEN_COMPOUNDS_BASE` | ChEMBL API base (allowlisted host only via this env) |
| `OPEN_COMPOUNDS_AI_ENABLED` | must be `true` **and** key+provider+model set |
| `OPEN_COMPOUNDS_AI_PROVIDER` / `OPEN_COMPOUNDS_AI_MODEL` / `OPEN_COMPOUNDS_AI_API_KEY` | AI assist — **not** wired for scoring in v1 |

Query SMILES are sent to ChEMBL. Do not log full query strings unnecessarily;
no cross-user result cache.

## AI role (v1)

**Awaiting configuration.** Deterministic ChEMBL + RDKit search works without
AI. Status reports `ai.enabled: false` until env is explicitly set. No paid
provider calls are made by default. Model-written similarity numbers are never
accepted as scientific results.

## UI

Simulation → Search in: **Open compounds (ChEMBL)**. Similarity-only; threshold
floor 0.4; max results 25/50/100; CSV/SDF download; selection feeds existing
docking/DiffDock SMILES handoff. No purchase controls.

## Tests

```bash
bun run test:open-compounds          # unit + stubbed route
bun run test:simulation-search       # UI lifecycle invariants
LIVE_OPEN_VERIFY=1 bun run test:open-compounds   # real ChEMBL (network)
```

Fixture: `server/test/fixtures/open-chembl-reference-70.json` (live capture).

## Deploy / rollback

- Ship on the open-compounds feature branch; **do not** promote staging/folding
  work with this change.
- No new secrets required for deterministic search.
- Rollback: set `OPEN_COMPOUNDS_ENABLED=false` or revert the commit; Internal
  catalog + Stock compounds are untouched.
- Staging: after owner approval, exercise Simulation → Open compounds with the
  reference SMILES; confirm external-send banner and ChEMBL links.

## Unresolved product decisions

1. Whether to add an optional AI NL→tool layer once a provider/model/budget is
   approved (OpenRouter vs OpenAI are distinct; do not assume free tier).
2. Whether PubChem should become a second retrieval pool (always re-score).
3. Whether threshold below 0.4 should ever be allowed via a non-ChEMBL pool.
