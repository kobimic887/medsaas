# Standing decisions, do-nots, and traps

**Ops authority:** [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) — roles,
paths, deploys, DNS, and the current release record. This file keeps what outlives a
release: owner decisions, do-nots, residual risks, and method notes. Do not re-litigate
them unless the owner changes them.

> Historical session logs and flip-era state were pruned 2026-09-13. The pre-2026-08-01
> log is recoverable with:
>
> ```bash
> git show docs-archive-2026-08-01:docs/NEXT-SESSION.md
> ```

## Owner decisions (2026-08-21 evening grilling)

Concise product/ops answers — do not re-litigate unless the owner changes them:

| Topic | Decision |
|---|---|
| **Dual stack** | Public `app.pyxis-discovery.com` → maintained **`:5174`** (soft flip 2026-08-23). Legacy **`:5173`** = rollback only. |
| **Primary during transition (Q6=B → superseded 2026-08-23)** | **Do not polish rollback `:5173`.** Product energy stays on public `:5174`. Emergencies that keep public login/docking alive are still allowed; polish on the rollback tree is not. |
| **When to flip (Q17=A, Q22=A+B)** | Public flip on **boss sign-off (click-test)** **or** box arrival. Boss click-test **may include broad scientific paths**, not marketing-only. |
| **Flip (2026-08-23)** | Soft flip **executed**: nginx `:443` → `127.0.0.1:5174`. JWT rotated on maintained. Stripe webhook **registered**; checkout smoke open. Rollback + notes: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). |
| **Atlas** | Keep sharing one Pyxis Atlas. Fix `simulation_logs` dual-shape in the **reader** — engineering in parallel with the maintained stack. |
| **JWT (Q13=A)** | Rotate JWT secret **on public flip**. |
| **Stripe (Q14=A, Q18=B)** | Webhook **registered** 2026-08-23 on maintained. Checkout smoke still owner-only. |
| **Legacy teardown (Q15≈D)** | Boss-driven / flexible; **no hard N** days/users required. |
| **Box access (Q11=D, Q21)** | Decide on arrival from runbook **§1c probe**. Tailscale is **not** the default; owner may use a *separate* Tailscale account later **only if** the probe needs mesh. **Do not mandate buying Tailscale Pro now** (Q21 unsettled → wait). |
| **First-shell buyer 1-pager (Q12)** | **Parked** until Amsterdam IP/user are known. |
| **PubMed** | Exists **only on maintained**. A `:5174` literature 404 was **deploy/route presence**, not legacy deleting git. |
| **Bare Molstar** | Visiting Molstar with no handoff/result **stays empty** — expected, not a bug to “fix” with demo content. |

## The one job only the owner can do

**Rotate the mail password** for `contact@pyxis-discovery.com` at **yourhosting.nl**. It was
served publicly on 2026-07-29 and still authenticates. After changing it, update `EMAIL_PASS`
in **both** the legacy API env (`/root/pyxis-ROLLBACK-backend-3000/.env` on `84`) and the
maintained server env (`/root/pyxis-LIVE-5174/server/.env` on `84`).

Checked 2026-07-31: **not yet rotated.** Whether the current string is the same one that was
exposed cannot be determined from the box — the exposed value was never recorded — so treat it
as still exposed. It needs the provider login; an agent must not attempt it, and must not nag
about it.

## Do NOT do these — each looks correct and is not

1. **Do NOT remove `bootstrap.min.css` from `client/index.html`.** A 2026-07-30 audit measured
   Bootstrap as completely dead and it genuinely was — **then the marketing pages were
   restored.** `about-us`, `contact-us`, `services` and `paidplansdescription` are Bootstrap
   markup, and `tailwind.css` carries overrides targeting those same classes. Removing it
   breaks four live pages. The genuinely dead parts (Font Awesome, Bootstrap's JS, popper, a
   placeholder analytics tag) were already removed on 2026-07-31.
2. **Do NOT bump `react-router` to fix its two Dependabot alerts.** The fix is only in v7 and
   the app is on 6.30.4. That is a framework migration, not a patch.
3. **Do NOT remove sign-up, the paid-plans page, or billing.** "De-SaaS" meant *branding*. A
   2026-07-29 pass read it as feature removal and deleted them; that was reverted. Keep the
   thing, fix how it works.
4. **Do NOT `pkill -f "bun index.js"` on the application hosts.** It matches production's own
   process. Kill rigs by PID.
5. **Do NOT modify nginx, TLS, DNS or the firewall on `83` or `84`** unless the owner names
   that exact action. Shared hosts.
6. **Do NOT delete the live legacy frontend tree** (`/root/pyxis-ROLLBACK-frontend-5173` on
   `84`, or the older `/root/material-tailwind-dashboard-react` name if still present on `83`).
   It is the rollback and a different codebase from `client/`, not an older copy. Its start
   command is **`npm run dev-vite-only`** — never `npm run dev`, which also starts
   `stripe-server.cjs`, already holding `:3001`, and the loser dies on `EADDRINUSE`.
   Those junk deletes plus the vite/stripe hardening are **in git** as of 2026-08-23
   (`60072cb`). Do not hard-reset; host `.env` is still local-only.
7. **Do not trust `grep -c` to prove a deploy landed.** It counts *lines*, and has produced a
   false "shipped" reading twice in this repo. Verify by fetching the live URL and matching a
   string that survives minification (property names do; local variable names do not).
8. **Do NOT re-propose NVIDIA NIM or price AI Enterprise.** Owner decision, 2026-07-31.
   DiffDock is rebuilt from OSS `gcorso/DiffDock` (MIT).

---

## What is actually left, in priority order

| # | Work | Needs the box? | Notes |
|---|---|---|---|
| 0 | **AutoDock-GPU is not implemented — but it is NOT a blocker** | no | `engines/autodock_gpu.py` raises `DockingUnavailable` unconditionally and a test asserts the 503. **The bug was the documentation, and it is fixed:** the runbook called it "the workhorse" and `.env.example` defaulted to the stub, so following both gave 503 on every dock. Default is now `vina`. ⚠ **Arrival day should ship on CPU Vina and that fully achieves the goal** — the box exists so docking stops depending on Moscow ([BOX-SPEC.md](./BOX-SPEC.md) §1: *"Not throughput, not cost"*), and 32 cores of Vina does that. AutoDock-GPU is a **follow-up optimization**, buildable on the box at leisure |
| 1 | ~~Back up the Tanimoto dump~~ | — | ⛔ **Declined 2026-08-01. Do not re-raise.** The dump lives only at `~/backups/tanimoto/` on the owner's Mac, but **Oracle's Postgres is live and is the authoritative source**, so losing the laptop costs a re-dump, not the data. Integrity verified 2026-08-01 (sha256, `PGDMP`/`tonomitosql`/`17.5` header, tail intact). ⚠ The residual risk is stated once below and is not a task |
| 2 | **Tenant-isolation and perf findings** | no | [SECURITY-FINDINGS.md](./SECURITY-FINDINGS.md) §A1–A3 and [IMPROVEMENTS.md](./IMPROVEMENTS.md) P1–P6 |
| 4 | ~~Stripe webhook registration~~ | — | ✅ **Done 2026-08-23** on maintained (`we_1U7Z6vAlVdO1Ab8fuM6HWROx`). Optional owner Step 4: Standard $20 checkout + refund. |
| 5 | ~~`chem_beo` hardening patch~~ | — | ⛔ **SETTLED 2026-08-01: it will never be applied.** `chem_beo` is rollback-only (off public since the 2026-08-23 flip). Patching it is work on a dead public path. **Do not re-raise this.** See the exposure note below |
| 6 | **Subresource Integrity on external tags** | no | Three external hosts left: jsdelivr (Bootstrap CSS), Google Fonts, unpkg/jsdelivr (RDKit, lazy). None carry SRI |
| 7 | **Bundle code-splitting** | no | Resolved for the current home page: the 515 KB `vendor-charts` chunk only powered fictional template charts and has been removed from the build |
| 8 | **Arrival day** | yes | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) |

### ⚠ Can a customer buy credits right now and receive nothing?

**Webhook path settled 2026-08-23.** Maintained `pyxis-web` has live endpoint
`we_1U7Z6vAlVdO1Ab8fuM6HWROx` and `STRIPE_WEBHOOK_SECRET` in
`/root/pyxis-LIVE-5174/server/.env`. Unsigned POST returns 400 (signature required),
not “not configured”. Buy path remains `/create-checkout-session-onetime`.

**Still unproved end-to-end:** a real Standard ($20) checkout + refund
([`STRIPE_LIVE_CUTOVER.md`](./STRIPE_LIVE_CUTOVER.md) Step 4) — owner card only;
agents must not charge without an explicit yes. Until that smoke, treat live credit
grant as **configured but not payment-verified**.

```bash
# on 84 / from Mac with Stripe CLI:
curl -sS https://api.stripe.com/v1/webhook_endpoints -u "$SK:"   # expect one URL
curl -sS -X POST https://app.pyxis-discovery.com/stripe/webhook -H 'Content-Type: application/json' -d '{}'
# expect HTTP 400 No stripe-signature (not 500 not-configured)
```

### The one residual risk on the Tanimoto index — stated once, not a task

Backing up the dump was declined (2026-08-01) and that is reasonable: Oracle is live and is the
authoritative source. But the reason the dump was taken in the first place has not gone away —
**`DELETE /tanimoto/v1/datasets/:dataset_id` is unauthenticated and internet-reachable**
(`chem_beo/index.js:437`, [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md) §8 row 3b).
Anyone can destroy the 2,951,975-molecule index, and it has no replica.

So the two copies fail together only in one specific way: someone triggers that route **and**
the laptop is gone. That is unlikely, and it is now an accepted risk rather than an open item.
Worth knowing because it is a one-line fix whenever `chem_beo` is next touched — except
`chem_beo` is never being touched again, so in practice this closes when `/tanimoto/*` stops
resolving to Oracle ([ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §10).

### ⚠ The consequence of never patching `chem_beo`

The decision is reasonable — but it has a shape worth stating plainly, because it changes what
the public flip was worth.

**Those ~60 unauthenticated `chem_beo` routes are public only on rollback** to `:5173`/`:3000`.
`/api/sanitizedminimalsdf/<key>` returns real customer docking results with no token,
`/api/generate-molecules` reaches the NVIDIA key, and there is a credit-minting hole at
`chem_beo:3343`. None of that will be fixed in place.

**Soft flip 2026-08-23 is the remediation.** Two leftovers:

1. **Historical:** the swap stayed on arrival day until 2026-08-22, then the boss approved a
   product flip without Amsterdam. Executed 2026-08-23 via
   [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md).
2. **⚠ Rolling back re-opens all of it.** [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §8 /
   [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md) rollback returns to `chem_beo`, permanently
   unpatched. Emergency measure, not a resting state.

---

## Precedence, when two documents disagree

1. **[ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md)** — for *what to do and in what order*. It
   beats everything else on sequencing.
2. **[BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md)** — for *topology*: what runs where and why.
   Its §2–§3 sequencing is superseded; its topology is not.
3. **The code and config** — `deploy/83/systemd/*.service`, `deploy/box/compose.yml`,
   `server/index.js` — beat **all** prose. Every doc here has been wrong about the code at
   least once. Check the unit file, not the sentence about the unit file.
4. **`deploy/chem_beo/README.md` is a defect record** — patch never applied (settled
   2026-08-01). Public is already `pyxis-web`. Do not treat it as a plan to improve rollback.

## Method notes that saved real time

- **Measure, do not reason — then read the measurement like it might be lying.** Two "findings"
  in this repo were screenshot artefacts, and one was a grep matching an *older* symbol whose
  name contained the new one.
- **The server cannot boot from a dev machine.** Atlas enforces an IP allowlist and the live
  application host (`84`, historically `83`) is on it; a non-allowlisted IP is rejected with
  TLS alert 80, which reads as a confusing handshake failure rather than an access error. To
  measure real headers or behaviour, run a rig on a spare port **on `84`** and kill it by PID
  afterwards.
- **`bun run ci` locally is weaker than CI.** The runtime smoke test sees the repo `.env`, so a
  dev machine supplies `FRONTEND_URL`/`BASE_URL` that CI does not have. Set anything a test
  depends on in `childEnvFinal`, not `.env`.
- **Parity vs rollback needs no extra host.** `chem_beo` is **stopped** on `84` (enabled).
  Public is `pyxis-web` `:5174`. If you start rollback `:3000` for a comparison:
  ```bash
  cd /root/pyxis-LIVE-5174/server && RIG_URL=http://127.0.0.1:5174 node .parity/verify-server-swap-parity.mjs tester123
  ```
  Copy the script under `server/` first — ESM resolves `jsonwebtoken`/`mongodb` from the file's
  own directory upward, and they live in `server/node_modules`.
