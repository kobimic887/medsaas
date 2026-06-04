#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--help" || arg === "-h") {
    console.log(`Usage: node spike/baseline-capture.mjs [--runs N] [--ci-seconds N]

Captures Node baseline medians for:
  idle RSS, under-load RSS, cold-start ms, cold npm install s, CI wall-clock s.

This script removes server/node_modules during cold install timing. Run it from
an isolated checkout or temp bundle.`);
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

const projectRoot = process.cwd();
const serverDir = path.join(projectRoot, "server");
const outputPath = path.join(projectRoot, ".planning/phases/04-compatibility-spike-baseline/BASELINE.md");
const runs = Number(args.get("runs") || process.env.BASELINE_RUNS || 5);
const port = Number(args.get("port") || process.env.PORT || 3000);
const baseUrl = `http://127.0.0.1:${port}`;
const loadDurationSeconds = Number(args.get("load-duration") || process.env.LOAD_DURATION_SECONDS || 30);
const loadConcurrency = Number(args.get("load-concurrency") || process.env.LOAD_CONCURRENCY || 20);
const ciWallClockSeconds = Number(args.get("ci-seconds") || process.env.CI_WALL_CLOCK_SECONDS || 68);
const env = {
  ...process.env,
  PORT: String(port),
  NODE_ENV: "test",
  JWT_SECRET: process.env.JWT_SECRET || "node_baseline_jwt_secret_at_least_32_chars",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "node_baseline_unused_dummy_stripe_key",
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/node_baseline",
};

if (!Number.isInteger(runs) || runs < 5) {
  throw new Error("runs must be an integer >= 5");
}

if (!Number.isFinite(ciWallClockSeconds) || ciWallClockSeconds < 0) {
  throw new Error("ci wall-clock seconds must be numeric");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRssKiB(pid) {
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if (!match) {
    throw new Error(`VmRSS not found for pid ${pid}`);
  }
  return Number(match[1]);
}

async function runCommand(command, commandArgs, options = {}) {
  const started = performance.now();
  const child = spawn(command, commandArgs, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const code = await new Promise((resolve) => {
    child.on("exit", resolve);
  });

  const elapsedMs = performance.now() - started;
  if (code !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with code ${code}\n${output}`);
  }

  return { elapsedMs, output };
}

async function startServer() {
  const child = spawn("node", ["index.js"], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  const started = performance.now();
  const deadline = Date.now() + 40_000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}\n${log}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) {
        return {
          child,
          startupMs: performance.now() - started,
          log: () => log,
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(250);
  }

  await stopServer(child);
  throw new Error(`server did not become healthy: ${lastError}\n${log}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const result = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve("exited"))),
    sleep(2_000).then(() => "timeout"),
  ]);

  if (result === "timeout" && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function measureInstallSeconds() {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    await rm(path.join(serverDir, "node_modules"), { recursive: true, force: true });
    await runCommand("npm", ["cache", "clean", "--force"], { cwd: serverDir });
    const { elapsedMs } = await runCommand("npm", ["install", "--omit=dev"], { cwd: serverDir });
    values.push(elapsedMs / 1000);
    console.log(`cold npm install ${i}/${runs}: ${round(elapsedMs / 1000, 2)}s`);
  }
  return values;
}

async function measureColdStartMs() {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    const server = await startServer();
    values.push(server.startupMs);
    console.log(`cold start ${i}/${runs}: ${round(server.startupMs, 1)}ms`);
    await stopServer(server.child);
    await sleep(500);
  }
  return values;
}

async function measureIdleRssMiB() {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    const server = await startServer();
    await sleep(2_000);
    const rssKiB = await readRssKiB(server.child.pid);
    values.push(rssKiB / 1024);
    console.log(`idle RSS ${i}/${runs}: ${round(rssKiB / 1024, 1)}MiB`);
    await stopServer(server.child);
    await sleep(500);
  }
  return values;
}

async function measureLoadRssMiB() {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    const server = await startServer();
    let peakKiB = await readRssKiB(server.child.pid);
    const load = spawn("node", [
      "spike/load-gen.mjs",
      "--base-url",
      baseUrl,
      "--duration",
      String(loadDurationSeconds),
      "--concurrency",
      String(loadConcurrency),
    ], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let loadOutput = "";
    load.stdout.on("data", (chunk) => {
      loadOutput += chunk.toString();
    });
    load.stderr.on("data", (chunk) => {
      loadOutput += chunk.toString();
    });

    while (load.exitCode === null) {
      try {
        peakKiB = Math.max(peakKiB, await readRssKiB(server.child.pid));
      } catch {
        // The server exiting is handled by the load result and final stop.
      }
      await sleep(500);
    }

    const exitCode = await new Promise((resolve) => {
      if (load.exitCode !== null) {
        resolve(load.exitCode);
      } else {
        load.once("exit", resolve);
      }
    });

    if (exitCode !== 0) {
      await stopServer(server.child);
      throw new Error(`load generator failed with code ${exitCode}\n${loadOutput}`);
    }

    values.push(peakKiB / 1024);
    console.log(`under-load RSS ${i}/${runs}: ${round(peakKiB / 1024, 1)}MiB`);
    await stopServer(server.child);
    await sleep(500);
  }
  return values;
}

console.log(`Capturing Node baseline with N=${runs}, load concurrency=${loadConcurrency}, duration=${loadDurationSeconds}s`);

const installSeconds = await measureInstallSeconds();
const coldStartMs = await measureColdStartMs();
const idleRssMiB = await measureIdleRssMiB();
const loadRssMiB = await measureLoadRssMiB();

const medians = {
  idleRssMiB: round(median(idleRssMiB), 1),
  underLoadRssMiB: round(median(loadRssMiB), 1),
  coldStartMs: Math.round(median(coldStartMs)),
  coldNpmInstallSeconds: round(median(installSeconds), 2),
  ciWallClockSeconds: Math.round(ciWallClockSeconds),
};

const completedAt = new Date().toISOString();
const machineLabel = process.env.BASELINE_MACHINE_LABEL || `${os.hostname()} (${os.arch()})`;
const markdown = `# Phase 04 Node Baseline

Captured: ${completedAt}

## Baseline Metrics

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | ${medians.idleRssMiB} | MiB | ${idleRssMiB.map((v) => round(v, 1)).join(", ")} |
| RSS Under Load | ${medians.underLoadRssMiB} | MiB | ${loadRssMiB.map((v) => round(v, 1)).join(", ")} |
| Cold Start | ${medians.coldStartMs} | ms | ${coldStartMs.map((v) => Math.round(v)).join(", ")} |
| Cold npm Install | ${medians.coldNpmInstallSeconds} | s | ${installSeconds.map((v) => round(v, 2)).join(", ")} |
| CI Wall-Clock | ${medians.ciWallClockSeconds} | s | latest successful workflow_dispatch deploy.yml run |

## Methodology

- **Machine:** ${machineLabel}
- **OS:** ${os.type()} ${os.release()}
- **Node:** ${process.version}
- **Runs:** N=${runs}; median reported for every repeated metric.
- **Server command:** \`node server/index.js\`
- **MongoDB:** \`${env.MONGODB_URI.replace(/\/\/.*@/, "//<redacted>@")}\`
- **RSS boundary:** Linux \`/proc/<pid>/status\` \`VmRSS\`; \`process.memoryUsage()\` is intentionally not used.
- **Idle RSS:** wait for \`/health\`, idle 2 seconds, sample VmRSS.
- **RSS under load:** run \`node spike/load-gen.mjs --base-url ${baseUrl} --duration ${loadDurationSeconds} --concurrency ${loadConcurrency}\`, sample peak VmRSS while the load generator runs.
- **Load endpoint mix:** \`/health\` and \`/health/db\` only. External science routes are excluded because they depend on external APIs and would make the baseline non-deterministic.
- **Cold start:** spawn server and poll \`/health\` until HTTP 200.
- **Cold npm install:** remove \`server/node_modules\`, run \`npm cache clean --force\`, then time \`npm install --omit=dev\`.
- **CI wall-clock:** latest successful \`workflow_dispatch\` run of \`.github/workflows/deploy.yml\`, run 26954138891, from 2026-06-04T13:16:31Z to 2026-06-04T13:17:39Z.

## Reuse In Phase 5

Run the same \`spike/load-gen.mjs\` endpoint mix, concurrency, duration, RSS boundary, and N when capturing Bun metrics. The only intended variable is the server runtime.
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown);
console.log(`Wrote ${outputPath}`);
console.log(JSON.stringify(medians, null, 2));
