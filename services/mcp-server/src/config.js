// Runtime configuration for the ChemBench MCP server.
// Every value is env-driven so the same build runs locally, in Docker, and on the box.

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

export const config = {
  // Base URL of the ChemBench platform API this server proxies to.
  apiBase: trimTrailingSlash(process.env.MEDSAAS_API_BASE || 'http://localhost:3000'),

  // Streamable HTTP listener (the transport Claude for Life Sciences connects to).
  host: process.env.MCP_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.MCP_PORT || '8080', 10),

  // Bearer token used by the stdio entrypoint (Claude Desktop / local use). The
  // HTTP entrypoint takes the token per-request from the Authorization header
  // instead, so this stays unset in the hosted deployment.
  stdioToken: process.env.MEDSAAS_TOKEN || '',

  // Upstream call timeout in milliseconds.
  requestTimeoutMs: Number.parseInt(process.env.MCP_REQUEST_TIMEOUT_MS || '120000', 10),
};
