import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { createServer } from './server-factory.js';

// stdio entrypoint — for local use (Claude Desktop, Claude Code, the MCP
// Inspector). The platform token comes from MEDSAAS_TOKEN, since there is no
// per-request Authorization header on a stdio connection.
async function main() {
  const server = createServer(() => config.stdioToken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the JSON-RPC stream; log to stderr.
  console.error(`ChemBench MCP server (stdio) ready. Proxying to ${config.apiBase}`);
}

main().catch((error) => {
  console.error('Fatal error starting ChemBench MCP server:', error);
  process.exit(1);
});
