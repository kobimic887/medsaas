# Phase 06: Package Management - Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` | config | batch | `package.json` | exact |
| `client/package.json` | config | batch | `client/package.json` | exact |
| `server/package.json` | config | batch | `server/package.json` | exact |
| `bun.lock` | config | batch | `client/package-lock.json` / `server/package-lock.json` | role-match |
| `client/bun.lock` | config | batch | `client/package-lock.json` | role-match |
| `server/bun.lock` | config | batch | `server/package-lock.json` | role-match |
| `README.md` | docs | request-response | `README.md` | exact |
| optional script/doc verification note | docs | batch | `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` | role-match |

## Pattern Assignments

### `package.json` (config, batch)

**Analog:** `package.json`

**Current root orchestration pattern** (lines 5-20):
```json
"scripts": {
  "install:all": "npm --prefix client install && npm --prefix server install",
  "predev": "node scripts/ensure-dev.mjs",
  "dev": "client/node_modules/.bin/concurrently \"npm --prefix server run dev\" \"npm --prefix client run dev\" --names \"api,web\" --prefix-colors \"green,blue\"",
  "build": "npm --prefix client run build",
  "start": "npm run build && npm --prefix server run start:unified",
  "start:api": "npm --prefix server run start",
  "start:web": "npm --prefix client run dev",
  "check": "node --check server/index.js && npm --prefix client run build",
  "test:brand": "node scripts/check-brand.mjs",
  "start:bun": "npm run build && npm --prefix server run start:unified:bun",
  "start:node": "npm run build && npm --prefix server run start:unified:node",
  "start:api:bun": "npm --prefix server run start:bun",
  "start:api:node": "npm --prefix server run start:node",
  "dev:bun": "client/node_modules/.bin/concurrently \"npm --prefix server run dev:bun\" \"npm --prefix client run dev\" --names \"api,web\" --prefix-colors \"green,blue\"",
  "dev:node": "client/node_modules/.bin/concurrently \"npm --prefix server run dev:node\" \"npm --prefix client run dev\" --names \"api,web\" --prefix-colors \"green,blue\"",
```

**Apply:** make Bun the default package runner for `install:all`, `dev`, `build`, and `start`, while retaining explicit `:node` aliases. Preserve the `predev` hook and the existing root orchestration vocabulary. Phase 6 should likely add `install:all:bun` / `install:all:node`, `build:bun` / `build:node`, and use `bun --cwd <dir> run ...` or equivalent for Bun defaults while keeping npm fallback commands exact and reproducible.

**Dev guard pattern** from `scripts/ensure-dev.mjs` (lines 9-23):
```js
if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('Created .env from .env.example');
  } else {
    console.warn('Warning: no .env or .env.example found at project root.');
  }
} else {
  const envText = fs.readFileSync(envPath, 'utf8');
  if (/VITE_API_HOSTNAME\s*=\s*(?!localhost|127\.0\.0\.1)/m.test(envText)) {
    console.warn(
      'Tip: remove VITE_API_HOSTNAME from .env for local dev — the app uses same-origin /api proxy on :5173.'
    );
  }
}
```

**Apply:** keep `predev` running through Node unless the planner intentionally scopes a Bun equivalent. This phase is package management; do not change environment validation behavior.

---

### `client/package.json` (config, batch)

**Analog:** `client/package.json`

**Vite script pattern** (lines 5-10):
```json
"type": "module",
"scripts": {
  "dev": "vite",
  "dev-vite-only": "vite",
  "build": "vite build",
  "preview": "vite preview"
},
```

**Apply:** retain Vite as the bundler for PKG-03. If aliases are added, they should invoke the same Vite commands through Bun/npm package runners, not replace Vite with Bun's bundler. `build` must still resolve to a Vite production build.

**Dependency shape** (lines 30-42):
```json
"devDependencies": {
  "@types/react": "18.2.31",
  "@types/react-dom": "18.2.14",
  "@vitejs/plugin-react": "4.1.0",
  "autoprefixer": "10.4.16",
  "concurrently": "^9.2.0",
  "postcss": "8.4.31",
  "prettier": "3.0.3",
  "prettier-plugin-tailwindcss": "0.5.6",
  "sass": "^1.89.2",
  "tailwindcss": "3.3.4",
  "vite": "4.5.0",
  "vite-plugin-node-polyfills": "^0.23.0"
}
```

**Apply:** note the current `concurrently` location. The root `dev` script currently reaches into `client/node_modules/.bin/concurrently`; planner must decide whether to keep that Bun-installed `.bin` path or promote `concurrently` to root `devDependencies`.

---

### `server/package.json` (config, batch)

**Analog:** `server/package.json`

**Phase 5 Bun-default / Node-fallback script pattern** (lines 6-19):
```json
"scripts": {
  "start": "bun index.js",
  "dev": "bun --watch index.js",
  "start:unified": "FRONTEND_DIST=../client/dist bun index.js",
  "start:bun": "bun index.js",
  "dev:bun": "bun --watch index.js",
  "start:unified:bun": "FRONTEND_DIST=../client/dist bun index.js",
  "start:node": "node index.js",
  "dev:node": "node --watch index.js",
  "start:unified:node": "FRONTEND_DIST=../client/dist node index.js",
  "import:mol-price": "node import-mol-price.js",
  "test:stripe": "node test/stripe-webhook.test.mjs",
  "test:runtime-smoke": "node test/runtime-smoke.test.mjs",
  "test:runtime-watch": "node test/runtime-watch-smoke.mjs"
}
```

**Apply:** this is the naming convention Phase 6 must mirror for package-management scripts. Do not alter the server runtime default in this phase; server already runs on Bun. Package install defaults should align with these `:bun` / `:node` aliases.

**Server dependency surface** (lines 21-40):
```json
"dependencies": {
  "@rdkit/rdkit": "^2025.3.4-1.0.0",
  "amqplib": "^0.10.9",
  "axios": "^1.13.5",
  "bcryptjs": "^3.0.2",
  "cors": "^2.8.5",
  "dotenv": "^17.0.1",
  "express": "^4.18.2",
  "form-data": "^4.0.4",
  "jsonwebtoken": "^9.0.2",
  "mongodb": "^6.17.0",
  "node-fetch": "^3.3.2",
  "nodemailer": "^7.0.5",
  "stripe": "^18.3.0",
  "swagger-jsdoc": "^6.2.8",
  "swagger-ui-express": "^5.0.1",
  "xlsx": "^0.18.5"
},
"devDependencies": {
  "mongodb-memory-server": "^11.2.0"
}
```

**Apply:** server is in Phase 6 scope by decision D-03 even though roadmap PKG-01 names root and client. Generate `server/bun.lock` and preserve `server/package-lock.json`.

---

### `bun.lock`, `client/bun.lock`, `server/bun.lock` (config, batch)

**Analog:** existing npm lockfiles: `client/package-lock.json`, `server/package-lock.json`

**Current lockfile inventory:** repository currently has `client/package-lock.json` and `server/package-lock.json`; there is no root `package-lock.json` and no `bun.lock` anywhere before this phase.

**Locked decision source** from `06-CONTEXT.md` (lines 20-25):
```markdown
- **D-01:** Keep BOTH lockfiles. `bun.lock` is committed as the default install artifact; the existing `package-lock.json` files are RETAINED so the Node fallback is an exact, reproducible `npm ci` (satisfies RUN-04's one-command rollback). Accepted cost: two lockfiles per package root that must be regenerated together when dependencies change.
- **D-02:** When deps change, regenerate both lockfiles in the same change (run `bun install` AND `npm install`/`npm ci`) so they don't drift. The planner should document this maintenance rule wherever the install scripts live.

### Migration scope
- **D-03:** Adopt `bun install` across **root + client + server** — all three package roots.
```

**Apply:** commit Bun lockfiles for all package roots in scope. Retain npm lockfiles. If the root package remains dependency-free, still satisfy PKG-01 with a root `bun.lock` if Bun emits one; do not invent a root `package-lock.json` unless the planner chooses to add root dependencies.

---

### `README.md` (docs, request-response)

**Analog:** `README.md`

**Local setup install/run docs pattern** (lines 15-55):
````markdown
Root scripts are the supported way to install, run, build, and check the app.

## Local Setup

1. Install dependencies:

   ```bash
   npm run install:all
   ```

4. Run the app in development:

   ```bash
   npm run dev
   ```

5. Build and run the production-style unified app:

   ```bash
   npm start
   ```

   The backend serves `client/dist`.
````

**Apply:** update these commands to the new Bun-default root scripts and add Node fallback commands nearby. Keep root scripts as the documented entry point.

**Fallback documentation pattern** (lines 75-97):
````markdown
**Bun commands (default):**

```bash
# API-only development on Bun (hot-reload)
npm run dev:bun
npm --prefix server run dev:bun

# Production-style unified server on Bun (builds client, then serves it)
npm run start:bun
npm --prefix server run start:unified:bun
```

**Node rollback (one-command):**

```bash
# API-only development on Node
npm run dev:node
npm --prefix server run dev:node

# Production-style unified server on Node
npm run start:node
npm --prefix server run start:unified:node
```
````

**Apply:** mirror this style for package management: Bun install/build/start defaults first, npm/Node fallback second. Include the dual-lockfile maintenance rule from D-02.

---

### optional script/doc verification note (docs, batch)

**Analog:** `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md`

**Verification report pattern** (lines 52-64):
```markdown
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
```

**Apply:** if the planner adds a Phase 6 verification note/report, use the same concise method-and-result style. For PKG-03, the relevant verification is `bun` invoking the existing Vite build and confirming the output bundle is served by the unified server.

## Shared Patterns

### Bun Default With Explicit Node/Npm Fallback
**Source:** `server/package.json` lines 6-19 and `package.json` lines 15-20  
**Apply to:** `package.json`, `client/package.json`, `server/package.json`, `README.md`

Use default script names for Bun behavior and `:node` / `:bun` aliases for explicit paths. For Phase 6, extend that convention to package management scripts: `install:all`, `dev`, `build`, and `start` should invoke Bun by default; npm/Node fallback aliases must remain one command away.

### Root Scripts Are The Public Interface
**Source:** `README.md` lines 15-55  
**Apply to:** root package scripts and documentation

Keep root scripts as the documented commands developers run. Client and server package scripts are implementation details or targeted escape hatches.

### Vite Is Retained
**Source:** `client/package.json` lines 6-10 and `06-CONTEXT.md` lines 9-12  
**Apply to:** client build/dev scripts and PKG-03 verification

Do not replace `vite` / `vite build`. Bun should be the package/script runner around the existing Vite build.

### Dual Lockfile Maintenance
**Source:** `06-CONTEXT.md` lines 20-25  
**Apply to:** all dependency changes after Phase 6

`bun.lock` becomes the default install artifact, but npm lockfiles remain for exact fallback. Any future dependency change must regenerate both Bun and npm lockfiles in the same change.

## No Analog Found

No files lack an analog. Bun lockfiles have no existing Bun analog in this repo, but npm lockfiles plus the locked Phase 6 context provide the concrete pattern: generated lockfile artifacts committed beside each package root while preserving npm lockfiles.

## Metadata

**Analog search scope:** root package files, `client/`, `server/`, `scripts/`, `README.md`, Phase 5 planning artifacts  
**Files scanned:** 12 planning/package/doc/script artifacts plus lockfile inventory  
**Pattern extraction date:** 2026-06-05
