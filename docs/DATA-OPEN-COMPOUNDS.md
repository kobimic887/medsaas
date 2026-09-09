# Open compounds (ChEMBL + AI tool loop) — Simulation search source

Third “Search in” source on the Simulation page. The **product intent** is an
AI-driven request: SMILES + Morgan/Tanimoto threshold + result count (+ optional
instruction) go to a model that **must call** a bounded chemical-search tool.
Displayed structures, public IDs, and similarity scores come only from that
tool’s validated ChEMBL + RDKit path — never from model-written numbers.

An explicit **Search without AI** control reuses the deterministic ChEMBL path.
AI failures do **not** silently run that path.

## Chosen public source

| | |
|---|---|
| Provider | **ChEMBL** Data Web Services (EMBL-EBI) |
| Endpoint | `GET {OPEN_COMPOUNDS_BASE}/similarity/{smiles}/{pct}?format=json&limit=&offset=` |
| Default base | `https://www.ebi.ac.uk/chembl/api/data` |
| Why not PubChem for v1 | PubChem `fastsimilarity_2d` uses the **PubChem 881-bit** fingerprint, not Morgan. |

Reference probe (2026-09-09): `c1ccc2c(c1)nc(s2)SCC(=O)O` @ 70% → six ChEMBL
hits including `CHEMBL1373993` @ 100%. Local `@rdkit/rdkit` Morgan r=2 / 2048-bit
Tanimoto matched ChEMBL’s reported percentages to `< 1e-6`.

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

Results are ranked among retrieved candidates — **not** guaranteed exhaustive
database-wide top-N. Retrieval cap 300; requested final count ≤ 100.

## AI tool loop

1. Client `POST /api/open-compounds/ai-search` with locked `smiles`, `threshold`,
   `maxResults`, optional `instruction`.
2. Server calls an OpenAI-compatible chat-completions API with tools.
3. Model must call `search_similar_open_compounds` with the **locked** args.
4. Backend validates args (rejects SMILES/threshold/count changes), runs the
   existing ChEMBL + RDKit pipeline, returns tool JSON to the model.
5. Displayed table rows are taken from the successful tool output only.
6. Optional short model summary may appear; scores are never taken from it.

Limits: ≤4 model rounds, ≤2 tool calls, 90s timeout, 1200 max tokens,
instruction ≤500 chars. No arbitrary URL/SQL/shell. Provider host allowlist only
(`openrouter`, `openai`).

### Provider / cost gate

| Env | Meaning |
|---|---|
| `OPEN_COMPOUNDS_AI_ENABLED=true` | Opt-in |
| `OPEN_COMPOUNDS_AI_PROVIDER` | `openrouter` or `openai` |
| `OPEN_COMPOUNDS_AI_MODEL` | e.g. `openrouter/free` or a `:free` model with tools |
| `OPEN_COMPOUNDS_AI_API_KEY` (or `OPENROUTER_API_KEY` / `OPENAI_API_KEY`) | Secret — never logged |
| `OPEN_COMPOUNDS_AI_ALLOW_PAID=true` | Required for non-free / OpenAI models |

Measured 2026-09-09: OpenRouter lists free models with `tools` /
`tool_choice`, including `openrouter/free`. Prefer those unless the owner
approves a paid budget. **Do not invoke paid models without that approval.**

Privacy: query SMILES and optional instruction are sent to the AI provider and
to ChEMBL. UI states this. No cross-user result cache.

## API (authenticated)

| Route | Role |
|---|---|
| `GET /api/open-compounds/status` | Availability, fingerprint, AI enablement |
| `POST /api/open-compounds/ai-search` | AI tool loop (fails closed if AI unavailable) |
| `GET /api/open-compounds/similarity` | Deterministic “Search without AI” |
| `GET /api/open-compounds/export` | CSV/SDF of the deterministic ranked window |

Status codes: `400` validation, `401` dead session, `403` inactive,
`503 OPEN_COMPOUNDS_*_UNAVAILABLE`, `502` upstream / AI failures. Never silent
fallback to Internal catalog or Stock compounds.

## UI

Simulation → **Open compounds (ChEMBL)**:

- AI search (when `status.ai.enabled`) vs **Search without AI**
- Optional instruction
- Live stages: Interpreting request → Searching compound sources → …
- Explanation from the model (grounded); table scores from RDKit
- CSV/SDF; selection → existing docking SMILES handoff
- No purchase controls

## Tests

```bash
bun run test:open-compounds          # unit + AI stub loop + route
bun run test:simulation-search       # UI lifecycle
LIVE_OPEN_VERIFY=1 bun run test:open-compounds   # real ChEMBL (deterministic route)
# Real model (requires approved key in env — not written by agents):
LIVE_OPEN_AI_VERIFY=1 OPEN_COMPOUNDS_AI_ENABLED=true \
  OPEN_COMPOUNDS_AI_PROVIDER=openrouter OPEN_COMPOUNDS_AI_MODEL=openrouter/free \
  OPEN_COMPOUNDS_AI_API_KEY=… bun server/test/open-compounds-ai-live.test.mjs
```

## Deploy / rollback

- Ship from `main` after owner approval for 84 / staging.
- Deterministic search needs no AI secrets.
- AI needs owner-approved key file / host env (do not commit secrets).
- Rollback: `OPEN_COMPOUNDS_AI_ENABLED=false` and/or
  `OPEN_COMPOUNDS_ENABLED=false`; catalog + stock untouched.

## Unresolved product decisions

1. Which free OpenRouter model is preferred long-term (`openrouter/free` vs a pinned `:free` id).
2. Whether PubChem should become a second retrieval pool (always re-score).
3. Paid OpenAI budget, if any.
