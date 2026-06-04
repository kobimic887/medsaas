#!/usr/bin/env node

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--help" || arg === "-h") {
    console.log(`Usage: node spike/load-gen.mjs [--base-url URL] [--duration SECONDS] [--concurrency N]

Drives fixed-concurrency GET requests against deterministic local endpoints:
  /health
  /health/db

External science/API routes are intentionally excluded.`);
    process.exit(0);
  }

  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    args.set(key, value);
    i += 1;
  }
}

const baseUrl = (args.get("base-url") || process.env.LOAD_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const durationSeconds = Number(args.get("duration") || process.env.LOAD_DURATION_SECONDS || 30);
const concurrency = Number(args.get("concurrency") || process.env.LOAD_CONCURRENCY || 20);
const endpoints = ["/health", "/health/db"];

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  throw new Error("duration must be a positive number of seconds");
}

if (!Number.isInteger(concurrency) || concurrency <= 0) {
  throw new Error("concurrency must be a positive integer");
}

let sent = 0;
let completed = 0;
let failed = 0;
const startedAt = Date.now();
const deadline = startedAt + durationSeconds * 1000;

async function worker(workerId) {
  let index = workerId % endpoints.length;

  while (Date.now() < deadline) {
    const endpoint = endpoints[index % endpoints.length];
    index += 1;
    sent += 1;

    try {
      const response = await fetch(`${baseUrl}${endpoint}`);
      await response.arrayBuffer();
      if (!response.ok) {
        failed += 1;
      }
    } catch {
      failed += 1;
    } finally {
      completed += 1;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, (_value, index) => worker(index)));

const elapsedSeconds = (Date.now() - startedAt) / 1000;
const result = {
  baseUrl,
  endpoints,
  durationSeconds,
  concurrency,
  sent,
  completed,
  failed,
  requestsPerSecond: Number((completed / elapsedSeconds).toFixed(2)),
};

console.log(JSON.stringify(result, null, 2));

if (failed > 0) {
  process.exitCode = 1;
}
