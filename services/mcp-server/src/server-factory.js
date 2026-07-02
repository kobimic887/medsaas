import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools.js';

// Builds an McpServer with the ChemBench tool set registered. `getToken` is called
// at tool-invocation time to resolve the caller's platform token, so a fresh
// server (HTTP, per request) and a long-lived one (stdio) share identical tools.
export function createServer(getToken) {
  const server = new McpServer({
    name: 'chembench-mcp',
    version: '1.0.0',
  });

  registerTools(server, getToken);
  return server;
}
