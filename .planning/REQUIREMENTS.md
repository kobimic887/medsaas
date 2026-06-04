# Requirements: ChemBench — v2 Bun Migration

**Defined:** 2026-06-04
**Core Value:** Labs and customers get a professional, focused tool — not a rebranded demo with debug artifacts. v2 keeps the product identical while making the server cheaper to run (RAM) and the toolchain faster (startup, install, CI).

## v2 Requirements

Requirements for the Bun Migration milestone. Each maps to a roadmap phase. "User" here is the developer/operator running and deploying ChemBench.

### Measurement & Baselines (MEAS)

- [x] **MEAS-01**: Baseline Node metrics are captured and recorded in the repo — server RSS at idle and under a representative request load, cold-start time, `npm install` time (cold cache), and CI pipeline wall-clock time
- [ ] **MEAS-02**: Post-migration Bun metrics are captured with the same method and compared against the baseline in a written before/after report
- [ ] **MEAS-03**: The migration outcome is gated on measured results — if Bun does not reduce server RAM, the report documents it and the Node fallback remains the default

### Compatibility Spike (CMPT)

- [x] **CMPT-01**: A runnable proof-of-concept boots the Express server under Bun on arm64 and serves the existing `/health` endpoint
- [x] **CMPT-02**: The MongoDB driver is verified working under Bun (connect, query, and index creation against a real Mongo instance)
- [x] **CMPT-03**: `amqplib` (RabbitMQ) is verified working under Bun (publish and consume a message)
- [x] **CMPT-04**: Stripe SDK calls and webhook signature verification are verified working under Bun
- [x] **CMPT-05**: `@rdkit/rdkit` (WASM) loads and executes under Bun
- [x] **CMPT-06**: The `oven/bun` arm64 base image is confirmed to build and run the server inside a container

### Server Runtime (RUN)

- [ ] **RUN-01**: The Express API runs in dev on `bun` (replacing `node --watch`) with working file-watch reload
- [ ] **RUN-02**: The Express API runs in production on `bun` (the `start:unified` equivalent), serving the built frontend
- [ ] **RUN-03**: Startup env-var validation and all existing middleware/routes behave identically under Bun, verified by a smoke test of auth, the Stripe billing webhook, and one token-consuming simulation endpoint
- [ ] **RUN-04**: Node-compatible run scripts / entrypoint are retained and documented as a fast-rollback fallback

### Package Management (PKG)

- [ ] **PKG-01**: Root and client dependencies install via `bun install`, producing a committed `bun.lock`
- [ ] **PKG-02**: `install:all`, dev, build, and start scripts have Bun equivalents while a Node fallback path is preserved
- [ ] **PKG-03**: The client Vite build still produces a working bundle when invoked through Bun (Vite retained; bundler swap is out of scope)

### Ops / CI-CD (OPS)

- [ ] **OPS-01**: The server Dockerfile uses an `oven/bun` arm64 base image and builds successfully
- [ ] **OPS-02**: The GitHub Actions deploy pipeline uses Bun for install/build and deploys to the Oracle arm64 VPS
- [ ] **OPS-03**: The `check`, `test:brand`, and `test:stripe` scripts run under Bun
- [ ] **OPS-04**: A documented rollback path reverts to the Node image/scripts with a single change

## Future Requirements

Deferred to later milestones. Tracked but not in this roadmap.

### Client Bundler (BNDL)

- **BNDL-01**: Replace Vite with Bun's native bundler/dev server (HMR, dev proxy, Material Tailwind, `@` alias) — deferred; delivers no server RAM win and carries the most risk

### Security / Auth (carried from prior planning)

- **AUTH-V2-01**: Forgot-password flow wired up end-to-end (currently dead `href="#"`)
- **SEC-V2-01**: `tester123` server-side token-bypass guards removed from simulation endpoints
- **SEC-V2-02**: Unauthenticated mol-price and molecules endpoints secured with `authenticateToken`
- **SEC-V2-03**: CORS fail-secure when no origins configured
- **SEC-V2-04**: Helmet middleware added for missing security headers

## Out of Scope

| Feature | Reason |
|---------|--------|
| Vite→Bun bundler swap | Build-time tool; ~no server RAM/speed win, highest risk (HMR, dev proxy, Material Tailwind, `@` alias) |
| Bun migration of Python microservices | admet/gromacs-api/glioblastoma-predictor are Python/Docker, not Node |
| Rewriting app logic / new features | v2 is a runtime/toolchain migration only — product behavior stays identical |
| Removing the Node fallback | Retained through v2 for fast rollback if a dep misbehaves under Bun in prod |

## Traceability

Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MEAS-01 | Phase 4 | Complete |
| MEAS-02 | Phase 5 | Pending |
| MEAS-03 | Phase 5 | Pending |
| CMPT-01 | Phase 4 | Complete |
| CMPT-02 | Phase 4 | Complete |
| CMPT-03 | Phase 4 | Complete |
| CMPT-04 | Phase 4 | Complete |
| CMPT-05 | Phase 4 | Complete |
| CMPT-06 | Phase 4 | Complete |
| RUN-01 | Phase 5 | Pending |
| RUN-02 | Phase 5 | Pending |
| RUN-03 | Phase 5 | Pending |
| RUN-04 | Phase 5 | Pending |
| PKG-01 | Phase 6 | Pending |
| PKG-02 | Phase 6 | Pending |
| PKG-03 | Phase 6 | Pending |
| OPS-01 | Phase 7 | Pending |
| OPS-02 | Phase 7 | Pending |
| OPS-03 | Phase 7 | Pending |
| OPS-04 | Phase 7 | Pending |

**Coverage:**

- v2 requirements: 20 total
- Mapped to phases: 20 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-04*
*Last updated: 2026-06-04 — traceability filled after roadmap creation*
