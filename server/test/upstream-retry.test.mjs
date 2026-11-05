// Unit tests for server/utils/upstreamRetry.js — no server boot, no MongoDB.
//
// Run: SERVER_RUNTIME=bun bun test/upstream-retry.test.mjs

import assert from 'node:assert/strict';
import { completeNvidiaFoldResponse, hasFoldCoordinates } from '../utils/nvidiaFoldResponse.js';

import {
  fetchWithUpstreamRetry,
  isRetryableUpstreamError,
  isRetryableUpstreamStatus,
  safeUpstreamUrl,
  upstreamRetryDelayMs,
} from '../utils/upstreamRetry.js';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
    failed += 1;
  }
}

console.log('upstreamRetry:\n');

check('5xx is retryable', isRetryableUpstreamStatus(502) === true);
check('500 is retryable', isRetryableUpstreamStatus(500) === true);
check('4xx is not retryable', isRetryableUpstreamStatus(404) === false);
check('401 is not retryable', isRetryableUpstreamStatus(401) === false);
check('200 is not retryable', isRetryableUpstreamStatus(200) === false);

check('TimeoutError is retryable', isRetryableUpstreamError({ name: 'TimeoutError', message: 'aborted' }));
check('ECONNRESET is retryable', isRetryableUpstreamError({ code: 'ECONNRESET', message: 'reset' }));
check('validation Error is not', isRetryableUpstreamError({ name: 'Error', message: 'bad input' }) === false);

check('delay attempt1 = base', upstreamRetryDelayMs(1, { baseMs: 250, maxMs: 2000 }) === 250);
check('delay attempt2 doubles', upstreamRetryDelayMs(2, { baseMs: 250, maxMs: 2000 }) === 500);
check('delay caps at max', upstreamRetryDelayMs(10, { baseMs: 250, maxMs: 2000 }) === 2000);

check(
  'safeUpstreamUrl strips query + creds',
  safeUpstreamUrl('https://user:pass@dev.asinex.com:58181/api/all/0_5?token=secret') ===
    'https://dev.asinex.com:58181/api/all/0_5'
);

{
  const sleeps = [];
  const statuses = [502, 200];
  let calls = 0;
  const logs = [];
  const response = await fetchWithUpstreamRetry(
    'http://example.test/api/all/0_5',
    { method: 'GET' },
    {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: (msg) => logs.push(msg),
      fetchImpl: async () => {
        const status = statuses[calls] ?? 200;
        calls += 1;
        return {
          status,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    }
  );
  check('retries once on 502 then returns 200', response.status === 200 && calls === 2);
  check('logged retry with status+url', logs.some((m) => /retry status=502/.test(m) && /example\.test/.test(m)));
  check('slept between attempts', sleeps.length === 1);
}

{
  let calls = 0;
  const response = await fetchWithUpstreamRetry(
    'http://example.test/api/id/BAS%2000293357',
    { method: 'POST' },
    {
      maxAttempts: 3,
      sleep: async () => {},
      log: () => {},
      fetchImpl: async () => {
        calls += 1;
        return { status: 400, arrayBuffer: async () => new ArrayBuffer(0) };
      },
    }
  );
  check('does not retry 4xx', response.status === 400 && calls === 1);
}

{
  let calls = 0;
  let threw = null;
  try {
    await fetchWithUpstreamRetry(
      'http://example.test/down',
      {},
      {
        maxAttempts: 3,
        sleep: async () => {},
        log: () => {},
        fetchImpl: async () => {
          calls += 1;
          const err = new Error('fetch failed');
          err.code = 'ECONNRESET';
          throw err;
        },
      }
    );
  } catch (error) {
    threw = error;
  }
  check('retries network errors then throws', calls === 3 && threw?.code === 'ECONNRESET');
}

{
  let calls = 0;
  const response = await fetchWithUpstreamRetry(
    'http://example.test/api4/mw',
    {},
    {
      maxAttempts: 3,
      sleep: async () => {},
      log: () => {},
      fetchImpl: async () => {
        calls += 1;
        return {
          status: 503,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    }
  );
  check('exhausts attempts on persistent 5xx', response.status === 503 && calls === 3);
}

// Accepted OpenFold jobs use bounded authenticated GETs, never another POST.
{
  const requests = [];
  let clock = 0;
  const accepted = { status: 202, headers: { 'nvcf-reqid': 'job-123' } };
  const completed = { status: 200, data: { outputs: [{ structures_with_scores: [{ structure: 'ATOM coordinates' }] }] } };
  const result = await completeNvidiaFoldResponse(accepted, {
    url: 'https://health.api.nvidia.com/v1/biology/openfold/openfold3/predict', key: 'test-key', deadline: 5000,
    now: () => clock, sleep: async ms => { clock += ms; },
    get: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) throw { response: { status: 503 } };
      if (requests.length === 2) return { status: 202 };
      return completed;
    },
  });
  assert.equal(result, completed);
  assert.equal(requests.length, 3);
  assert(requests.every(({ url, options }) => url === 'https://health.api.nvidia.com/v1/status/job-123' && options.headers.Authorization === 'Bearer test-key' && options.maxRedirects === 0));
  assert(requests[2].options.timeout < requests[0].options.timeout);
  check('OpenFold 202 follows one accepted job with the same key and one deadline', true);
  for (const status of [401, 403, 404, 302]) {
    await assert.rejects(completeNvidiaFoldResponse(accepted, {
      url: 'https://health.api.nvidia.com/predict', key: 'test-key', deadline: 5000, now: () => 0,
      get: async () => { throw { response: { status } }; },
    }), error => error.nvidiaAccepted && error.status === 502);
  }
  await assert.rejects(completeNvidiaFoldResponse({ status: 202, headers: {} }, { url: 'https://health.api.nvidia.com/predict' }), error => error.nvidiaAccepted);
  await assert.rejects(completeNvidiaFoldResponse(accepted, { url: 'https://health.api.nvidia.com/predict', deadline: 0, now: () => 0 }), error => error.nvidiaAccepted && error.status === 504);
  assert(hasFoldCoordinates(completed.data));
  assert(!hasFoldCoordinates({ outputs: [] }));
  assert(!hasFoldCoordinates({ outputs: [{ structures_with_scores: [{ structure: '  ' }] }] }));
  check('OpenFold pending failures stay non-session errors and empty success is refused', true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
