#!/usr/bin/env node

/**
 * spike/runtime-capture.mjs
 *
 * Runtime-parametric RSS/startup capture for Bun and Node.
 * Adapts spike/baseline-capture.mjs to support --runtime and --compare-runtime flags.
 *
 * Methodology (D-05):
 *   - N=5 minimum runs
 *   - Cold start: spawn server, poll /health until HTTP 200
 *   - Idle RSS: wait 2s after health, read /proc/<pid>/status VmRSS
 *   - Under-load RSS: spawn spike/load-gen.mjs against /health and /health/db,
 *     sample peak VmRSS while load generator runs
 *   - process.memoryUsage() is intentionally not used
 *   - External science routes are excluded
 *
 * Usage:
 *   node spike/runtime-capture.mjs --runtime bun --compare-runtime node \
 *     --runs 5 --port 3001 --load-duration 30 --load-concurrency 20 \
 *     --baseline .planning/phases/04-compatibility-spike-baseline/BASELINE.md \
 *     --output .planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = new Map();
let showHelp = false;

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--help" || arg === "-h") {
    showHelp = true;
    break;
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

if (showHelp) {
  console.log(`Usage: node spike/runtime-capture.mjs [options]

Captures RSS and cold-start metrics for a given runtime using the Phase 4 methodology.

Options:
  --runtime <bun|node>          Primary runtime to measure (default: bun)
  --compare-runtime <node|bun>  Secondary runtime for back-to-back comparison (optional)
  --runs <N>                    Number of measurement runs, minimum 5 (default: 5)
  --port <N>                    Server port (default: 3001)
  --load-duration <N>           Load generator duration in seconds (default: 30)
  --load-concurrency <N>        Load generator concurrency (default: 20)
  --baseline <path>             Path to Phase 4 BASELINE.md to include in report
  --output <path>               Output path for Markdown report
                                (default: .planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md)

Methodology (D-05):
  - N>=5 runs; median reported
  - Cold start: spawn server, poll /health until HTTP 200
  - Idle RSS: wait 2s after health, read /proc/<pid>/status VmRSS
  - Under-load RSS: spawn spike/load-gen.mjs, sample peak VmRSS while load runs
  - Endpoints: /health and /health/db only (external science routes excluded)
  - RSS boundary: Linux /proc/<pid>/status VmRSS; process.memoryUsage() not used

--runtime and --compare-runtime accept: bun, node`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const projectRoot = process.cwd();
const serverDir = path.join(projectRoot, "server");

const primaryRuntime = args.get("runtime") || "bun";
const compareRuntime = args.get("compare-runtime") || null;
const runs = Number(args.get("runs") || 5);
const port = Number(args.get("port") || 3001);
const baseUrl = `http://127.0.0.1:${port}`;
const loadDurationSeconds = Number(args.get("load-duration") || 30);
const loadConcurrency = Number(args.get("load-concurrency") || 20);
const baselinePath = args.get("baseline") || null;
const outputPath =
  args.get("output") ||
  path.join(
    projectRoot,
    ".planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md"
  );

if (!Number.isInteger(runs) || runs < 5) {
  throw new Error(
    `--runs must be an integer >= 5 (got ${args.get("runs") || runs})`
  );
}

const VALID_RUNTIMES = new Set(["bun", "node"]);
if (!VALID_RUNTIMES.has(primaryRuntime)) {
  throw new Error(`--runtime must be "bun" or "node" (got "${primaryRuntime}")`);
}
if (compareRuntime !== null && !VALID_RUNTIMES.has(compareRuntime)) {
  throw new Error(
    `--compare-runtime must be "bun" or "node" (got "${compareRuntime}")`
  );
}

const serverEnv = {
  ...process.env,
  PORT: String(port),
  NODE_ENV: "test",
  JWT_SECRET:
    process.env.JWT_SECRET || "runtime_capture_jwt_secret_at_least_32_chars",
  STRIPE_SECRET_KEY:
    process.env.STRIPE_SECRET_KEY ||
    "runtime_capture_unused_dummy_stripe_key",
  MONGODB_URI:
    process.env.MONGODB_URI || "mongodb://localhost:27017/runtime_capture",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the absolute path to a runtime binary.
 * Checks HOME/.bun/bin/bun for bun, and process.execPath-based node path.
 * Falls back to the plain binary name (relies on PATH).
 */
function resolveRuntimeBinary(runtime) {
  if (runtime === "bun") {
    const homeBun = path.join(os.homedir(), ".bun", "bin", "bun");
    return homeBun;
  }
  // For node, use the current process executable path so we get the same binary
  // that invoked this script, rather than whatever is first on PATH.
  return process.execPath;
}

/**
 * Read VmRSS for a given pid from Linux /proc/<pid>/status.
 * Returns KiB. Throws on macOS or any system without procfs.
 */
async function readRssKiB(pid) {
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if (!match) {
    throw new Error(`VmRSS not found in /proc/${pid}/status`);
  }
  return Number(match[1]);
}

/**
 * Spawn a server with the given runtime binary and wait for /health to return 200.
 * Returns { child, startupMs }.
 */
async function startServer(runtimeBinary) {
  const binaryName = path.basename(runtimeBinary);
  const child = spawn(runtimeBinary, ["index.js"], {
    cwd: serverDir,
    env: serverEnv,
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
  const deadline = Date.now() + 60_000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `${binaryName} server exited early with code ${child.exitCode}\n${log}`
      );
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

  stopServer(child);
  throw new Error(
    `${binaryName} server did not become healthy: ${lastError}\n${log}`
  );
}

function stopServer(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }

  child.kill("SIGTERM");
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve())),
    sleep(3_000).then(async () => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Measurement functions
// ---------------------------------------------------------------------------

async function measureColdStartMs(runtimeBinary, label) {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    const server = await startServer(runtimeBinary);
    values.push(server.startupMs);
    console.log(
      `[${label}] cold start ${i}/${runs}: ${round(server.startupMs, 1)}ms`
    );
    await stopServer(server.child);
    await sleep(500);
  }
  return values;
}

async function measureIdleRssMiB(runtimeBinary, label) {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    const server = await startServer(runtimeBinary);
    await sleep(2_000);
    const rssKiB = await readRssKiB(server.child.pid);
    values.push(rssKiB / 1024);
    console.log(
      `[${label}] idle RSS ${i}/${runs}: ${round(rssKiB / 1024, 1)}MiB`
    );
    await stopServer(server.child);
    await sleep(500);
  }
  return values;
}

async function measureLoadRssMiB(runtimeBinary, label) {
  const values = [];
  for (let i = 1; i <= runs; i += 1) {
    const server = await startServer(runtimeBinary);
    let peakKiB = await readRssKiB(server.child.pid);

    const loadBinary = process.execPath; // always invoke load-gen with node
    const load = spawn(
      loadBinary,
      [
        "spike/load-gen.mjs",
        "--base-url",
        baseUrl,
        "--duration",
        String(loadDurationSeconds),
        "--concurrency",
        String(loadConcurrency),
      ],
      {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

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
        // Server may have exited; handled below.
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
      throw new Error(
        `load generator failed with code ${exitCode}\n${loadOutput}`
      );
    }

    values.push(peakKiB / 1024);
    console.log(
      `[${label}] under-load RSS ${i}/${runs}: ${round(peakKiB / 1024, 1)}MiB`
    );
    await stopServer(server.child);
    await sleep(500);
  }
  return values;
}

/**
 * Capture all metrics for a runtime. Returns { coldStartMs, idleRssMiB, underLoadRssMiB }.
 */
async function captureMetrics(runtimeBinary, label) {
  console.log(
    `\nCapturing ${label} metrics (N=${runs}, port=${port}, load ${loadDurationSeconds}s @ ${loadConcurrency} concurrency)...`
  );

  const coldStartMs = await measureColdStartMs(runtimeBinary, label);
  const idleRssMiB = await measureIdleRssMiB(runtimeBinary, label);
  const underLoadRssMiB = await measureLoadRssMiB(runtimeBinary, label);

  return { coldStartMs, idleRssMiB, underLoadRssMiB };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function buildRuntimeVersionLine(runtimeBinary) {
  return new Promise((resolve) => {
    const child = spawn(runtimeBinary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
    });
    child.once("exit", () => resolve(out.trim().split("\n")[0] || "unknown"));
  });
}

async function readBaselineSection(baselineFilePath) {
  if (!baselineFilePath) return null;
  try {
    return await readFile(baselineFilePath, "utf8");
  } catch {
    return null;
  }
}

function formatSamples(values, decimals = 1) {
  return values.map((v) => round(v, decimals)).join(", ");
}

async function generateReport(primaryMetrics, compareMetrics, primaryRuntime, compareRuntime) {
  const primaryBinary = resolveRuntimeBinary(primaryRuntime);
  const primaryVersion = await buildRuntimeVersionLine(primaryBinary);
  const compareVersion = compareRuntime
    ? await buildRuntimeVersionLine(resolveRuntimeBinary(compareRuntime))
    : null;

  const baselineContent = await readBaselineSection(baselinePath);

  const primaryMedians = {
    coldStartMs: Math.round(median(primaryMetrics.coldStartMs)),
    idleRssMiB: round(median(primaryMetrics.idleRssMiB), 1),
    underLoadRssMiB: round(median(primaryMetrics.underLoadRssMiB), 1),
  };

  // Phase 4 Node baseline constants (D-05 comparability anchors)
  const NODE_BASELINE_IDLE_RSS = 118.9;
  const NODE_BASELINE_LOAD_RSS = 219.7;
  const NODE_BASELINE_COLD_START_MS = 764;

  // D-06 gate: Bun median idle RSS strictly less than Node baseline → PASS
  let gateResult;
  let gateRuntime;
  if (primaryRuntime === "bun") {
    gateRuntime = "Bun";
    if (primaryMedians.idleRssMiB < NODE_BASELINE_IDLE_RSS) {
      gateResult = "PASS - Bun remains default";
    } else {
      gateResult = "FAIL - Node remains default";
    }
  } else {
    // If measuring Node as primary, Bun numbers not available — gate is inconclusive
    gateResult = "INCONCLUSIVE - Bun not measured as primary";
    gateRuntime = "Node";
  }

  const redactedMongodb = (serverEnv.MONGODB_URI || "").replace(
    /\/\/[^@]+@/,
    "//<redacted>@"
  );

  const capturedAt = new Date().toISOString();
  const machineLabel = `${os.hostname()} (${os.arch()})`;
  const osLabel = `${os.type()} ${os.release()}`;

  // Compare deltas vs Node baseline
  const idleDelta =
    primaryRuntime === "bun"
      ? round(primaryMedians.idleRssMiB - NODE_BASELINE_IDLE_RSS, 1)
      : null;
  const loadDelta =
    primaryRuntime === "bun"
      ? round(primaryMedians.underLoadRssMiB - NODE_BASELINE_LOAD_RSS, 1)
      : null;
  const coldDelta =
    primaryRuntime === "bun"
      ? Math.round(primaryMedians.coldStartMs - NODE_BASELINE_COLD_START_MS)
      : null;

  const deltaSign = (v) => (v > 0 ? `+${v}` : String(v));

  let compareSection = "";
  if (compareMetrics && compareRuntime) {
    const compareMedians = {
      coldStartMs: Math.round(median(compareMetrics.coldStartMs)),
      idleRssMiB: round(median(compareMetrics.idleRssMiB), 1),
      underLoadRssMiB: round(median(compareMetrics.underLoadRssMiB), 1),
    };

    compareSection = `
## Back-to-Back ${compareRuntime.charAt(0).toUpperCase() + compareRuntime.slice(1)} Sanity Run (Same Machine)

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | ${compareMedians.idleRssMiB} | MiB | ${formatSamples(compareMetrics.idleRssMiB)} |
| RSS Under Load | ${compareMedians.underLoadRssMiB} | MiB | ${formatSamples(compareMetrics.underLoadRssMiB)} |
| Cold Start | ${compareMedians.coldStartMs} | ms | ${formatSamples(compareMetrics.coldStartMs, 0)} |

**Runtime:** ${compareRuntime} (${compareVersion})
`;
  }

  let baselineRef = "";
  if (baselineContent) {
    baselineRef = `
## Phase 4 Node Baseline (Reference)

Source: \`${baselinePath}\`

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | ${NODE_BASELINE_IDLE_RSS} | MiB | 121.9, 114.3, 118.9, 119.3, 110.8 |
| RSS Under Load | ${NODE_BASELINE_LOAD_RSS} | MiB | 221.4, 217.9, 219.7, 222.7, 217.5 |
| Cold Start | ${NODE_BASELINE_COLD_START_MS} | ms | 1059, 768, 764, 762, 762 |

- **Captured:** 2026-06-04T16:21:18.066Z
- **Machine:** oracle ssh alias, host \`instance-20260207-2053\`, inside \`node:22-slim\` arm64 container
- **OS:** Linux 6.17.0-1011-oracle
`;
  }

  let deltaSection = "";
  if (primaryRuntime === "bun" && idleDelta !== null) {
    deltaSection = `
## Median Deltas vs Phase 4 Node Baseline

| Metric | Node Baseline | Bun Measured | Delta |
|--------|---------------|--------------|-------|
| Idle RSS | ${NODE_BASELINE_IDLE_RSS} MiB | ${primaryMedians.idleRssMiB} MiB | ${deltaSign(idleDelta)} MiB |
| RSS Under Load | ${NODE_BASELINE_LOAD_RSS} MiB | ${primaryMedians.underLoadRssMiB} MiB | ${deltaSign(loadDelta)} MiB |
| Cold Start | ${NODE_BASELINE_COLD_START_MS} ms | ${primaryMedians.coldStartMs} ms | ${deltaSign(coldDelta)} ms |
`;
  }

  const report = `# Bun Before/After Runtime Report

Captured: ${capturedAt}

## Gate Result: ${gateResult}

D-06 rule: Bun median idle RSS < ${NODE_BASELINE_IDLE_RSS} MiB (Node Phase 4 baseline) → Bun remains default.
Bun median idle RSS: **${primaryRuntime === "bun" ? primaryMedians.idleRssMiB : "N/A"} MiB**

## Primary Runtime: ${primaryRuntime.charAt(0).toUpperCase() + primaryRuntime.slice(1)}

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | ${primaryMedians.idleRssMiB} | MiB | ${formatSamples(primaryMetrics.idleRssMiB)} |
| RSS Under Load | ${primaryMedians.underLoadRssMiB} | MiB | ${formatSamples(primaryMetrics.underLoadRssMiB)} |
| Cold Start | ${primaryMedians.coldStartMs} | ms | ${formatSamples(primaryMetrics.coldStartMs, 0)} |

**Runtime:** ${primaryRuntime} (${primaryVersion})
${compareSection}${deltaSection}${baselineRef}
## Methodology

- **Machine:** ${machineLabel}
- **OS:** ${osLabel}
- **Runs:** N=${runs}; median reported for every repeated metric.
- **Primary runtime command:** \`${primaryRuntime} index.js\`
- **MongoDB boundary:** \`${redactedMongodb}\`
- **RSS boundary:** Linux \`/proc/<pid>/status\` \`VmRSS\`; \`process.memoryUsage()\` is intentionally not used.
- **Idle RSS:** wait for \`/health\`, idle 2 seconds, sample VmRSS.
- **RSS under load:** spawn \`spike/load-gen.mjs --base-url ${baseUrl} --duration ${loadDurationSeconds} --concurrency ${loadConcurrency}\`, sample peak VmRSS while load generator runs.
- **Load endpoint mix:** \`/health\` and \`/health/db\` only. External science routes are excluded because they depend on external APIs and would make measurements non-deterministic.
- **Cold start:** spawn server and poll \`/health\` until HTTP 200.
- **Load generator command:** \`node spike/load-gen.mjs --base-url ${baseUrl} --duration ${loadDurationSeconds} --concurrency ${loadConcurrency}\`
`;

  return { report, gateResult, primaryMedians };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const primaryBinary = resolveRuntimeBinary(primaryRuntime);
const primaryMetrics = await captureMetrics(primaryBinary, primaryRuntime);

let compareMetrics = null;
if (compareRuntime) {
  const compareBinary = resolveRuntimeBinary(compareRuntime);
  compareMetrics = await captureMetrics(compareBinary, compareRuntime);
}

const { report, gateResult, primaryMedians } = await generateReport(
  primaryMetrics,
  compareMetrics,
  primaryRuntime,
  compareRuntime
);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, report);

console.log(`\nWrote ${outputPath}`);
console.log(`Gate Result: ${gateResult}`);
console.log(
  JSON.stringify(
    {
      runtime: primaryRuntime,
      runs,
      medians: primaryMedians,
      gateResult,
    },
    null,
    2
  )
);
