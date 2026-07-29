# Patches for `chem_beo`

`chem_beo` (`eitangenis/chem_beo`, running on 83 as `/root/chem_beo`) is the production API.
**It stays the API through arrival day** — [BOX-ARCHITECTURE.md](../../docs/BOX-ARCHITECTURE.md)
§2. Replacing it with this repo's server is a separate release with no deadline, weeks later
(§3 there, ARRIVAL-RUNBOOK Phase 5). **This patch is the prerequisite for arrival day**: without
it, every service address in production is a hardcoded string literal and there is no cutover
and no rollback. The goal is
**1:1 with what `app.pyxis-discovery.com` does today, plus the bugs fixed and the compute moved
to the box.** These patches are that work, prepared ahead of arrival day so the maintenance
window is short.

They live here rather than in `chem_beo` because this repo is where the migration is planned
and reviewed. **Apply them as a real commit in `chem_beo`** — do not run the product from a
patch file.

```bash
cd /path/to/chem_beo
git checkout -b box-migration
git apply --check ../medsaas/deploy/chem_beo/01-fixes-and-config.patch   # verify first
git apply         ../medsaas/deploy/chem_beo/01-fixes-and-config.patch
node --check index.js
```

Verified to apply cleanly against `index.js` as deployed on 83 at 2026-07-28
(4,358 lines, 73 routes). If `chem_beo` has moved on since, re-generate rather than forcing.

---

## `01-fixes-and-config.patch`

102 insertions, 45 deletions, one file. Four groups of change, each independent of the box.

### 1. Service addresses become environment variables

Every backend address was a hardcoded string literal, so moving a service meant editing source
on a live production server. Now they are env vars **defaulting to the current values** —
nothing changes until something is set.

| Variable | Default (today's behaviour) |
|---|---|
| `DOCKING_API_URL` | `https://services.asinex.com:8000/docking` |
| `DIFFDOCK_API_URL` | `https://services.asinex.com:58000/molecular-docking/diffdock/generate` |
| `STOCK_API_URL` | `https://stock.asinex.com:5443/api/Shop` |
| `ASINEX_CATALOG_BASE` | `http://dev.asinex.com:58181` |
| `TANIMOTO_API_BASE` | `http://151.145.91.17:8000` (Oracle — 8 call sites) |

**This is what makes arrival day short.** Cutting docking over to the box becomes
`DOCKING_API_URL=http://<box>:8000/docking` and a restart. Rolling back is unsetting it.
Moving Tanimoto off Oracle is one variable.

### 2. Credits: the charge is atomic, and refunded when the work fails

Two bugs, both live:

- **The balance was read and then written separately.** Two concurrent requests on one
  remaining credit both passed the read, so the balance could go negative.
- **The credit was taken before the docking call, with no way back.** Every Asinex outage
  billed users for docks that never ran — the exact failure the box exists to eliminate.

Adds `chargeSimulationCredit()` (balance test inside the update filter, so it is atomic) and
`refundSimulationCredit()`, wired into both `/api/simulation` handlers.

Also: the response status was never checked, so a non-2xx **error body from the docking service
was stored in `simulation_logs` as a result and served from the cache forever after.** Now a
non-2xx throws, which refunds the credit and returns 502.

Incidental find, fixed by the rewrite: the demo-account exemption tested `userDoc.name`, but the
field is `username`, so it has never fired.

### 3. Routes that must not be open once the box exists

`chem_beo` has 7 of 73 routes behind `authenticateToken`, on a host with `ufw` inactive. Most of
that is harmless — but these reach something that costs money or holds data:

| Route | Now |
|---|---|
| `POST /api/generate-molecules` | authenticated. **This is the NVIDIA rate-limit fix** — the endpoint was open to the internet, so anyone could spend the quota |
| `POST /api/diffdock/generate` | authenticated. Open, this is free docking — and once it points at the box, free **GPU** |
| `POST /tanimoto/v1/upload` | authenticated |
| `DELETE /tanimoto/v1/datasets/:id` | authenticated. Open, one `curl` deletes 2,951,975 molecules |
| `POST /tanimoto/v1/search/batch` | authenticated |

`POST /api/issueSimulationTokens` took the amount **from the request body** and `$set` it on the
caller's own account, so any logged-in user could grant themselves any balance. It now returns
403 and reports the current balance. It is kept rather than deleted so the frontend's existing
call does not 404.

### 4. Signup actually produces a usable account

`insertDoc` never set `simulationTokens`, and the charge requires
`typeof simulationTokens === 'number' && > 0`. **So every account ever created by signup was
unable to run a single simulation** — that is why 47 of the first 50 users have no credits.

New accounts get `SIGNUP_SIMULATION_TOKENS`, **defaulting to `0`**. Not to the demo account's
`99999`: signup has no rate limit and no captcha, and **42 of the first 50 accounts are bot
registrations**, so granting credits on signup would hand box GPU time to every bot that
verifies. Set it deliberately once signup is rate-limited.

Backfilling the existing 47 credit-less users is a separate, one-off job and is not this patch:
`node scripts/migrate-legacy-users.mjs --uri "$MONGODB_URI" --default-tokens 99999`.

A failing verification email used to return 500 while leaving the account behind: unverified, so
it cannot sign in, and its username and email are taken, so it cannot sign up again. The orphan
is now removed so the user can retry.

---

## Deliberately not changed

Keeping this patch to "same product, fixed bugs":

- **The global dock cache.** The POST handler's cache lookup has `'user.username'` commented
  out, so a cached result is returned to any user. That saves recomputation and the inputs are
  public (PDB ID + SMILES) — left alone, but it is a decision, not an oversight.
- **The other ~60 unauthenticated routes** (catalog, pricing, health, the sanitized-result
  fetchers). They leak data and should be closed, but none of them spend money or destroy
  anything, and closing them risks breaking the deployed frontend in ways only testing reveals.
- **`response.ok` checks elsewhere.** Added only to the two docking handlers. Applying it to the
  catalog routes changes their behaviour and needs its own testing.
- **The `:3000` server, wildcard CORS, hardcoded demo credentials in the frontend, bot signups
  with no rate limit or captcha.** All real; all separate work.

## Verified by running it, not by reading it

Staged in an isolated directory on 83 on port 3999, against the real Atlas database and the
real `.env`, with production untouched. Two bugs that `node --check` passed only surfaced when
the process actually started:

- `let creditCharged` was declared **inside** the `try` and read in the `catch`. `let` is
  block-scoped, so the refund path — the only path that matters — was a `ReferenceError`.
- The blanket Tanimoto URL replacement also rewrote the declaration into
  `const TANIMOTO_BASE = process.env.TANIMOTO_API_BASE || TANIMOTO_BASE + '';`, which is a
  self-reference and refused to boot.

Both fixed. Results after the fixes:

| Check | Result |
|---|---|
| Server boots, connects to Atlas | ✅ |
| `GET /health` | `200` |
| `GET /tanimoto/health` → Oracle via `TANIMOTO_BASE` | `healthy`, `molecule_count: 2951975` |
| `GET /tanimoto/v1/search/exact` | real result |
| `POST /api/generate-molecules` **without** a token | `401` (was open) |
| `POST /api/issueSimulationTokens` self-grant of 123456 | `403` (was exploitable) |
| `POST /api/signin` as `tester123` | token issued |
| **Failed dock** (`pdbid=ZZZZ`) | `502`, and **balance 99999 → 99999** — charged then refunded |

The last row is the whole point: before this patch that dock cost a credit and returned a raw
500. The test rig was removed afterwards and production was never touched.

## After applying

Set nothing at first — defaults reproduce today's behaviour exactly. Then, when the box is up,
cut over one variable at a time:

```bash
DOCKING_API_URL=http://<box>:8000/docking          # verify a dock, then
DIFFDOCK_API_URL=http://<box>:8001/...             # verify, then
TANIMOTO_API_BASE=http://<box>:8000                # verify, then retire Oracle
```

Roll back by unsetting the variable and restarting.
