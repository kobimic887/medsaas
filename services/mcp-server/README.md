# Pyxis Discovery MCP server

MCP adapter for the Pyxis application API, with Streamable HTTP and stdio
transports. Each tool forwards the caller's application token; the API applies
its normal account, role, and credit checks.

Tool discovery works without a token. Tool execution requires one. A listed tool
does not guarantee its upstream service is configured or available; use
`platform_capabilities` to inspect platform configuration.

## Run locally

From this directory, with Bun available:

```bash
bun install --frozen-lockfile
MCP_HOST=127.0.0.1 MEDSAAS_API_BASE=http://localhost:3000 bun run start
```

The HTTP endpoint is `POST http://localhost:8080/mcp`; `GET /health` is a liveness
probe. HTTP requests supply the caller's token in `Authorization: Bearer <token>`.
The transport is stateless; `GET /mcp` and `DELETE /mcp` return `405`.

For stdio, configure your MCP client to run
`bun /absolute/path/to/services/mcp-server/src/stdio.js` with
`MEDSAAS_API_BASE` and `MEDSAAS_TOKEN` in its private environment. Use a token
issued by the application's sign-in flow. Do not commit tokens to client
configuration or this repository.

Node entrypoints are available through `npm run start:node` and
`npm run stdio:node`.

## Tools

The names and input schemas come from [src/tools.js](src/tools.js) and are
available through MCP `tools/list`.

| Area | Tools |
|---|---|
| Platform status | `platform_health`, `platform_capabilities` |
| Docking and ADMET jobs | `list_jobs`, `get_job` |
| Structure search | `list_datasets`, `similarity_search`, `exact_search`, `substructure_search` |
| Molecule generation | `generate_molecules` |
| Protein folding | `predict_protein_structure` |
| Docking | `dock_ligand` |
| Catalog and pricing | `search_asinex`, `search_molecule_prices` |
| Scientific services | `predict_glioblastoma`, `run_gromacs_workflow`, `get_gromacs_job`, `get_admet_results` |

Search parameters are forwarded as defined in the tool table. Scientific request
payloads must also satisfy the corresponding application API contract. Execution
can create jobs or consume credits; the MCP adapter does not simulate those calls.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MEDSAAS_API_BASE` | `http://localhost:3000` | Application API base URL |
| `MCP_HOST` | `0.0.0.0` | HTTP bind address; use `127.0.0.1` for local access |
| `MCP_PORT` | `8080` | HTTP port |
| `MEDSAAS_TOKEN` | Empty | Caller token for stdio; HTTP uses the request header |
| `MCP_REQUEST_TIMEOUT_MS` | `120000` | Upstream request timeout |

For container builds, from the repository root:

```bash
docker build -t pyxis-mcp services/mcp-server
```

Supply `MEDSAAS_API_BASE` at runtime. Hosted HTTP access should use HTTPS because
requests carry application tokens.

## Verification and source

```bash
bun run smoke
# Node alternative:
npm run smoke:node
```

The smoke test starts a stub application API and checks MCP initialization,
tool discovery, calls, and token forwarding. It does not call scientific
providers or prove a deployed integration.

- [src/http.js](src/http.js) and [src/stdio.js](src/stdio.js): transport entrypoints.
- [src/tools.js](src/tools.js): tool schemas and endpoint mappings.
- [src/platform-client.js](src/platform-client.js): authenticated requests and error handling.
- [src/config.js](src/config.js): runtime configuration.
