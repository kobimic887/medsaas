# Phase 04 Node Baseline

Captured: 2026-06-04T16:21:18.066Z

## Baseline Metrics

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | 118.9 | MiB | 121.9, 114.3, 118.9, 119.3, 110.8 |
| RSS Under Load | 219.7 | MiB | 221.4, 217.9, 219.7, 222.7, 217.5 |
| Cold Start | 764 | ms | 1059, 768, 764, 762, 762 |
| Cold npm Install | 4.38 | s | 4.4, 4.33, 4.3, 4.43, 4.38 |
| CI Wall-Clock | 68 | s | latest successful workflow_dispatch deploy.yml run |

## Methodology

- **Machine:** oracle ssh alias, host `instance-20260207-2053`, measured inside `node:22-slim` arm64 container
- **OS:** Linux 6.17.0-1011-oracle
- **Node:** v22.22.3
- **Runs:** N=5; median reported for every repeated metric.
- **Server command:** `node server/index.js`
- **MongoDB:** `mongodb://mongo:27017/node_baseline`
- **RSS boundary:** Linux `/proc/<pid>/status` `VmRSS`; `process.memoryUsage()` is intentionally not used.
- **Idle RSS:** wait for `/health`, idle 2 seconds, sample VmRSS.
- **RSS under load:** run `node spike/load-gen.mjs --base-url http://127.0.0.1:3000 --duration 30 --concurrency 20`, sample peak VmRSS while the load generator runs.
- **Load endpoint mix:** `/health` and `/health/db` only. External science routes are excluded because they depend on external APIs and would make the baseline non-deterministic.
- **Cold start:** spawn server and poll `/health` until HTTP 200.
- **Cold npm install:** remove `server/node_modules`, run `npm cache clean --force`, then time `npm install --omit=dev`.
- **CI wall-clock:** latest successful `workflow_dispatch` run of `.github/workflows/deploy.yml`, run 26954138891, from 2026-06-04T13:16:31Z to 2026-06-04T13:17:39Z.

## Reuse In Phase 5

Run the same `spike/load-gen.mjs` endpoint mix, concurrency, duration, RSS boundary, and N when capturing Bun metrics. The only intended variable is the server runtime.
