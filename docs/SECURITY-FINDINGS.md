# Security Findings & Remediation

Audit of the MedSaaS server (`server/index.js` and friends). Items are grouped by
status: **what's already fixed in code**, then **open items** with severity and
concrete fix guidance.

_Last updated: 2026-06-10. Line numbers drift as the file changes — search by
symbol/route, not by number._

---

## ✅ Already fixed (in the working tree)

These were applied directly to the code. They still need to be **committed,
built, and deployed** to the box to take effect in production.

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
