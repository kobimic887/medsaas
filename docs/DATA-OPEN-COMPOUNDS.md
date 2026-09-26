# Open compound search

Simulation retrieves candidates from ChEMBL and scores them locally with RDKit.
Users can search directly or, when enabled, ask an AI model to call the same
bounded search tool. Structures, identifiers, and scores always come from the
validated tool output. An AI failure never silently becomes a direct search.

## Search contract

ChEMBL Data Web Services is the retrieval provider. `OPEN_COMPOUNDS_BASE`
configures its base URL; the default is `https://www.ebi.ac.uk/chembl/api/data`.
The application retrieves at most 300 candidates and returns at most 100 ranked
results. This is a ranking of retrieved candidates, not a guarantee of the
database's exhaustive top matches.

Query and candidates use the same settings:

| Setting | Value |
|---|---|
| Fingerprint | RDKit Morgan, radius 2, 2048 bits |
| Chirality | Off |
| Bond types | On |
| Feature invariants | Off |
| Metric | Binary Tanimoto |
| Structure handling | RDKit parsing; no automatic charge or bond repair |
| Deduplication | InChIKey when supplied, otherwise canonical SMILES |

## API and AI behavior

All routes require an authenticated, active user:

| Route | Purpose |
|---|---|
| `GET /api/open-compounds/status` | Availability, method, and AI enablement |
| `GET /api/open-compounds/similarity` | Direct search |
| `GET /api/open-compounds/export` | CSV/SDF for the ranked result window |
| `POST /api/open-compounds/ai-search` | AI-assisted search |

The AI route locks the submitted SMILES, threshold, and result count. The model
must call `search_similar_open_compounds` with those arguments; the backend
rejects changes. An optional model summary may accompany results, but the model
cannot supply table rows or scores. Limits are four model rounds, two tool
calls, a 90-second timeout, and a 500-character user instruction.

Validation errors return 400, inactive accounts 403, unavailable search 503,
and upstream failures 502. A 401 is reserved for a dead application session.
No route substitutes catalog or stock results. Open-compound rows support
export and docking handoff, with no purchase controls.

## Configuration and privacy

AI is opt-in through `OPEN_COMPOUNDS_AI_ENABLED`. Provider, model, credentials,
and any operator-provisioned proxy are configured server-side. Supported
provider adapters are `openrouter`, `openai`, and `omniroute`; paid models
require `OPEN_COMPOUNDS_AI_ALLOW_PAID`. Credentials stay outside source control.

Query structures go to ChEMBL. AI mode also sends the structure and optional
instruction to the selected AI provider. The UI discloses that behavior.
Results are not cached across users.

## Verification

```bash
bun run test:open-compounds
bun run test:simulation-search
```

For an explicitly intended live ChEMBL probe:

```bash
LIVE_OPEN_VERIFY=1 bun run test:open-compounds
```

Fixture checks do not prove provider availability. AI provider probes use
separately supplied credentials and may incur cost. Host configuration belongs
in [operator records](OPERATIONS.md).
