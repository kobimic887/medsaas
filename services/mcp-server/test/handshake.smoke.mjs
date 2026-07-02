// End-to-end smoke test: proves a real MCP JSON-RPC handshake over Streamable
// HTTP (initialize -> tools/list -> tools/call), and that the caller's bearer
// token is forwarded to the ChemBench platform. A stub platform API stands in for
// the real server so the test is deterministic and needs no live backend.
//
// Run: bun test/handshake.smoke.mjs   (or: node test/handshake.smoke.mjs)

import http from 'node:http';

const PROTOCOL_VERSION = '2025-11-25';
const PLATFORM_TOKEN = 'test-token-abc';
const HEALTH_PAYLOAD = { checks: { gromacs: { status: 'healthy' } }, ok: true };

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

// 1. Stub ChemBench platform API — verifies the bearer token was forwarded.
const stub = http.createServer((req, res) => {
  if (req.url === '/api/platform/health' && req.headers.authorization === `Bearer ${PLATFORM_TOKEN}`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(HEALTH_PAYLOAD));
    return;
  }
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
});
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
process.env.MEDSAAS_API_BASE = `http://127.0.0.1:${stub.address().port}`;

// 2. Start the MCP HTTP server (import AFTER env is set so config picks it up).
const { createHttpApp } = await import('../src/http.js');
const mcp = createHttpApp();
const mcpServer = await new Promise((resolve) => {
  const s = mcp.listen(0, '127.0.0.1', () => resolve(s));
});
const mcpUrl = `http://127.0.0.1:${mcpServer.address().port}/mcp`;

async function rpc(method, params, { token, id = 1 } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json();
}

try {
  // 3. initialize
  const init = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '1.0.0' },
  });
  check('initialize returns serverInfo chembench-mcp', init?.result?.serverInfo?.name === 'chembench-mcp');
  check('initialize advertises tools capability', Boolean(init?.result?.capabilities?.tools));

  // 4. tools/list
  const list = await rpc('tools/list', {}, { id: 2 });
  const tools = list?.result?.tools || [];
  const names = tools.map((t) => t.name);
  check('tools/list returns all 14 tools', tools.length === 14);
  check('tools/list includes platform_health', names.includes('platform_health'));
  check('tools/list includes generate_molecules', names.includes('generate_molecules'));

  // 5. tools/call platform_health WITH token -> forwarded to stub -> canned payload
  const called = await rpc('tools/call', { name: 'platform_health', arguments: {} }, { token: PLATFORM_TOKEN, id: 3 });
  const text = called?.result?.content?.[0]?.text || '';
  check('tools/call platform_health is not an error', called?.result?.isError === false);
  check('tools/call forwards token and returns platform payload', text.includes('"ok": true'));

  // 6. tools/call WITHOUT token -> missing-token error surfaced as a tool result
  const noToken = await rpc('tools/call', { name: 'platform_health', arguments: {} }, { id: 4 });
  check('tools/call without token returns isError', noToken?.result?.isError === true);
  check(
    'tools/call without token explains the missing token',
    (noToken?.result?.content?.[0]?.text || '').includes('No ChemBench platform token'),
  );
} finally {
  mcpServer.close();
  stub.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll handshake checks passed.');
process.exit(0);
