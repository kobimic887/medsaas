# Bun Before/After Runtime Report

Captured: 2026-06-04T21:32:01.752Z

## Gate Result: PASS - Bun remains default

D-06 rule: Bun median idle RSS < 118.9 MiB (Node Phase 4 baseline) → Bun remains default.
Bun median idle RSS: **115.1 MiB**

## Primary Runtime: Bun

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | 115.1 | MiB | 115.4, 115.4, 114.9, 115.1, 114.4 |
| RSS Under Load | 225.6 | MiB | 222.7, 217.8, 234.2, 225.6, 253.2 |
| Cold Start | 763 | ms | 1062, 766, 763, 761, 763 |

**Runtime:** bun (1.3.14)

## Back-to-Back Node Sanity Run (Same Machine)

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | 115.5 | MiB | 111.7, 115.5, 113.3, 116.6, 118.2 |
| RSS Under Load | 221.4 | MiB | 214.5, 221.4, 227.3, 218.6, 222.1 |
| Cold Start | 762 | ms | 762, 761, 762, 762, 762 |

**Runtime:** node (v22.22.3)

## Median Deltas vs Phase 4 Node Baseline

| Metric | Node Baseline | Bun Measured | Delta |
|--------|---------------|--------------|-------|
| Idle RSS | 118.9 MiB | 115.1 MiB | -3.8 MiB |
| RSS Under Load | 219.7 MiB | 225.6 MiB | +5.9 MiB |
| Cold Start | 764 ms | 763 ms | -1 ms |

## Phase 4 Node Baseline (Reference)

Source: `.planning/phases/04-compatibility-spike-baseline/BASELINE.md`

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | 118.9 | MiB | 121.9, 114.3, 118.9, 119.3, 110.8 |
| RSS Under Load | 219.7 | MiB | 221.4, 217.9, 219.7, 222.7, 217.5 |
| Cold Start | 764 | ms | 1059, 768, 764, 762, 762 |

- **Captured:** 2026-06-04T16:21:18.066Z
- **Machine:** oracle ssh alias, host `instance-20260207-2053`, inside `node:22-slim` arm64 container
- **OS:** Linux 6.17.0-1011-oracle

## Methodology

- **Machine:** 9c477b3bc711 (arm64)
- **OS:** Linux 6.17.0-1011-oracle
- **Runs:** N=5; median reported for every repeated metric.
- **Primary runtime command:** `bun index.js`
- **MongoDB boundary:** `mongodb://cap-mongo:27017/runtime_capture`
- **RSS boundary:** Linux `/proc/<pid>/status` `VmRSS`; `process.memoryUsage()` is intentionally not used.
- **Idle RSS:** wait for `/health`, idle 2 seconds, sample VmRSS.
- **RSS under load:** spawn `spike/load-gen.mjs --base-url http://127.0.0.1:3001 --duration 30 --concurrency 20`, sample peak VmRSS while load generator runs.
- **Load endpoint mix:** `/health` and `/health/db` only. External science routes are excluded because they depend on external APIs and would make measurements non-deterministic.
- **Cold start:** spawn server and poll `/health` until HTTP 200.
- **Load generator command:** `node spike/load-gen.mjs --base-url http://127.0.0.1:3001 --duration 30 --concurrency 20`
