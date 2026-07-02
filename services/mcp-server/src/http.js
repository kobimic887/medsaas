import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { createServer } from './server-factory.js';

// Streamable HTTP entrypoint — the transport Claude for Life Sciences (and the
// Claude API MCP connector) connects to. Runs stateless: each POST /mcp gets a
// fresh server + transport, and the caller's platform token is read per-request
// from the Authorization header the connector sends (`authorization_token`).

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  return scheme && scheme.toLowerCase() === 'bearer' && value ? value : '';
}

export function createHttpApp() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Liveness probe (matches the platform's /health convention).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'chembench-mcp', apiBase: config.apiBase });
  });

  app.post('/mcp', async (req, res) => {
    const token = bearerToken(req);
    const server = createServer(() => token);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no session bookkeeping
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no server-initiated stream or session to terminate.
  const methodNotAllowed = (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST /mcp.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}

// Start only when run directly (not when imported by the smoke test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createHttpApp();
  app.listen(config.port, config.host, () => {
    console.log(`ChemBench MCP server (Streamable HTTP) listening on http://${config.host}:${config.port}/mcp`);
    console.log(`Proxying to ChemBench platform at ${config.apiBase}`);
  });
}
