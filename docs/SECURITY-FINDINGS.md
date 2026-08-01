# Security Findings & Remediation

Audit of the MedSaaS server (`server/index.js` and friends). Items are grouped by
status: **what's already fixed in code**, then **open items** with severity and
concrete fix guidance.

_Last updated: 2026-08-01. Line numbers drift as the file changes — search by
symbol/route, not by number._

---

## ✅ Already fixed — but ⚠ NOT currently live

These were applied to **this repo's** `server/index.js`. They were live on
`app.pyxis-discovery.com` from 2026-07-29 to 2026-07-31.

⚠ **Corrected 2026-08-01: they are not in effect right now.** The owner deliberately rolled
production back to the **original Pyxis** on 2026-07-31, which is served by `chem_beo` on
`:3000`. This repo's server runs alongside on `:5174`, loopback only. So every fix in the
table below is *written and deployed but not in the request path* until the port swap on box
day ([ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §8).

Two caveats that are not in the table:

- **`chem_beo` is serving the public site and has none of these fixes.** Its `'secret'` JWT
  hole is closed (verified by forging a token and getting `403`), but roughly **60
  unauthenticated routes are open right now** — `/api/sanitizedminimalsdf/<key>` returns real
  customer results with no token from the public internet, and `/api/generate-molecules`
  reaches the NVIDIA key. The fix is written and rehearsed at
  `deploy/chem_beo/01-fixes-and-config.patch` and is **not applied**. This is the single
  largest live exposure in the project.
- **`assertConfiguredUrlsArePublic` has exactly one call site** (`server/index.js`, the
  admin-UI `ligandServiceConfig` PATCH). The env vars that carry the box cutover —
  `TANIMOTO_API_BASE`, `SDF_CONVERTER_URL`, `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL`
  — are read straight from `process.env` and are **never validated**. That is by design
  (they are operator-set, not user-set), but do not mistake the guard for global.

| Finding | Severity | Fix applied |
|---|---|---|
| SSRF via per-company service URLs (`/api/company/ligand-service-config`) | Critical | `assertValidHttpUrl` now resolves the hostname via DNS and rejects private/loopback/link-local/unique-local/metadata addresses (incl. IPv4-mapped IPv6). PATCH call site `await`s it. |
| Scientific-services proxy had no auth | High | Mounted behind `ensureMongoConnected → authenticateToken → requireActiveUser`. |
| NoSQL `$regex` injection / ReDoS on catalog search | High | `escapeRegExp(String(...))` applied on `/api/mol-price`, `/api/mol-price/search`, `/api/molecules`, `/api/molecules/search/smiles`. |
| Open email relay (`/api/send-email`) | High | Recipient is now server-controlled (`CONTACT_RECIPIENT` → `EMAIL_USER`); client-supplied address is only echoed in the body. |
| `tester123` token-bypass backdoor | Medium | Removed; all users decrement tokens. |
| Cross-tenant user enumeration (`/api/test-user/:username`) | Medium | Scoped lookup to the caller's `companyId`. |
| CORS allow-all when allowlist empty | Medium | Permissive only when `NODE_ENV !== 'production'`. |
| Path traversal in GROMACS proxy params | Medium (defense-in-depth) | `:workflow` / `:jobId` validated + `encodeURIComponent`'d. |
| `diff_dock.sh` shared output file + unvalidated args (was open item #3) | High | Per-request `mkdtemp` work dir passed to the script (no more shared `output.json`); `protein`/`ligand` validated (`^[A-Za-z0-9]{4}$` / `^[A-Za-z0-9]{1,8}$`); error responses no longer leak `stderr`/details. |
| `simulation_logs` stored full decoded JWT (was open item #5) | Medium | `user: req.user` field dropped from both `/api/simulation` inserts; discrete `username`/`companyId`/`companyName` columns remain. |
| Stale authorization on `authenticateToken`-only routes (was open item #7) | Medium | `requireActiveUser` added to every formerly token-only route (simulation, simulation-logs, shop, sanitized*, catalog proxies, api4, Asinex, Tanimoto, projects, activity, admet) — DB is now the per-request source of truth for active/role/tenant. |

### Residual risk on the SSRF fix — read this
The DNS check runs **at configuration time** (when an admin saves the URL). It does
**not** re-check at fetch time, so a **DNS-rebinding** attacker could register a
hostname that resolves to a public IP when saved and to `169.254.169.254` (or an
internal host) a moment later when the server fetches it. See the "DNS rebinding"
item below for the durable fix.

---

## 🔴 Open — architectural / higher-effort

### A1. ADMET callback writes to any simulation, unscoped *(added 2026-08-01, verified)*

`PUT /api/simulation/:simulationKey/admet` (`server/index.js:6608`) authenticates with a
shared secret (`requireAdmetCallbackAuth`, `:1719` — a plain string compare on the
`x-admet-secret` header) and then reads and writes **by `simulationKey` alone**:

```js
const existingSimulation = await simulationLogs.findOne({ simulationKey });        // :6638
const updateResult = await simulationLogs.updateOne({ simulationKey }, { ... });   // :6654
```

No `companyId`, no `username`, no tenant filter — the only route in this file that touches
`simulation_logs` without one. Every read path beside it (`/api/sanitizedpdb/:key` at `:3521`,
`/api/sanitizedminimalsdf/:key`) correctly does `{ simulationKey, ...tenantFilter }`.

**Severity: medium, not critical.** Exploiting it needs `ADMET_CALLBACK_SECRET` *and* a
12-character `simulationKey`. Anyone holding the secret can overwrite the `admet` field of any
simulation in the database, for any company, poisoning results silently — the field is
displayed without provenance. It is a defence-in-depth gap rather than an open door, and the
platform is single-tenant today, so the cross-company aspect is currently theoretical.

**Fix:** the callback has no `req.user`, so it cannot use `buildTenantFilter`. Either persist
`companyId` on the simulation and require the worker to echo it, or issue the worker a
short-lived per-job token at enqueue time and scope the update to that job. Also use
`crypto.timingSafeEqual` for the secret compare.

### A2. `email` is globally unique, which is a multi-tenancy limit and a small info leak *(added 2026-08-01, verified)*

`server/index.js:1108` creates `{ email: 1 }` as a **globally unique** index, and the invite
path checks for collisions across every tenant:

```js
const existing = await usersCollection.findOne({ $or: [{ username }, { email }] });   // :4098
if (existing) return res.status(409).json({ error: 'User with this username or email already exists' });
```

Two consequences. One person cannot hold accounts at two companies. And a company admin
inviting `alice@example.com` gets a `409` that tells them the address exists *somewhere* on
the platform — a cross-tenant existence oracle, cheap to enumerate through an authenticated
admin session.

**Severity: low today, blocking later.** The product is deliberately single-tenant
([PYXIS-ONLY.md](./PYXIS-ONLY.md)), so neither consequence bites right now. It becomes a real
constraint the moment a second company is onboarded, and the fix is a migration, so it is
worth knowing about before that day rather than during it.

**Fix:** replace the global unique index with a compound `{ companyId: 1, email: 1 }` unique
index and scope the duplicate check to `req.user.companyId`. Note `/api/verify-email`
(`:2279`) does `updateOne({ email }, ...)` unscoped, which is safe *only because* email is
globally unique — it must be fixed in the same change or it will verify the wrong user.

### A3. `/api/simulation-logs` is unbounded and unindexed *(added 2026-08-01, verified)*

```js
const logs = await simulationLogs.find(tenantFilter).sort({ timestamp: -1 }).toArray();  // :3514
```

No `.limit()`, no pagination, and the whole result is serialised into one response. Worse,
the index block at `:1106-1118` creates indexes for `users`, `companies`, `audit_logs` and
`billing_events` but **nothing on `simulation_logs`** except the unique `simulationKey` index
from `ensureAdmetQueueIndexes`. So this is a collection scan followed by an in-memory sort,
and each document carries a full docking result — receptor PDB plus poses, tens to hundreds of
KB each.

**Severity: low now, degrades badly.** Production holds single-digit simulation logs today, so
nothing is visibly slow. At a few thousand rows this becomes a multi-hundred-MB response that
a page refresh can repeat.

**Fix:** add `simulationLogs.createIndex({ companyId: 1, timestamp: -1 })` and
`{ username: 1, timestamp: -1 }` to the startup block, add `.limit()` with cursor pagination,
and project away `result` — the list view does not render pose data.


### 1. Anyone can self-register as `owner` (the privilege model behind the SSRF)
**Where:** `/api/signup` (`server/index.js`, `existingCompanyUsers === 0 ? 'owner'`).
**Why it matters:** the company is keyed by a slug derived from the name the user
types, and the first user of a "new" company becomes `owner` automatically. So any
anonymous visitor can mint an owner account in seconds. This is what turned the SSRF
from "an admin can misconfigure their own tenant" into "the public internet can."
It also means every owner-gated feature (branding, usage policy, member management,
ligand-service config) is reachable by anyone willing to register.

**How to fix (pick one, roughly increasing effort):**
- **Email verification before privileged actions.** Re-enable verification (it's
  disabled in non-prod — `verified: true` is hard-set at signup) and require a
  verified email before any `requireCompanyAdmin` route. Raises the cost of minting
  throwaway owners.
- **Separate "create account" from "create company."** New signups join as
  `member` of a pending/unclaimed company; promoting to `owner` requires an invite
  token or manual approval.
- **Domain-based tenancy.** Bind a company to a verified email domain; the first
  user from `@acme.com` owns the `acme.com` tenant, others auto-join as members.
  Random company names can't grant ownership.

### 2. DNS rebinding on outbound proxy fetches
**Where:** every `fetch()` that uses a company-configured URL — `/api/exact/:smiles`,
`/api/id/:id_number`, `/api/shop`, `/api/api4/*`, `/api/simulation` (docking),
`/api/diffdock/generate`.
**Why it matters:** the config-time DNS check (above) can be bypassed by an attacker
who controls DNS for their hostname and flips the answer to an internal IP between
"save" and "fetch."

**How to fix:**
- Add a `safeFetch(url, opts)` wrapper that, immediately before connecting,
  resolves the host, asserts every resolved address is public (reuse
  `isDisallowedAddress`), and pins the connection to that validated IP (e.g. via a
  custom `lookup`/agent, or libraries like `ssrf-req-filter` / `request-filtering-agent`).
- Route all company-config-driven `fetch()` calls through it.
- Strongly consider an **allowlist of permitted upstream hosts** instead of an
  arbitrary URL field — it sidesteps rebinding entirely. If per-company URLs aren't
  a real product requirement, the simplest fix is to drop the override and use a
  fixed, server-configured upstream.

### 3. `diff_dock.sh` — shared output file + latent command injection
**✅ Fixed (2026-06-10)** — per-request `mkdtemp` work dir, validated inputs, no leaked stderr. See "Already fixed" table.

### 4. Internal error messages leaked to clients
**Where:** nearly every `catch` block: `res.status(500).json({ error: error.message })`,
some also return `details` / `stderr`.
**Why it matters:** leaks stack-ish internals, upstream URLs, and DB errors that aid
an attacker.
**How to fix:** return a generic message + a correlation id to the client; log the
real error server-side. A small helper:
```js
function fail(res, status, publicMsg, err) {
  const id = crypto.randomUUID();
  console.error(`[${id}]`, err);
  return res.status(status).json({ error: publicMsg, ref: id });
}
```
Then sweep the handlers. Gate any verbose detail behind `NODE_ENV !== 'production'`.

### 5. `simulation_logs` stores the full decoded JWT
**✅ Fixed (2026-06-10)** — `user: req.user` dropped from both inserts. See "Already fixed" table.

### 6. Temporary password returned in API response + emailed in plaintext
**Where:** `/api/company/members` (create) returns `temporaryPassword` in JSON and
emails it.
**Why it matters:** plaintext credential distribution; the secret also lands in
browser history / network logs / proxies.
**How to fix:** prefer an invite **link with a single-use, time-limited token**
(you already have the JWT machinery used by password-reset). The user sets their own
password on first use; the server never transmits a usable password.

### 7. Stale authorization on `authenticateToken`-only routes
**✅ Fixed (2026-06-10)** — `requireActiveUser` added to all formerly token-only routes. See "Already fixed" table.

### 8. Catalog/pricing endpoints are fully public
**Where:** `/api/mol-price*`, `/api/molecules*` have only `ensureMongoConnected`.
**Why it matters:** the entire pricing DB is scrapeable anonymously. May be intended
(public catalog) — confirm. The ReDoS vector on these is already fixed (#regex).
**How to fix (if not intended public):** add `authenticateToken`, and consider
pagination caps + a per-IP rate limit on these read endpoints.

---

## Notes / verification

- After deploying, re-verify the SSRF fix: as a fresh owner, `PATCH
  /api/company/ligand-service-config` with `catalogApiBase=http://169.254.169.254/`
  should return `400` ("must point to a public host"), and
  `http://127.0.0.1:27017` likewise.
- Verify the scientific proxy now returns `401` without a token:
  `curl -s -o /dev/null -w '%{http_code}' http://<host>:3000/api/gromacs/info`.
- Verify the contact form still works and that a posted `recipientEmail` is ignored
  as the destination (mail arrives at `CONTACT_RECIPIENT`).
- New env var: set **`CONTACT_RECIPIENT`** on the box (`.env`) — otherwise the
  contact form falls back to `EMAIL_USER`.
