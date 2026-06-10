# Security Findings & Remediation

Audit of the MedSaaS server (`server/index.js` and friends). Items are grouped by
status: **what's already fixed in code**, then **open items** with severity and
concrete fix guidance.

_Last updated: 2026-06-09. Line numbers drift as the file changes — search by
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
**Where:** `/api/diffdock/generate_file` → `execFile('./diff_dock.sh', [protein, ligand])`,
which writes/reads a single `output.json` in the process CWD.
**Why it matters:**
- **Race / cross-user data leak:** concurrent requests clobber the same
  `output.json`; user A can receive user B's docking result.
- **Latent injection:** the current script hardcodes 8G43/ZU6 and ignores `$1`/`$2`,
  so there's no injection *today* — but `protein`/`ligand` are unvalidated user
  input, and the moment the script starts using its args inside a shell, it's a
  command-injection hole.

**How to fix:**
- Write to a unique per-request path (`mkdtemp`) and read that back; never a shared
  filename.
- Validate `protein` (PDB ID: `^[A-Za-z0-9]{4}$`) and `ligand` before use.
- Keep `execFile` with an args array (no shell). If the script must use the args,
  ensure it quotes them and never passes them to `eval`/`sh -c`.
- Consider replacing the shell-out with the in-process DiffDock path that
  `/api/diffdock/generate` already uses.

---

## 🟠 Open — medium / lower effort

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
**Where:** both `/api/simulation` handlers insert `user: req.user` alongside the
already-stored `username`/`companyId`/`companyName`.
**Why it matters:** persists email/PII (and token claims) into a collection that
doesn't need them.
**How to fix:** drop the `user: req.user` field; the discrete columns already cover
tenancy/filtering. If you need the actor, store just `username`.

### 6. Temporary password returned in API response + emailed in plaintext
**Where:** `/api/company/members` (create) returns `temporaryPassword` in JSON and
emails it.
**Why it matters:** plaintext credential distribution; the secret also lands in
browser history / network logs / proxies.
**How to fix:** prefer an invite **link with a single-use, time-limited token**
(you already have the JWT machinery used by password-reset). The user sets their own
password on first use; the server never transmits a usable password.

### 7. Stale authorization on `authenticateToken`-only routes
**Where:** routes guarded by `authenticateToken` but **not** `requireActiveUser`
(e.g. `/api/simulation`, `/api/simulation-logs`, Asinex proxies) trust
`companyId`/`role` from the 7-day JWT.
**Why it matters:** a disabled user (or one removed from a company / demoted) keeps
read access until the token expires — up to 7 days.
**How to fix:**
- Add `requireActiveUser` to data-bearing routes so the DB is the source of truth
  for active/role/tenant on each request (it already re-reads the user).
- Optionally shorten `JWT_EXPIRES_IN` and add a refresh flow, or add a
  `tokenVersion`/`passwordChangedAt` check to invalidate old tokens on
  disable/password-change.

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
