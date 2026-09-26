# MCP integration

[`services/mcp-server/`](../services/mcp-server/) exposes Pyxis API operations
as Model Context Protocol tools. Its internal server name is `chembench-mcp`.
It is a thin API adapter; scientific backends remain independently configured.

## Transport and identity

- HTTP: stateless Streamable HTTP at `POST /mcp`, with liveness at `GET /health`.
- `GET /mcp` and `DELETE /mcp` return 405.
- HTTP callers supply their platform bearer token per request.
- The stdio entrypoint reads `MEDSAAS_TOKEN` from the process environment.
- Discovery can run without a token; tool execution requires one.

The token is forwarded to the application API. Authorization and credit
enforcement are properties of each destination route; the adapter does not add
a separate authorization layer. Bearer-token support is not an OAuth connection
flow and does not establish compatibility with every hosted connector.

## Tools and source

The [tool table](../services/mcp-server/src/tools.js) maps calls to platform
endpoints for similarity and structure search, molecule generation, folding,
DiffDock, scientific workflows, ADMET results, and catalog lookup.

| File | Responsibility |
|---|---|
| [`http.js`](../services/mcp-server/src/http.js) | HTTP entrypoint and per-request token |
| [`stdio.js`](../services/mcp-server/src/stdio.js) | Local stdio entrypoint |
| [`tools.js`](../services/mcp-server/src/tools.js) | Tool schemas and route mappings |
| [`platform-client.js`](../services/mcp-server/src/platform-client.js) | API requests and error normalization |
| [`config.js`](../services/mcp-server/src/config.js) | Environment configuration |

## Local verification

Set `MEDSAAS_API_BASE` to an approved application endpoint. For a local HTTP
listener, bind explicitly to loopback:

```bash
MCP_HOST=127.0.0.1 bun --cwd=services/mcp-server run start
```

The stdio command is `bun --cwd=services/mcp-server run stdio`; provide its
token through the environment without committing credentials.

```bash
bun --cwd=services/mcp-server run smoke
```

The smoke test uses a stub API to check initialization, tool discovery, calls,
and token forwarding. It does not prove that every scientific backend is
available. The default upstream timeout is 120 seconds and can be configured
with `MCP_REQUEST_TIMEOUT_MS`.

Public ingress and deployed service readiness belong in
[operator records](OPERATIONS.md).
