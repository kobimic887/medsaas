// Exercise the actual charge/refund functions without booting the application or
// touching Atlas. Real Express/node:http sockets reproduce Bun's missing events.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function chargeSimulationToken('), source.indexOf('\nfunction secretsEqual('));
assert.ok(functions.includes('async function refundSimulationToken('));
const makeCredits = new Function('usersCollection', 'recordAuditEvent', `${functions}\nreturn { chargeSimulationToken, refundSimulationToken };`);

async function scenario({ status, disconnect = false, explicit = false, refundOnDisconnect = true }) {
  let balance = 10;
  let refunds = 0;
  const audits = [];
  const credits = makeCredits({
    async updateOne(filter, update) {
      assert.equal(filter.username, 'credit-test');
      assert.equal(filter.companyId, 'test-company');
      balance += update.$inc.simulationTokens;
      if (update.$inc.simulationTokens === 1) refunds++;
      return { matchedCount: 1 };
    },
  }, async (_req, action) => { audits.push(action); });
  const signals = [];
  let release;
  const upstream = new Promise(resolve => { release = resolve; });
  let charged;
  const didCharge = new Promise(resolve => { charged = resolve; });
  let complete;
  const handlerDone = new Promise(resolve => { complete = resolve; });
  const app = express();
  app.use(express.json());
  app.post('/', async (req, res) => {
    try {
      req.user = { username: 'credit-test', companyId: 'test-company' };
      for (const [emitter, label, event] of [
        [req, 'req.close', 'close'], [req, 'req.aborted', 'aborted'],
        [req.socket, 'socket.close', 'close'], [req.socket, 'socket.end', 'end'],
        [res, 'res.close', 'close'], [res, 'res.finish', 'finish'],
      ]) emitter.on(event, () => { signals.push(label); });
      assert.equal((await credits.chargeSimulationToken(req, res, 'diffdock', { refundOnDisconnect })).ok, true);
      charged();
      await upstream;
      if (explicit) {
        const refunded = await credits.refundSimulationToken(req, 'explicit upstream failure');
        if (!disconnect) assert.equal(refunded, true, 'explicit refund owns settlement');
      }
      res.status(status).json({ status });
      // Give both synchronous end() refunds and asynchronous event refunds time
      // to settle before checking the ledger and audit, including duplicate calls.
      await delay(100);
      assert.equal(req.simulationTokenCharged, refunds ? null : 'diffdock');
      complete();
    } catch (error) { complete(error); }
  });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  socket.on('error', () => {});
  socket.resume();
  try {
    await once(socket, 'connect');
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}');
    await didCharge;
    if (disconnect) {
      const closed = once(socket, 'close');
      socket.destroy();
      await closed;
      await delay(100);
      console.log(`disconnect signals before response (${status}, cacheable=${!refundOnDisconnect}): ${signals.join(', ') || 'none'}`);
    } else {
      await delay(20);
      assert.equal(refunds, 0, 'reading a complete request body must not refund');
    }
    release();
    const error = await handlerDone;
    if (error) throw error;
    const expectedRefunds = explicit || status >= 400 || (disconnect && refundOnDisconnect && signals.includes('res.close') && !signals.includes('res.finish')) ? 1 : 0;
    assert.equal(refunds, expectedRefunds, 'refund exactly once when owed');
    assert.equal(balance, 9 + expectedRefunds);
    assert.equal(audits.filter(action => action === 'usage.token.refund').length, expectedRefunds);
    console.log(`PASS status=${status}, disconnect=${disconnect}, explicit=${explicit}, refundOnDisconnect=${refundOnDisconnect}: ${refunds} refund(s)`);
  } finally {
    release();
    socket.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const watchdog = setTimeout(() => { console.error('credit-refund test timed out'); process.exit(1); }, 15000);
try {
  await scenario({ status: 408, disconnect: true });
  await scenario({ status: 200 });
  await scenario({ status: 408, disconnect: true, explicit: true });
  await scenario({ status: 500 });
  await scenario({ status: 500, explicit: true });
  await scenario({ status: 200, disconnect: true, refundOnDisconnect: false });
  await scenario({ status: 408, disconnect: true, refundOnDisconnect: false });
} finally {
  clearTimeout(watchdog);
}
