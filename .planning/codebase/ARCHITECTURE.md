<!-- refreshed: 2026-06-14 -->
# Architecture

**Analysis Date:** 2026-06-14

## System Overview

```text
┌────────────────────────────────────────────────────────────────┐
│              User-Facing Applications                           │
├───────────────────────┬────────────────┬──────────────────────┤
│   React Dashboard     │  Auth Pages    │   Marketing Site     │
│  `client/src/pages/`  │  `pages/auth/` │  `pages/main/`       │
│   Material Tailwind   │                │                      │
└────────────┬──────────┴────────┬───────┴──────────────┬────────┘
             │                   │                      │
             └───────────────────┼──────────────────────┘
                   Vite Proxy    │   HTTP/REST API
                   (dev mode)    │   (Compat w/ Bun)
                                 ▼
            ┌────────────────────────────────────────┐
            │   Express.js API Server (single file)  │
            │   `server/index.js` (ESM)              │
            │                                        │
            │  • Auth & middleware chain             │
            │  • Simulation token consumption        │
            │  • Stripe billing integration          │
            │  • NVIDIA API proxies                  │
            │  • Company multi-tenancy               │
            └────────────┬─────────────┬─────────────┘
                         │             │
         ┌───────────────┘             └────────────────┐
         │                                              │
         ▼                                              ▼
    ┌──────────────────┐                        ┌──────────────────┐
    │    MongoDB       │                        │ Scientific Routes│
    │   Collections    │                        │ `server/routes/` │
    │ (users, cos,     │                        │                  │
    │  audit_logs,     │                        │ Proxies to:      │
    │  billing_events) │                        │ • GROMACS API    │
    └──────────────────┘                        │ • Glioblastoma   │
                                                │ • External APIs  │
                                                └──────────────────┘
         ┌────────────────────────────────────────────┐
         │   Optional Microservices (Docker)          │
         ├────────────────────────────────────────────┤
         │ • `services/admet/` — ADMET worker         │
         │ • `services/gromacs-api/` — MD sim server  │
         │ • `services/glioblastoma-predictor/`       │
         └────────────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────────┐
         │   External/NVIDIA APIs                 │
         │ • MolMIM (generate molecules)          │
         │ • OpenFold3 (protein folding)          │
         │ • Stripe (billing)                     │
         │ • Tanimoto (similarity search)         │
         │ • Asinex (ligand catalog)              │
         └────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| React Dashboard | UI views, routing, form handling, local auth state | `client/src/` |
| Auth Context | Token + user_info storage, login/logout/role helpers | `client/src/context/auth.jsx` |
| Routes Config | Page definitions, menu structure, admin-only gating | `client/src/routes.jsx` |
| Express API | All HTTP endpoints, auth, middleware, data models | `server/index.js` |
| Scientific Router | Proxy to GROMACS, Glioblastoma, health checks | `server/routes/scientificServices.js` |
| Config/Branding | Company name → label, platform fallback, email branding | `server/config/branding.js` |
| Email Utils | HTML templates, Titan email sender | `server/utils/emailTemplates.js`, `emailService.js` |
| Microservices | ADMET prediction, MD simulations, cancer prediction | `services/*` |
| RabbitMQ Utils | Task queue for async ADMET jobs | `server/utils/rabbitMQUtils.js` |

## Pattern Overview

**Overall:** Multi-tenant SaaS with company-scoped users, token-based simulation economy, and role-based access control.

**Key Characteristics:**
- Single-tenant-per-company model: every user belongs to exactly one company.
- JWT session tokens (7-day default) stored in browser localStorage.
- Atomic simulation-token consumption via MongoDB updateOne (no race conditions).
- Idempotent Stripe webhook fulfillment (checks if already fulfilled).
- Middleware chain validates auth, user account status, company status, and token availability before simulation execution.
- NVIDIA API proxying for molecule generation and protein folding (requires API keys).
- Multi-role system: owner (first user), admin, member with gradated access.

## Layers

**Client Presentation Layer:**
- Purpose: React 18 dashboard + marketing site, Material Tailwind styling, Heroicons
- Location: `client/src/pages/`, `client/src/components/`, `client/src/context/`
- Contains: Page components, forms, context providers, layout wrappers
- Depends on: AuthContext, API_CONFIG (constants for URL building)
- Used by: Browser users

**API Gateway & Middleware (Express):**
- Purpose: HTTP request routing, authentication, authorization, rate limiting, audit logging
- Location: `server/index.js` (top-level middleware, auth functions, rate limiters ~lines 109–193)
- Contains: Middleware chain, session validation, role checking
- Depends on: MongoDB collections (users, companies, audit_logs)
- Used by: All protected and public endpoints

**Token Economy Layer:**
- Purpose: Consume simulation tokens atomically, enforce quota caps
- Location: `server/index.js` — `consumeSimulationToken()` function (~line 1227)
- Contains: UpdateOne with $inc and $gt checks, token deduction logic
- Depends on: usersCollection
- Used by: Simulation endpoints (MolMIM, OpenFold3, docking, etc.)

**Multi-Tenancy & Authorization:**
- Purpose: Company-scoped data isolation, role verification, active status checks
- Location: `server/index.js` — `requireActiveUser()`, `requireCompanyAdmin()`, `buildTenantFilter()` (~lines 834, 1166, 1192)
- Contains: Company lookups, role assertions, soft-delete (active: false) checks
- Depends on: companiesCollection, usersCollection
- Used by: All protected endpoints

**Billing & Stripe Integration:**
- Purpose: Webhook fulfillment, credit granting, plan catalog
- Location: `server/index.js` — `fulfillCheckoutSession()` (~line 1289), `/create-checkout-session-onetime` endpoint
- Contains: Stripe webhook verification, idempotent credit application via billingEventsCollection
- Depends on: billingEventsCollection, usersCollection, stripe client
- Used by: POST `/stripe/webhook`, POST `/create-checkout-session-onetime`

**Scientific Service Proxy Layer:**
- Purpose: Route simulation requests to external APIs or internal microservices
- Location: `server/routes/scientificServices.js`, `server/index.js` (API endpoints ~226–300)
- Contains: NVIDIA API forwarding (MolMIM, OpenFold3), Asinex catalog, DiffDock, Tanimoto, internal GROMACS/Glioblastoma proxies
- Depends on: axios, node-fetch, NVIDIA API keys, Asinex config
- Used by: Simulation feature endpoints

**Data Persistence:**
- Purpose: Store users, companies, audit logs, billing events, simulation cache
- Location: MongoDB (connection ~line 712, initialization ~line 720)
- Collections: `users`, `companies`, `audit_logs`, `billing_events`, `simulation_logs`, `projects`, `mol_price`
- Indexes: username, email, companyId, slug, stripeSessionId, audit timestamps
- Used by: All backend logic

## Data Flow

### Primary Request Path (Protected Simulation)

1. **Client Request** (`client/src/pages/dashboard/simulation.jsx` or similar)
   - User form submission → API call via `API_CONFIG.buildApiUrl()`
   - Bearer token in Authorization header

2. **ensureMongoConnected** (`server/index.js:772`)
   - Validate MongoDB connection, re-connect if down
   - Initialize collections (usersCollection, companiesCollection, etc.)

3. **authenticateToken** (`server/index.js:2591`)
   - Extract JWT from Authorization header
   - Verify signature against JWT_SECRET
   - If invalid/expired: return 401 (client auto-logs out on 401)
   - Attach decoded payload to `req.user`

4. **requireActiveUser** (`server/index.js:1192`)
   - Look up user in DB by username ± companyId
   - Check user.active !== false
   - Check company (if multi-tenant) is not disabled
   - Attach role and full user doc to req.user, req.dbUser

5. **consumeSimulationToken(feature)** (`server/index.js:1227`)
   - Atomic MongoDB updateOne: decrement simulationTokens by 1, check $gt: 0
   - If matchedCount === 0: return 403 "No simulation tokens left"
   - Log audit event `usage.token.consume`
   - Proceed if successful

6. **Simulation Handler** (e.g., `/api/generate-molecules` ~line 226)
   - Call NVIDIA MolMIM API with request body
   - Catch errors, return response or 500
   - Optionally log simulation_logs record

7. **Response** → Client receives result or error

**State Management:**
- User session state: browser localStorage (user_info, access_token)
- Company state: user.companyId from JWT, verified at each request
- Simulation tokens: atomic decrements prevent double-spend
- Audit trail: every auth/admin/billing action logged to audit_logs

### Billing & Stripe Flow

1. **User initiates checkout** (PaidPlans page)
   - POST `/create-checkout-session-onetime` with plan name
   - Middleware: checkoutRateLimit → ensureMongoConnected → authenticateToken → requireActiveUser

2. **Server creates Stripe checkout session** (`server/index.js:1425`)
   - Embed metadata: `{ purchaseType: 'plan_tokens', plan, username, companyId, credits }`
   - Return session ID to client

3. **Client redirects to Stripe** → User completes payment

4. **Stripe webhook** (`server/index.js:109`)
   - POST `/stripe/webhook` with signed event payload
   - Verify signature against STRIPE_WEBHOOK_SECRET
   - If event.type === 'checkout.session.completed':

5. **fulfillCheckoutSession** (`server/index.js:1289`)
   - Find existing billingEventsCollection record by stripeSessionId
   - If already fulfilled (idempotent): return early
   - If payment_status !== 'paid': mark as 'ignored_unpaid', skip credit grant
   - Otherwise: updateOne usersCollection to increment simulationTokens by credits
   - Record billing_event as 'fulfilled'

6. **Client detects token refresh** → Next simulation consumption succeeds

### Secondary Flow: Company Admin Invites

1. User invites new team member (CompanyAdmin page)
2. generateInviteEmailHTML template → Titan email sender
3. Invite email includes accept link + temporary password
4. New user accepts → account created with role 'member'
5. Audit log records: `invite.sent`, then `invite.accepted`

## Key Abstractions

**User (in JWT payload):**
- `username`: unique identifier
- `companyId`: if multi-tenant, links to companies collection
- `companyName`: display name (company.name or fallback)
- `role`: 'owner', 'admin', or 'member'
- `iat`, `exp`: token issued-at, expiration timestamps
- Purpose: Identifies session owner, enables role checks, enables tenant routing

Examples: `client/src/context/auth.jsx:6–14`, `server/index.js:2600`

**Company (in companies collection):**
- `_id`: MongoDB ObjectId
- `companyId`: string (set to _id.toString() on create)
- `name`: display name
- `slug`: URL-safe identifier (from toCompanySlug)
- `active`: boolean (soft-delete via false)
- `branding`: color palette, logo URL, email customization
- `usagePolicy`: monthlySimulationCap, others
- `monthlyUsage`: { simulationsRun, [monthKey]: { ... } }
- `ligandServiceConfig`: per-company Asinex catalog/docking overrides
- Purpose: Multi-tenant scoping, billing controls, branding

**Simulation Token Economy:**
- `simulationTokens` in users collection: atomic counter
- `consumeSimulationToken(feature)` middleware: $inc -1 with $gt: 0 check
- PLAN_CATALOG: frozen object mapping plan names to credits and price
- `billingEventsCollection`: idempotent fulfillment log
- Purpose: Consume credits on simulation, grant via Stripe webhook (never frontend)

**Audit Log:**
- `action`: e.g., 'invite.sent', 'usage.token.consume', 'simulation.cache_hit'
- `actorUsername`, `targetUsername`, `companyId`
- `status`: 'success', 'failure'
- `timestamp`: ISO string
- Purpose: Compliance, debugging, user activity tracking

## Entry Points

**Frontend (Vite + React 18):**
- Location: `client/src/index.jsx` (implied, compiled by Vite)
- Triggers: User navigates to http://localhost:5173 (dev) or built frontend URL (prod)
- Responsibilities: Render routes, authenticate on mount, proxy API calls

**API Server:**
- Location: `server/index.js` (ESM, runs via `bun --cwd=server run dev:bun` or `node --watch index.js`)
- Triggers: HTTP requests on :3000
- Responsibilities: Route requests, enforce middleware chain, proxy to external services

**Stripe Webhook:**
- Location: `server/index.js:109` (POST `/stripe/webhook`)
- Triggers: Stripe event delivery (checkout.session.completed, etc.)
- Responsibilities: Verify signature, fulfill purchase (grant credits)

**CLI Scripts:**
- `scripts/ensure-dev.mjs`: Pre-dev checks
- `scripts/check-brand.mjs`: Verify branding config

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. RabbitMQ (optional) offloads async ADMET tasks to separate workers.
- **Global state:** `usersCollection`, `companiesCollection`, `auditLogsCollection`, `billingEventsCollection` are module-level references initialized on startup. Express app (`const app`) is also module-level. Rate limiters (authRateLimit, checkoutRateLimit) are in-memory maps.
- **Circular imports:** None observed; imports follow client → context → pages, server is monolithic.
- **Database indexes:** username, email (unique), companyId, stripeSessionId (unique, sparse). Missing indexes may cause slow queries on large audit_logs.
- **Scaling limits:** Single Express instance; no clustering. In-memory rate limiters are not shared across processes (would need Redis for multi-instance). Token consumption is atomic via MongoDB, so distributed scaling is possible if load-balanced.
- **Timezone:** All timestamps are ISO strings in UTC (new Date().toISOString()).

## Anti-Patterns

### Loose Multi-Tenancy Scoping

**What happens:** Endpoints use `buildTenantFilter()` to scope queries, but it's easy to forget to apply the filter when reading/writing.

**Why it's wrong:** A member from Company A could accidentally query Company B's data if a developer forgets to add the filter.

**Do this instead:** Always apply `buildTenantFilter(req.user)` to queries; consider wrapping collection methods to enforce it. See `server/index.js:834` for the pattern.

### Stripe Webhook Signature Validation Skipped

**What happens:** STRIPE_WEBHOOK_SECRET defaults to empty string if not configured, and the endpoint logs a warning but still processes requests.

**Why it's wrong:** In production, an unconfigured secret means any attacker can POST a fake webhook to grant credits.

**Do this instead:** Enforce STRIPE_WEBHOOK_SECRET in environment validation (similar to JWT_SECRET at `server/index.js:47–54`). Fail startup if not set.

### Rate Limiter as In-Memory Map

**What happens:** authRateLimit, checkoutRateLimit are Map objects that grow unbounded and are lost on restart.

**Why it's wrong:** Doesn't scale to multiple server instances; memory leaks if users spam from many IPs.

**Do this instead:** Use Redis-based rate limiting (e.g., express-rate-limit with store) for production deployments.

### Token Consumption Without Simulation Logging

**What happens:** consumeSimulationToken decrementes the count but doesn't record what was simulated or the result.

**Why it's wrong:** Audit trail is broken; can't tell which features consumed tokens or correlate with failures.

**Do this instead:** Log each consumption to simulation_logs with feature name and result (success/error). Pattern exists at `server/index.js:2663–2670` for cache hits.

## Error Handling

**Strategy:** RESTful status codes (401 for dead sessions, 403 for authz/quota, 400 for validation, 500 for server error).

**Patterns:**

- **Authentication failures (401):** Missing/invalid/expired JWT. Triggers client auto-logout (see `client/src/context/auth.jsx`).
- **Authorization failures (403):** Valid JWT but user is disabled, company is disabled, role is insufficient, or token quota exhausted.
- **Validation errors (400):** Missing required fields, invalid enum values.
- **Upstream service errors:** Forward 502 for unavailable external services (see `server/routes/scientificServices.js:29` — maps upstream 401 to 502 to avoid triggering client logout).
- **Database errors (500):** MongoDB connection failures, query timeouts. Retry once in ensureMongoConnected middleware.

## Cross-Cutting Concerns

**Logging:**
- Console.error/log in server; no structured logging library.
- Stripe errors logged with full error object.
- MongoDB connection issues logged with redacted credentials.
- TODO: Migrate to winston or pino for production observability.

**Validation:**
- Passwords: regex check at signup, password change, invite accept (`server/index.js:96`).
- Email: required, must be unique per company (or globally if no company).
- Company names: normalized (trim, collapse spaces) before slug generation.
- URLs: DNS resolution check via assertValidHttpUrl for branding URLs.
- Stripe webhook payloads: Verify signature before processing.

**Authentication:**
- JWT with HS256 (symmetric key). Sessions are 7 days by default (JWT_EXPIRES_IN).
- No refresh token mechanism; client must re-login after expiration.
- Tokens stored in browser localStorage (vulnerable to XSS; consider httpOnly in future).

---

*Architecture analysis: 2026-06-14*
