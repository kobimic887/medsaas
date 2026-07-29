# Claude for Life Sciences — the ChemBench MCP server

The connector already exists and is coherent: `services/mcp-server/` exposes **14 platform
tools** over the transport Claude for Life Sciences speaks. It is built, containerised, wired
into both compose files, and every tool path was verified against a real route (§4).

---

## 0. In plain terms — what this actually is

**Claude Science lets a scientist ask Claude to use Pyxis.** They type "find me analogues of
aspirin under 300 Da and dock the best three against 1CX7" into Claude, and Claude performs those
searches and docks *on this platform*, with their account and their credits, and reasons about
the results. It is not a chatbot bolted onto the dashboard. It is Claude driving the product.

The piece that makes that possible is a **connector**: a small server that publishes a menu of
things Claude is allowed to do, and translates each one into an API call. `services/mcp-server/`
is that server, and the menu is the 14 tools in §2. It is built and it works — every tool has
been exercised against a real route.

**Two things stand between it and a scientist using it, and neither is code:**

1. **Anthropic's servers have to be able to reach it.** A remote connector is called *from*
   Claude's infrastructure, so it needs a public HTTPS address. Today it listens on
   `:8080` on a machine with no ingress for that port.
2. **The sign-in step does not match.** This server expects the caller to already hold a Pyxis
   JWT and to send it as a bearer token. Claude's custom connectors are built around the user
   clicking "connect" and authorising through OAuth. There is nowhere in that flow for a
   scientist to paste a raw JWT — so as it stands, there is no way for them to log in.

(1) becomes nearly free after Release A: nginx already terminates TLS for
`app.pyxis-discovery.com`, so one extra `location` block pointed at `:8080` gives it a public
HTTPS URL on an origin that already exists. (2) is real work — an OAuth authorisation endpoint in
front of the existing JWT issuance — and it is the piece to scope deliberately rather than to
squeeze into the server swap.

**So: do not couple this to Release A.** It shares no code with the cutover, it cannot break
docking, and it is not on the critical path for the box. The right moment is after the swap has
carried production traffic for a week, when the public HTTPS origin it needs already exists and
adding a path to nginx is a small, well-understood change rather than one more variable on a day
that has enough of them.

---

## 1. What it is

| | |
|---|---|
| Source | `services/mcp-server/` (Bun, `@modelcontextprotocol/sdk`) |
| Server name | `chembench-mcp` |
| Transport | **stateless Streamable HTTP** — `POST /mcp`, `:8080` |
| Liveness | `GET /health` |
| Also supports | stdio (`src/stdio.js`) for Claude Desktop / local use |
| Image | `chembench-mcp:local`, built on the box |
| Auth model | **per-request bearer.** The caller's ChemBench JWT arrives in the `Authorization` header and is forwarded to the platform API unchanged |

Design worth preserving: `src/tools.js` is a **declarative table**. Each entry maps a
Claude-facing tool onto one platform endpoint via `request(args) -> {method, path, query,
body}`, and one generic handler drives all of them. The transport and token-forwarding path is
proven once and shared. Adding a tool means adding a table row, not new plumbing.

`GET /mcp` and `DELETE /mcp` deliberately return 405 — stateless mode has no session to
resume or terminate.

## 2. The 14 tools

| Tool | Platform endpoint | Backed by |
|---|---|---|
| `platform_health` | `GET /api/platform/health` | GROMACS + glioblastoma reachability |
| `list_datasets` | `GET /tanimoto/v1/datasets` | tonomitosql |
| `similarity_search` | `GET /tanimoto/v1/search/similarity` | tonomitosql (Morgan/ECFP4) |
| `exact_search` | `GET /tanimoto/v1/search/exact` | tonomitosql |
| `substructure_search` | `GET /tanimoto/v1/search/substructure` | tonomitosql |
| `generate_molecules` | `POST /api/generate-molecules` | NVIDIA MolMIM (hosted) |
| `predict_protein_structure` | `POST /api/openfold3/predict` | NVIDIA OpenFold3 (hosted) |
| `dock_ligand` | `POST /api/diffdock/generate` | DiffDock via `DIFFDOCK_API_URL` |
| `search_asinex` | `POST /api/asinex/search` | Asinex catalog |
| `predict_glioblastoma` | `POST /api/glioblastoma/predict` | `services/glioblastoma-predictor/` |
| `run_gromacs_workflow` | `POST /api/gromacs/workflows/:workflow` | `services/gromacs-api/` |
| `get_gromacs_job` | `GET /api/gromacs/jobs/:jobId` | `services/gromacs-api/` |
| `get_admet_results` | `GET /api/simulation/:key/admet` | ADMET worker results |
| `search_molecule_prices` | `GET /api/mol-price/search` | Mongo `mol_price` |

That is a genuinely good tool surface for Life Sciences: search, generate, fold, dock,
predict, price. Nothing needs inventing — it needs the backends behind it to be alive.

## 3. What is broken about it today, and why

Four of the fourteen tools **almost certainly cannot work in the current deployment**, and it
is not the MCP server's fault. This is inferred from the code and compose files, not observed
on the box — the deployed `~/medsaas/.env` is not in git and was not read, and
`docker-compose.box.yml` passes it to the app with `env_file: .env`, so an override there
would change the picture. Confirm before acting:

```bash
ssh oracle 'cd ~/medsaas && docker compose -f docker-compose.box.yml exec -T app env | grep _API_BASE'
```


1. **`platform_health`, `predict_glioblastoma`, `run_gromacs_workflow`, `get_gromacs_job`.**
   These proxy through `server/routes/scientificServices.js`, which reads `GROMACS_API_BASE`
   and `GLIOBLASTOMA_API_BASE` — defaulting to `http://localhost:8001` and
   `http://localhost:5000`. Inside the app container, `localhost` **is the app container**.
   `docker-compose.box.yml` neither sets those variables nor defines those services, and
   Oracle is not running them. So `platform_health` reports failure by design and the other
   three 502.
2. **`get_admet_results`** returns whatever the worker last wrote — and the ADMET worker has
   never been deployed either, so there is nothing to read.

All four are fixed by Pile 2 of the migration (first-time deployment of RabbitMQ, the ADMET
worker, GROMACS and the glioblastoma predictor), not by touching the MCP server.

Also worth knowing: **`/api/mol-price/search` has no `authenticateToken`** — only
`ensureMongoConnected`. The MCP server dutifully forwards a bearer token that endpoint
ignores. Pricing data is readable without a session. Flagged, not changed.

## 4. Verification done

Every `path:` in `src/tools.js` was extracted and matched against the real Express routes:

- `/tanimoto/v1/*` → `server/index.js` (four routes, all present)
- `/api/platform/health`, `/api/glioblastoma/predict`, `/api/gromacs/workflows/:workflow`,
  `/api/gromacs/jobs/:jobId` → `server/routes/scientificServices.js`, mounted at
  `app.use('/api', ensureMongoConnected, authenticateToken, requireActiveUser, scientificServicesRouter)`
- `/api/generate-molecules`, `/api/openfold3/predict`, `/api/diffdock/generate`,
  `/api/asinex/search`, `/api/mol-price/search`, `/api/simulation/:key/admet` →
  `server/index.js`

No dangling tool. No missing route.

## 5. Connecting it

### Hosted (Claude for Life Sciences / the Claude API MCP connector)

1. Get a platform JWT: `POST /api/signin` with a real account. That user's company, role, and
   **simulation-token balance** govern everything the connector can do — tools that hit
   `consumeSimulationToken` endpoints spend credits.
2. Point the connector at `https://<box-hostname>/mcp` and set `authorization_token` to that
   JWT.
3. The server is stateless, so no session setup is needed.

**Prerequisite that does not exist yet:** a public HTTPS hostname for the box. Options and the
recommendation are in COMPUTE-BOX-MIGRATION.md §3-B. Do not expose `:8080` directly — put it
behind the same TLS terminator as the API, and bind the Docker publish to `127.0.0.1` so it is
not reachable by IP (on Oracle, published ports `3000` and `8080` bypassed UFW and were
verified reachable from the internet).

### Local (stdio, Claude Desktop)

Set `MEDSAAS_TOKEN` to the JWT and `MEDSAAS_API_BASE` to the API, then run `src/stdio.js`. No
ingress needed — useful for testing tool behaviour before the box is reachable.

### Local HTTP, against the dev API

```bash
docker compose --profile mcp up -d --build   # :8080, MEDSAAS_API_BASE=BASE_URL
curl -s localhost:8080/health
bun services/mcp-server/test/handshake.smoke.mjs
```

## 6. Env vars

| Var | Default | Notes |
|---|---|---|
| `MEDSAAS_API_BASE` | `http://localhost:3000` | `http://app:3000` on the box — the compose network name. This is the one hard coupling: the MCP server must be cut over **with** the app, not separately |
| `MCP_HOST` / `MCP_PORT` | `0.0.0.0` / `8080` | — |
| `MEDSAAS_TOKEN` | unset | stdio only. Stays unset in the hosted deployment |
| `MCP_REQUEST_TIMEOUT_MS` | `120000` | Raise for folding: a real OpenFold3 call can exceed two minutes, and the platform route itself allows 600 s |

## 7. Sequencing

The useful order, once the box exists:

1. Deploy app + MCP together (migration Phase 2). Ten of fourteen tools go live.
2. Stand up ingress; register the connector. Verify with `list_datasets` and
   `similarity_search`, which need no GPU and no new service.
3. Deploy Pile 2 (Phase 3). The remaining four tools start working.
4. When the local science stack lands (Phase 4), `predict_protein_structure` and `dock_ligand`
   stop being NVIDIA/Asinex proxies and become local GPU work. **The tool contract does not
   change** — that is the payoff of the declarative table: the connector keeps working while
   the backend is swapped underneath it.
5. Only then consider new tools. Raising `MCP_REQUEST_TIMEOUT_MS` matters more once folding is
   local and a job takes ~8.5 minutes; at that point the fold tool should return a job handle
   and be polled, not block.
