---
phase: 05-server-runtime-on-bun
reviewed: 2026-06-05T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - README.md
  - package.json
  - server/index.js
  - server/package.json
  - server/test/runtime-smoke.test.mjs
  - server/test/runtime-watch-smoke.mjs
  - server/test/stripe-webhook.test.mjs
  - spike/runtime-capture.mjs
  - spike/runtime-env-check.mjs
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-05T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase migrates the API runtime from Node to Bun while keeping npm as the
script runner. The only substantive source change is `server/index.js` switching
the Stripe webhook from `stripe.webhooks.constructEvent` to
`stripe.webhooks.constructEventAsync` for Bun crypto compatibility. The remaining
changes are npm script additions (root + server `package.json`), README docs,
two new node-based smoke tests, and two Linux-only spike measurement scripts.

**Security-parity verdict on the core change: correct, no defects.** The
`constructEventAsync` call is awaited inside the existing `try`/`catch`; a
rejected promise still maps to HTTP 400 exactly as the synchronous version did.
HMAC signature verification and the 5-minute timestamp tolerance are identical
between the two Stripe SDK functions — only the crypto backend differs (async to
support Bun's WebCrypto). The smoke test (`runtime-smoke.test.mjs`) exercises
both a valid-signature 200 and a forged-signature 400 under both runtimes, and
`stripe-webhook.test.mjs` additionally covers idempotent replay. No credit-grant
or signature-bypass risk was introduced. `fulfillCheckoutSession` is unchanged
and out of scope.

No critical issues found. Findings are documentation accuracy and measurement-
tooling robustness — none affect production request handling.

## Warnings

### WR-01: README "Bun commands (default)" block mislabels production command as API-only dev

**File:** `README.md:72-78`
**Issue:** Under the heading **"Bun commands (default)"**, the comment
`# API-only development with Bun` sits directly above `npm run start:bun`. But in
root `package.json:15`, `start:bun` is `"npm run build && npm --prefix server run start:unified:bun"` — a full client build plus the production unified server, not API-only development. The actual API-only dev command (`npm run dev` / `npm run dev:bun`, which run `bun --watch index.js`) is omitted from this block entirely. The Node rollback block immediately below (`README.md:80-90`) is correct: it cleanly separates `dev:node` (API-only dev) from `start:node` (production unified). The Bun block does not mirror that structure, so a reader following the docs to start an API-only Bun dev loop will instead trigger a full production build.
**Fix:** Mirror the Node block. List the dev command under the dev comment and label the build command honestly:
```bash
# API-only development with Bun
npm run dev          # or: npm run dev:bun

# Production-style unified server with Bun (build + serve)
npm run start:bun    # or: npm run start
```

### WR-02: runtime-capture.mjs --runs validation can be bypassed with a non-numeric value

**File:** `spike/runtime-capture.mjs:94,107-111`
**Issue:** `const runs = Number(args.get("runs") || 5)`. If `--runs` is passed a
non-numeric string (e.g. `--runs all`), `Number("all")` is `NaN`. The guard at
107 is `if (!Number.isInteger(runs) || runs < 5)` — `Number.isInteger(NaN)` is
`false`, so the guard correctly throws. However the thrown message at 109
interpolates `args.get("runs") || runs`, which for an empty-string arg would read
oddly. More importantly, a fractional value like `--runs 5.5` yields a non-integer
caught by `Number.isInteger`, which is fine, but `--runs 06` parses to `6` — these
are edge behaviors a measurement operator could trip on silently. This is a
developer-run measurement script, so impact is low, but the validation message and
parsing are loose enough to mislead.
**Fix:** Parse explicitly and report the raw token: `const rawRuns = args.get("runs"); const runs = rawRuns === undefined ? 5 : Number(rawRuns);` then in the error use the raw token verbatim. Reject non-integer input with the original string, not the coerced value.

## Info

### IN-01: readRssKiB throws on any non-Linux host with an opaque procfs error

**File:** `spike/runtime-capture.mjs:175-182`
**Issue:** `readRssKiB` reads `/proc/<pid>/status`, which does not exist on macOS
or Windows. On a developer's macOS machine the capture run fails with a raw
`ENOENT ... /proc/<pid>/status` rather than a clear "this script requires Linux
procfs" message. The methodology comment (lines 9-16, 79) documents the Linux
requirement, so this is intentional, but the failure mode is unfriendly.
**Fix:** Wrap the first `readFile` in a platform check (`if (process.platform !== 'linux') throw new Error('runtime-capture requires Linux /proc; got ' + process.platform)`) emitted once at startup.

### IN-02: runtime-env-check --host value flows unsanitized into an execSync SSH command

**File:** `spike/runtime-env-check.mjs:46,89-95`
**Issue:** The `--host` argument is interpolated into `ORACLE_PROBE_CMD(host)`
which is run via `execSync` with shell semantics. A host string containing shell
metacharacters would be executed. This is a developer-operated, self-targeted
probe (the operator supplies their own SSH alias on their own machine), so it is
not a remotely reachable injection and impact is minimal. Still worth noting as a
hygiene item since the value reaches a shell.
**Fix:** Validate `--host` against an SSH-alias charset (e.g. `/^[A-Za-z0-9._-]+$/`) before building the command, or use `execFileSync('ssh', [...])` with argv to avoid the shell entirely.

### IN-03: runtime-env-check --require parsed but never enforced beyond local presence; docker not requireable

**File:** `spike/runtime-env-check.mjs:48,237-240`
**Issue:** `requireList` defaults to `bun,node,npm` and drives `blockingMissing`,
which only checks the **local** runtimes array. `docker` is probed and displayed
but cannot meaningfully gate (it is in the probe list but the default require list
omits it, and the blocking check only consults `localRuntimes`). The oracle target
never contributes to `blockingMissing` even when `--target oracle` is set, so a
missing required binary on the oracle host does not fail the script. This may be
intentional (local-gate-only), but the asymmetry is undocumented.
**Fix:** Either document that `--require` gates the local host only, or extend `blockingMissing` to consult `oracleRuntimes` when `--target oracle`.

---

_Reviewed: 2026-06-05T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
