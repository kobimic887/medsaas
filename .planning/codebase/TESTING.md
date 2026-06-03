# Testing

_Generated: 2026-06-03_

## Test Coverage

**There are no tests in this codebase.** No test files (`*.test.*` or `*.spec.*`) were found anywhere in the repository (excluding `node_modules`). The `find` command returned zero results.

No test runner, test framework, or assertion library is installed in either `client/package.json` or `server/package.json`. The root `package.json` has no `test` script.

## Test Framework

**None installed.**

- No Jest, Vitest, Mocha, or any other test runner
- No `@testing-library/react`, Enzyme, Cypress, Playwright, or similar
- No assertion libraries (Chai, expect, etc.)
- `prettier` is installed as a devDependency in `client/` but only for code formatting, not testing

## Test Files

**None exist.** The `find` scan across the entire repository found zero files matching `*.test.*` or `*.spec.*` patterns.

## What Is Tested

Nothing has automated test coverage.

## What Is Not Tested

Everything. Notable untested areas include:

- **Auth flows:** `client/src/context/auth.jsx` — login, logout, token persistence, `isAdmin()`, `isLoggedIn()`
- **Server middleware:** `authenticateToken`, `requireActiveUser`, `consumeSimulationToken`, `requireCompanyAdmin`, `ensureMongoConnected` — all untested
- **Billing logic:** `fulfillCheckoutSession` in `server/index.js` — idempotent credit grant logic is untested
- **Password policy validation:** The regex `PASSWORD_POLICY` applied at signup, invite accept, and password change is untested
- **Rate limiters:** Custom in-memory `createRateLimiter` function in `server/index.js` is untested
- **API route handlers:** All 50+ Express routes in `server/index.js` have no integration or unit tests
- **Client components:** All 15+ dashboard pages, all widget components, all layout components — no component tests
- **Utility functions:** `client/src/utils/api.js`, `client/src/utils/constants.js`, `client/src/config/branding.js`, `server/config/branding.js` — untested
- **Multi-tenancy filter:** `buildTenantFilter`, `normalizeCompanyName`, `toCompanySlug` in `server/index.js` — untested
- **Scientific service proxies:** `server/routes/scientificServices.js` — untested

## How to Run Tests

No test command exists. Running `npm test` from the root will fail or produce no output.

## Notes

**The absence of tests is the single largest quality risk in this codebase.** The server's core business logic — authentication, billing, token consumption, multi-tenancy — lives in a single 5,821-line file (`server/index.js`) with no test harness at all. A regression in any of these areas would only be discovered manually.

**The `npm run check` script** (`node --check server/index.js && npm --prefix client run build`) provides only syntax validation (not execution) on the server and a build compile-check on the client. This is the closest thing to automated quality gates currently in place.

**Recommended starting points if adding tests:**
- Server: Vitest or Jest + Supertest for Express route integration tests against a test MongoDB instance
- Client: Vitest + `@testing-library/react` for component and hook unit tests
- E2E: Playwright for critical flows (sign in, billing checkout, simulation token consumption)
