# ChemBench MCP Server

**This is the ChemBench platform's link to Claude for Science / Claude for Life Sciences.**

It is a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the platform's drug-discovery capabilities — molecule generation, structure
prediction, docking, similarity/substructure search, ADMET, molecular dynamics, and
catalog/pricing lookup — as MCP **tools**. Once connected, Claude can call these tools
directly to drive real computational-chemistry work on the ChemBench backend.

The server is a **thin proxy**: it does not hold any platform secrets. Each caller
supplies their own ChemBench platform token (a JWT from `POST /api/signin`), which the
server forwards to the platform API as `Authorization: Bearer <token>`. Every tool call
therefore runs as that user, respecting their account, roles, and simulation-token
balance — exactly as if they'd called the REST API themselves.

## What Claude gets (tools)

| Tool | What it does | Platform endpoint |
|------|--------------|-------------------|
| `platform_health` | Health of the GROMACS / glioblastoma microservices | `GET /api/platform/health` |
| `generate_molecules` | Generate drug-like molecules around a seed (NVIDIA MolMIM) | `POST /api/generate-molecules` |
| `predict_protein_structure` | Predict a complex structure (NVIDIA OpenFold3) | `POST /api/openfold3/predict` |
| `dock_ligand` | Predict a ligand binding pose (DiffDock) | `POST /api/diffdock/generate` |
| `similarity_search` | Tanimoto similarity search | `GET /tanimoto/v1/search/similarity` |
| `exact_search` | Exact structure search | `GET /tanimoto/v1/search/exact` |
| `substructure_search` | Substructure search | `GET /tanimoto/v1/search/substructure` |
| `list_datasets` | List searchable compound datasets | `GET /tanimoto/v1/datasets` |
| `search_asinex` | Search the Asinex catalog | `POST /api/asinex/search` |
| `predict_glioblastoma` | Run the glioblastoma predictor | `POST /api/glioblastoma/predict` |
| `run_gromacs_workflow` | Start a GROMACS MD workflow | `POST /api/gromacs/workflows/:workflow` |
| `get_gromacs_job` | Poll a GROMACS job | `GET /api/gromacs/jobs/:jobId` |
| `get_admet_results` | Fetch ADMET results for a simulation | `GET /api/simulation/:key/admet` |
| `search_molecule_prices` | Search the molecule pricing catalog | `GET /api/mol-price/search` |

> The search tools forward their arguments as query params to the upstream service
> verbatim. Names like `threshold` / `dataset_id` follow the platform's Tanimoto
> service contract — verify them against that service's API and adjust in
> `src/tools.js` if it expects different keys (unknown params fail soft, i.e. are
> ignored rather than erroring).

## Run it

```bash
cd services/mcp-server
bun install
cp .env.example .env        # point MEDSAAS_API_BASE at your ChemBench API

# Streamable HTTP (the transport Claude for Life Sciences connects to)
bun run start                # -> http://localhost:8080/mcp   (bun run start:node for Node)

# stdio (local use: Claude Desktop, Claude Code, MCP Inspector)
MEDSAAS_TOKEN=<jwt> bun run stdio
```

Verify the link end-to-end (starts a stub platform API, runs a full
`initialize → tools/list → tools/call` handshake, checks token forwarding):

```bash
bun run smoke                # or: bun run smoke:node
```

## Connect it to Claude

### Claude for Life Sciences / Claude API MCP connector (hosted, recommended)

Deploy the HTTP server somewhere Claude can reach it (see the Dockerfile), then add it
as a URL MCP server. The `authorization_token` is the caller's ChemBench platform JWT
from `POST /api/signin` (`token` field) — it arrives as `Authorization: Bearer <token>`
and is forwarded downstream:

```jsonc
{
  "mcp_servers": [
    {
      "type": "url",
      "name": "chembench",
      "url": "https://mcp.your-domain.com/mcp",
      "authorization_token": "<user's ChemBench platform JWT>"
    }
  ],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "chembench" }]
}
```

### Claude Desktop / Claude Code (local, stdio)

```jsonc
{
  "mcpServers": {
    "chembench": {
      "command": "bun",
      "args": ["/absolute/path/to/services/mcp-server/src/stdio.js"],
      "env": {
        "MEDSAAS_API_BASE": "http://localhost:3000",
        "MEDSAAS_TOKEN": "<your ChemBench platform JWT>"
      }
    }
  }
}
```

## Deploy (Docker)

```bash
docker build -t chembench-mcp services/mcp-server
docker run -p 8080:8080 -e MEDSAAS_API_BASE=https://api.your-domain.com chembench-mcp
```

For an all-in-one local stack, add this to `docker-compose.yml` (optional):

```yaml
  mcp-server:
    build: ./services/mcp-server
    environment:
      MEDSAAS_API_BASE: http://api:3000
    ports:
      - "8080:8080"
    profiles: ["mcp"]
```

## How it works

- `src/http.js` — Streamable HTTP entrypoint. Stateless: each `POST /mcp` gets a fresh
  MCP server + transport, and the caller's token is read per-request from the
  `Authorization` header. `GET /health` is a liveness probe.
- `src/stdio.js` — stdio entrypoint; token comes from `MEDSAAS_TOKEN`.
- `src/tools.js` — the declarative tool table + one generic handler that maps each tool
  onto a platform endpoint and forwards the token.
- `src/platform-client.js` — the fetch wrapper that forwards the bearer token and
  normalizes upstream errors into tool results.
- `src/config.js` — env-driven configuration.

Discovery (`initialize`, `tools/list`) works without a token; **executing** a tool
returns a clear error unless a platform token is supplied.
