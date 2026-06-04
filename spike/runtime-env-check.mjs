#!/usr/bin/env node
// spike/runtime-env-check.mjs
// Runtime availability probe for local and oracle execution hosts.
// Usage: node spike/runtime-env-check.mjs --target local [--output PATH] [--require bun,node,npm]
//        node spike/runtime-env-check.mjs --target oracle [--host ALIAS] [--output PATH] [--require bun,node,npm]
// Dependency-free ESM — no npm install needed.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = {};
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`Usage: node spike/runtime-env-check.mjs [options]

Options:
  --target <local|oracle>   Where to probe runtimes (default: local)
  --host <ssh-alias>        SSH alias for oracle checks (default: oracle)
  --output <path>           Write Markdown report to this file path
  --require <a,b,c>         Comma-separated list of required binaries (default: bun,node,npm)
  --help, -h                Show this help message

Probed binaries (both targets): bun, node, npm, docker
`);
  process.exit(0);
}

for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      console.error(`Error: missing value for --${key}`);
      process.exit(1);
    }
    args[key] = next;
    i++;
  }
}

const target = args['target'] || 'local';
const oracleHost = args['host'] || 'oracle';
const outputPath = args['output'] || null;
const requireList = (args['require'] || 'bun,node,npm').split(',').map(s => s.trim()).filter(Boolean);

if (!['local', 'oracle'].includes(target)) {
  console.error(`Error: --target must be "local" or "oracle", got "${target}"`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------
function probe(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 8000 });
    return out.trim();
  } catch {
    return null;
  }
}

function probeRuntime(name, versionCmd) {
  const pathResult = probe(`command -v ${name}`);
  const version = pathResult ? probe(versionCmd) : null;
  return { name, path: pathResult, version };
}

// ---------------------------------------------------------------------------
// Local probe
// ---------------------------------------------------------------------------
function probeLocal() {
  return [
    probeRuntime('bun', 'bun --version'),
    probeRuntime('node', 'node --version'),
    probeRuntime('npm', 'npm --version'),
    probeRuntime('docker', 'docker --version'),
  ];
}

// ---------------------------------------------------------------------------
// Oracle probe via SSH
// ---------------------------------------------------------------------------
// The exact noninteractive command form used so downstream plans know what PATH was probed.
function ORACLE_PROBE_CMD(host) {
  return 'ssh ' + host + ' \'bash -lc "for b in bun node npm docker; do echo -n \\"$b: \\"; command -v $b 2>/dev/null && $b --version 2>/dev/null | head -1 | tr -d \\"\\\\n\\" || echo not_found; echo; done"\'';
}

function probeOracle(host) {
  const cmdStr = ORACLE_PROBE_CMD(host);
  const raw = probe(cmdStr);
  if (!raw) return null;

  const runtimes = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/^(\w+): (.+)$/);
    if (match) {
      const name = match[1];
      const rest = match[2].trim();
      if (rest === 'not_found' || rest === '') {
        runtimes.push({ name, path: null, version: null });
      } else {
        // rest is: /path/to/binary<optional whitespace>version-string
        const parts = rest.split(/\s+/);
        runtimes.push({ name, path: parts[0], version: parts.slice(1).join(' ') || parts[0] });
      }
    }
  }

  // Ensure all four binaries are present even if parsing missed them
  for (const name of ['bun', 'node', 'npm', 'docker']) {
    if (!runtimes.find(r => r.name === name)) {
      runtimes.push({ name, path: null, version: null });
    }
  }

  return runtimes;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------
function runtimeRow(r) {
  if (!r.path) return `| \`${r.name}\` | not found | — |`;
  return `| \`${r.name}\` | \`${r.path}\` | ${r.version || '—'} |`;
}

function buildReport({ localRuntimes, oracleRuntimes, oracleHost, target, requiredBinaries, blockingMissing }) {
  const ts = new Date().toISOString();
  const lines = [];

  lines.push(`# Runtime Environment Report`);
  lines.push(`\n_Generated: ${ts}_`);
  lines.push(`_Target: ${target}_`);
  lines.push('');

  lines.push(`## Local Runtime`);
  lines.push('');
  lines.push('| Binary | Path | Version |');
  lines.push('|--------|------|---------|');
  for (const r of localRuntimes) {
    lines.push(runtimeRow(r));
  }
  lines.push('');

  lines.push(`## Oracle Runtime`);
  lines.push('');
  if (target === 'local') {
    lines.push(`_Not probed (target=local). Oracle host: \`${oracleHost}\`._`);
    lines.push('');
    lines.push('**Exact command form used for oracle noninteractive checks:**');
    lines.push('');
    lines.push('```bash');
    lines.push(ORACLE_PROBE_CMD(oracleHost));
    lines.push('```');
  } else if (!oracleRuntimes) {
    lines.push(`_SSH probe failed — could not reach host \`${oracleHost}\`._`);
    lines.push('');
    lines.push('**Exact command form used for oracle noninteractive checks:**');
    lines.push('');
    lines.push('```bash');
    lines.push(ORACLE_PROBE_CMD(oracleHost));
    lines.push('```');
  } else {
    lines.push(`_Host: \`${oracleHost}\`_`);
    lines.push('');
    lines.push('| Binary | Path | Version |');
    lines.push('|--------|------|---------|');
    for (const r of oracleRuntimes) {
      lines.push(runtimeRow(r));
    }
    lines.push('');
    lines.push('**Exact command form used for oracle noninteractive checks:**');
    lines.push('');
    lines.push('```bash');
    lines.push(ORACLE_PROBE_CMD(oracleHost));
    lines.push('```');
  }
  lines.push('');

  lines.push(`## Execution Path`);
  lines.push('');
  lines.push('Phase 5 server runtime scripts invoke binaries by name through npm scripts.');
  lines.push('The exact binary executed depends on which is first on the execution host PATH.');
  lines.push('');
  lines.push('| Context | Default runtime binary | Rollback binary |');
  lines.push('|---------|----------------------|-----------------|');
  lines.push('| Local dev/prod | `bun` | `node` |');
  lines.push('| Oracle (smoke/measurement) | depends on host PATH / container | install or activate explicitly |');
  lines.push('');
  lines.push('Later plans (05-02, 05-03) that run smoke tests or capture measurements MUST');
  lines.push('verify `bun --version` succeeds on the execution host before proceeding.');
  lines.push('');

  if (blockingMissing.length > 0) {
    lines.push(`## Blocking Missing Runtime`);
    lines.push('');
    lines.push('The following required binaries were NOT found on the **local** host:');
    lines.push('');
    for (const name of blockingMissing) {
      lines.push(`- \`${name}\``);
    }
    lines.push('');
    lines.push('Downstream smoke and measurement work MUST NOT assume these binaries are');
    lines.push('available until they are installed and re-verified.');
  } else {
    lines.push(`## Blocking Missing Runtime`);
    lines.push('');
    lines.push('None — all required binaries found on local host.');
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`[runtime-env-check] target=${target} host=${oracleHost} require=${requireList.join(',')}`);

const localRuntimes = probeLocal();

let oracleRuntimes = null;
if (target === 'oracle') {
  console.log(`[runtime-env-check] probing oracle via SSH (host: ${oracleHost})...`);
  oracleRuntimes = probeOracle(oracleHost);
  if (!oracleRuntimes) {
    console.warn(`[runtime-env-check] WARNING: oracle probe failed — SSH to "${oracleHost}" did not return output`);
  }
}

// Determine blocking missing: required binaries not found locally
const blockingMissing = requireList.filter(name => {
  const found = localRuntimes.find(r => r.name === name);
  return !found || !found.path;
});

for (const r of localRuntimes) {
  const status = r.path ? `✓ ${r.version}` : '✗ not found';
  console.log(`  local ${r.name}: ${status}`);
}

if (blockingMissing.length > 0) {
  console.warn(`[runtime-env-check] BLOCKING: required binaries missing locally: ${blockingMissing.join(', ')}`);
}

const report = buildReport({ localRuntimes, oracleRuntimes, oracleHost, target, requiredBinaries: requireList, blockingMissing });

if (outputPath) {
  const dir = dirname(outputPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, report, 'utf8');
  console.log(`[runtime-env-check] report written to: ${outputPath}`);
} else {
  console.log('\n--- REPORT ---\n');
  console.log(report);
}

// Exit non-zero only if required binaries are missing locally
if (blockingMissing.length > 0) {
  process.exit(1);
}
