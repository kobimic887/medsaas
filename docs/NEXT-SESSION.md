# What to do next

> ## Post-promotion handoff
>
> **`oracleNew` (`84.13.81.51`) is the live production host (measured 2026-08-21).** Read
> [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) first for roles, path names, and
> the measured DNS/product check. `oracleOld` (`151.145.91.17`) remains the temporary
> Tanimoto source; Amsterdam is compute-only. Do not blindly run the old §8 port swap, change
> DNS again, or delete anything from `oracleOld`.
>
> **Host `83`:** **scheduled for imminent shutdown** (owner clarification 2026-08-21 — not
> “retire someday”). **Measured same evening:** SSH still works; `83.229.87.94` is up (~50d),
> nginx active, Pyxis on `:5173`/`:5174`/`:3000`/`:3001` and FinSrv on `:4000`. **Not** public
> DNS (A → `84`). Do **not** treat as long-lived standby; do **not** shut it down from an agent
> session. Before-kill checklist:
> [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) § “Before killing `83`”.
>
> **Current as of 2026-08-22:** Boss **approved** public switch to `pyxis-web`
> (**not executed**). Flip checklist: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). Do not
> mutate nginx/JWT/Stripe/DNS until owner says **“do the flip now”**. Product flip may
> precede Amsterdam box.
>
> **2026-08-23:** Interim SMILES→SDF converter live on `84`: docker `pyxis-convertstr`
> (loopback `127.0.0.1:8001`, healthy), `SDF_CONVERTER_URL=http://127.0.0.1:8001/convertSTR`
> in `/root/pyxis-new-standby-5174/server/.env`, image source kept at
> `/root/pyxis-convertstr-src`. Heals `pyxis-web` `:5174` only — public `chem_beo` `:5173`
> SMILES docking stays broken until the flip. Replace with the Amsterdam box ingress
> (`https://<box-domain>/convertSTR`) when the box arrives. Rollback: stop+rm the
> container, remove the env line, restart `pyxis-web`.
>
> Everything older than the 2026-08-01 archive is recoverable from
> the git tag `docs-archive-2026-08-01` — a ~1,130-line historical log used to live at the
> bottom of this file and was deleted, not lost. Recover it with:

```bash
git show docs-archive-2026-08-01:docs/NEXT-SESSION.md
```

---

## The single most important fact

**The GPU box is ORDERED (2026-08-01) and has not been delivered.** Nothing on it has been
executed. The GPU question is closed — **4× RTX PRO 4000**.

**While waiting, two things are worth doing and neither needs the box:** confirm the ~€5.2k VAT
reverse charge landed on the invoice ([BOX-SPEC.md](./BOX-SPEC.md) §5), and transfer the Tanimoto
dump off the owner's Mac (it is the **only copy** of a 2.9 M-molecule index and lives on one
laptop — [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §1b). The `chem_beo` unauthenticated-route
exposure stays until the **public flip** — settled 2026-08-01: **do not patch live
`chem_beo`**; the flip is the remediation. **2026-08-22:** boss approved the maintained
public switch (eligible now; not executed) — see [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md).

⚠ **This runbook may be run from a fresh clone on another machine.** Four things it needs are
not in git — the Tanimoto dump, `client/dist`, the `.env` files, and the DiffDock weights.
[ARRIVAL-RUNBOOK.md §1b](./ARRIVAL-RUNBOOK.md) lists how to get each.

---

## Owner decisions (2026-08-21 evening grilling)

Concise product/ops answers — do not re-litigate unless the owner changes them:

| Topic | Decision |
|---|---|
| **Dual stack** | Public `app.pyxis-discovery.com` → legacy **`:5173`**. Maintained this-repo product on **`:5174`** = dress rehearsal + future live. |
| **Primary during transition (Q6=B → superseded 2026-08-21 night)** | **Legacy public stack is intentionally not improved.** Do not patch ipify, Configurator, Safari tip, titles, or other small UX on live `:5173` — leave it a bit worse so the boss prefers switching to `:5174`. All product energy on `:5174`. Emergencies that keep public login/docking alive are still allowed; polish is not. |
| **When to flip (Q17=A, Q22=A+B)** | Public flip on **boss sign-off (click-test)** **or** box arrival. Boss click-test **may include broad scientific paths**, not marketing-only. |
| **Flip approval (2026-08-22)** | Boss **approved** public → `pyxis-web`. Status: **approved, not executed**. Soft/product flip **may precede Amsterdam box** (supersedes ARRIVAL §8 “arrival-day only / do not re-raise”). Execute only on owner **“do the flip now”** — [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). |
| **Atlas** | Keep sharing one Pyxis Atlas. Fix `simulation_logs` dual-shape in the **reader** — engineering in parallel with dress rehearsal. |
| **JWT (Q13=A)** | Rotate JWT secret **on public flip**. |
| **Stripe (Q14=A, Q18=B)** | Register Stripe webhook **after** public flip. Stripe is **not critical near-term**. |
| **Legacy teardown (Q15≈D)** | Boss-driven / flexible; **no hard N** days/users required. |
| **Box access (Q11=D, Q21)** | Decide on arrival from runbook **§1c probe**. Tailscale is **not** the default; owner may use a *separate* Tailscale account later **only if** the probe needs mesh. **Do not mandate buying Tailscale Pro now** (Q21 unsettled → wait). |
| **First-shell buyer 1-pager (Q12)** | **Parked** until Amsterdam IP/user are known. |
| **PubMed** | Exists **only on maintained**. A `:5174` literature 404 was **deploy/route presence**, not legacy deleting git. |
| **Bare Molstar** | Visiting Molstar with no handoff/result **stays empty** — expected, not a bug to “fix” with demo content. |

## State of production

`app.pyxis-discovery.com` → **`84.13.81.51`**, and still serves the **original Pyxis**
(legacy Vite), deliberately — **until the approved flip executes**. The owner rolled back
the *product* on 2026-07-31; DNS later moved the *host* to `84`. Maintained frontend is on
`:5174` (`pyxis-web`). **2026-08-22:** boss approved making that stack public; flip **not
done**. Checklist: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md).

| Port | Unit | What on `84` | Reachable |
|---|---|---|---|
| **5173** | `pyxis-vite-legacy` | `/root/pyxis-OLD-LIVE-frontend-5173` (`material-tailwind-dashboard-react`, Vite dev) → legacy API on `:3000` | **the public site**, via nginx `:443` |
| **5174** | `pyxis-web` | `/root/pyxis-new-standby-5174` (this repo, Bun + `client/dist`) → **MongoDB Atlas** | process on `0.0.0.0:5174`; also nginx **`:8443`** → 5174 (dress / side door). Docs that said “loopback only” are stale until flip hygiene |
| 3000 | `pyxis-api-legacy` | `/root/pyxis-OLD-LIVE-backend-3000` (`chem_beo`) | serves 5173; also its own HTTPS listener |
| 3001 | `pyxis-stripe` | `stripe-server.cjs` (from the legacy frontend tree) | part of the rollback path — **do not kill it** |

`/home/ubuntu` on `84` has symlinks to those four trees (plus `~/finsrv-4000` → `/opt/finsrv`).
On `83` (still reachable until imminent shutdown; **not** a long-lived standby), older path
names (`/root/chem_beo`, `/root/material-tailwind-dashboard-react` or
`/root/pyxis-OLD-LIVE-5173`) may still appear — measure before editing; do not mutate `83`
toward kill.

All four Pyxis units are under systemd (`deploy/83/systemd/`) and `enabled`, so a reboot no
longer ends production. Both frontends run together; `Conflicts=` was removed from `pyxis-web`
because they are on different ports now.

**Public flip** — approved 2026-08-22, **not executed**. Prefer nginx soft flip (`:443` →
`:5174`) or classic port swap; full ordered steps, JWT, Stripe-after, rollback, and STOP gate:
[`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). Do the flip on **`84`** (live). ARRIVAL-RUNBOOK §8
is the historical box-day port-swap writeup; product flip may precede the box. ⚠ Older lines
that say “mirror config to `83`” need **owner confirmation after shutdown** — there will be no
long-lived `83` rollback host; confirm the post-kill rollback target (likely on-disk /
snapshot on `84` only).

**Why docs once said `BIND_HOST=127.0.0.1` on standby:** intent was to avoid cleartext
public HTTP on Atlas-backed `:5174`. **Measured 2026-08-22:** live unit has **no**
`BIND_HOST`; `server/index.js` listens `0.0.0.0`. Reach deliberately (tunnel or `:8443`) and
treat open `:5174` as hygiene to fix around flip — not a reason to delay the approved product
switch:

```bash
ssh -N -L 5174:127.0.0.1:5174 ubuntu@84.13.81.51
# if 83 is still up and you need its loopback copy:
# ssh -N -L 5174:127.0.0.1:5174 root@83.229.87.94
```
**What the live product does not have while on legacy** — expected, not bugs to
re-investigate: mail of any kind (invites, password resets, contact form — legacy `.env` and
`stripe-server.cjs` both have empty `EMAIL_*`), response compression, asset caching, the PubMed
literature page (maintained-only; a `:5174` 404 is deploy/route presence, not legacy deleting
git), the docked-pose overlay, the wrong-protein fix, and the RDKit loader fix. All of those
exist only in the 5174 version.

### Deploying the 5174 version

Three steps, and the second is easy to forget because it is not in git. Target **`84` (live)**
and the **current** tree name (`83` is imminent shutdown — do not plan new deploys there):

```bash
# example: refresh standby product on live host 84
git archive HEAD | ssh ubuntu@84.13.81.51 'sudo tar -x -C /root/pyxis-new-standby-5174'
tar -C client -cf - dist | ssh ubuntu@84.13.81.51 'sudo tar -x -C /root/pyxis-new-standby-5174/client'
ssh ubuntu@84.13.81.51 'sudo bash -lc "cd /root/pyxis-new-standby-5174/server && bun install; systemctl restart pyxis-web"'
```

Then stamp `/root/pyxis-new-standby-5174/DEPLOYED_SHA` and verify with a real request, not with
an exit code. **Always read `DEPLOYED_SHA` before assuming what is running** — it is written by
hand and has been wrong before.

### companyId readiness (2026-08-21 night)

Prefer **ensure-on-login** over bulk Atlas surgery: `/api/signin` and `/api/demo-session` call
`ensureUserTenantOnLogin` (`server/utils/ensureUserTenant.js`). When exactly one company exists,
missing `companyId` / `role` / `active` are stamped on the user document before the JWT is
issued. No `JWT_SECRET` rotation. No invented credits. No `companyName` stamp (branding stays
`PLATFORM_NAME`).

Bulk path remains `scripts/migrate-legacy-users.mjs` (dry-run by default). Do **not** `--apply`
unless the owner has a backup and has confirmed the sole-company assumption.

**Measured dry-run counts on shared Atlas (`test` DB) 2026-08-21 night (read-only):**
`companyCount=1` (`kobi inc` / `6a083a49…`), `users=54`, `noCompanyId=4`, `badTokens=3`
(missing or string `simulationTokens`). Sole-company assumption holds → ensure-on-login will
stamp those 4 as they sign in. Do **not** bulk-apply until owner backs up; tokens are a
separate migrate concern (defaults to 0, never invent credits).

### History parity soak (`simulation_logs`)

Dual-shape filter lives in `server/utils/simulationLogs.js` (`buildTenantFilter` /
`buildSimulationLogOwnership`). Covered by `server/test/simulation-logs-tenant.test.mjs`.

Readers that must stay dual-shape: `/api/simulation-logs`, docking cache lookup, sanitized
PDB/SDF, `/api/activity` (Notifications). Activity projection includes both top-level
`username` and nested `user.username` so maintained-only rows do not render as “Unknown”.

Manual soak on `:5174` after deploy: sign in as a legacy-shaped user → Control Panel shows
old nested rows **and** a new dock → Notifications lists both → re-dock of a prior pair hits
cache (no second credit charge).

### Boss click-test checklist (owner / boss — not automated)

Tunnel first: `ssh -N -L 5174:127.0.0.1:5174 ubuntu@84.13.81.51` then open
`http://127.0.0.1:5174`.

1. Sign in (or demo) — JWT / account menu shows a session; no surprise logout.
2. Dashboard home loads counts without hanging.
3. Simulation: search → one-click dock → results → Open Viewer → Clear → hard refresh empty.
4. Control Panel: historical run opens; legacy + new rows both visible for the same user.
5. Literature: example query returns results; empty query and a nonsense query show honest empty/error.
6. Deep Similarity: one similarity search returns rows or an honest empty state.
7. Plans & Credits: page renders catalog; **do not** complete a live Stripe purchase on dress rehearsal.
8. Dark mode smoke: sidebar + one results page readable.

Sign-off = boss OK to flip public to maintained. **2026-08-22: boss approved; flip not
executed.** Execute only via [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md) after owner says
**“do the flip now”** (box arrival is no longer required for the product flip).

---

## The one job only the owner can do

**Rotate the mail password** for `contact@pyxis-discovery.com` at **yourhosting.nl**. It was
served publicly on 2026-07-29 and still authenticates. After changing it, update `EMAIL_PASS`
in **both** the legacy API env (`/root/pyxis-OLD-LIVE-backend-3000/.env` on `84`) and the
maintained server env (`/root/pyxis-new-standby-5174/server/.env` on `84`).

Checked 2026-07-31: **not yet rotated.** Whether the current string is the same one that was
exposed cannot be determined from the box — the exposed value was never recorded — so treat it
as still exposed. It needs the provider login; an agent must not attempt it, and must not nag
about it.

---

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
6. **Do NOT delete the live legacy frontend tree** (`/root/pyxis-OLD-LIVE-frontend-5173` on
   `84`, or the older `/root/material-tailwind-dashboard-react` name if still present on `83`).
   It is the rollback and a different codebase from `client/`, not an older copy. Its start
   command is **`npm run dev-vite-only`** — never `npm run dev`, which also starts
   `stripe-server.cjs`, already holding `:3001`, and the loser dies on `EADDRINUSE`.
   Local uncommitted deletes of Cloudflare/Docker/test junk in that tree are intentional; do
   not restore them with a blind `git checkout .` — that would also wipe the live
   `vite.config.js` / `stripe-server.cjs` hardening.
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
| 4 | **Stripe webhook registration** | ⚠ **after public flip** | Confirmed 2026-08-21 (Q14=A): register **after** maintained owns public. Stripe not critical near-term (Q18=B). Flip itself: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md) (approved 2026-08-22, not executed). `STRIPE_WEBHOOK_SECRET` guards this repo's handler on **:5174**, which is not what `app.pyxis-discovery.com` `:443` resolves to today. Run `stripe webhook_endpoints list` first — do not create a duplicate. |
| 5 | ~~`chem_beo` hardening patch~~ | — | ⛔ **SETTLED 2026-08-01: it will never be applied.** Owner's decision — `chem_beo` is going away at the port swap, so patching it is work on a component with a known end date. **Do not re-raise this.** See the exposure note below, which does not go away with the decision |
| 6 | **Subresource Integrity on external tags** | no | Three external hosts left: jsdelivr (Bootstrap CSS), Google Fonts, unpkg/jsdelivr (RDKit, lazy). None carry SRI |
| 7 | **Bundle code-splitting** | no | Resolved for the current home page: the 515 KB `vendor-charts` chunk only powered fictional template charts and has been removed from the build |
| 8 | **Arrival day** | yes | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) |

### ⚠ Can a customer buy credits right now and receive nothing?

**Unresolved, and worth five minutes before anyone assumes either way.** This repo's server
warns at boot when `STRIPE_WEBHOOK_SECRET` is unset (`server/index.js:88`) — *"credits will NOT
be granted"* — and its buy path is `/create-checkout-session-onetime` (`paidplans.jsx:159`,
`dashboard-navbar.jsx:324`).

But **this repo is not what serves the public site.** Production is the legacy stack, and
whether a purchase is even reachable there, and whether `chem_beo` grants credits on a
`checkout.session.completed`, lives in code this repository cannot see
(`eitangenis/chem_beo` on the live application host). **Do not repeat the flat claim that
"real purchases grant no credits"** — it was written about this repo's server and has never
been checked against the live one.

**How to settle it**, from a shell on `84` (read-only on `83` only if still up pre-kill):

```bash
# on 84:
grep -nE 'stripe|webhook|checkout' /root/pyxis-OLD-LIVE-backend-3000/index.js | head
# on 83 the path may still be /root/chem_beo/index.js
stripe webhook_endpoints list          # needs the Stripe login
```

If legacy exposes no buy path, this is moot until the port swap and item 4 above is correctly
deferred. If it does, it is a live money bug — a customer paying and receiving nothing — and it
jumps the queue.

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
the port swap is worth.

**Until the port swap, ~60 unauthenticated `chem_beo` routes are live on the public site.**
`/api/sanitizedminimalsdf/<key>` returns real customer docking results to anyone with no token,
`/api/generate-molecules` reaches the NVIDIA key (and is the rate-limit cause), and there is a
credit-minting hole at `chem_beo:3343`. None of that will now be fixed in place.

**So the port swap is the remediation.** Two consequences, and the first was put to the owner
directly:

1. **It stayed on arrival day until 2026-08-22.** §8 has no dependency on the box, so it
   *could* have moved earlier — the owner was asked on 2026-08-01 and chose to keep it with
   box day. **2026-08-22 owner update:** boss approved a **soft/product flip without waiting
   for Amsterdam** — that earlier “do not re-raise” constraint is **superseded** for the
   product cutover. Follow [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). The
   `chem_beo` exposure until the flip executes remains knowingly accepted until go-time.
2. **⚠ Rolling back re-opens all of it.** [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §8 /
   [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md) rollback returns to `chem_beo`, permanently
   unpatched. That makes it an emergency measure with a real security cost, not a comfortable
   resting state — and it raises the value of getting dress-rehearsal validation right
   *before* touching public `:443`, because a botched swap now costs more than a delayed one.

---

## The prompt to paste on arrival day (pre-promotion only)

> **If `84` is already production, use [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md)
> instead. The prompt below assumes the older state in which `83` is public and `84` is standby.**
>
> Copy this verbatim into a fresh session once the box is powered, on the network and reachable
> by SSH:

> The Amsterdam GPU box has arrived and I can SSH to it. Read `docs/ARRIVAL-RUNBOOK.md`, then
> `docs/BOX-ARCHITECTURE.md`.
>
> Goal for today: get docking running on the box and repoint production at it, and nothing
> else. Compute only. Do not touch the database (Atlas stays), nginx, TLS, DNS or Stripe.
>
> Build the ligand services natively on the box — do not cross-build. Bring up AutoDock and
> OSS DiffDock plus convertSTR, put Caddy on :443 with a Let's Encrypt cert for the box
> hostname, bind every service to 127.0.0.1, and let the host firewall admit only
> 83.229.87.94. No VPN and no tunnel — that was considered and rejected.
>
> Validate against `scripts/verify-docking-response.mjs` before touching the live site. Then do
> the port swap in §8, then cut over one URL at a time via
> `PATCH /api/company/ligand-service-config`, verifying a real dock between each. If anything
> misbehaves, put the Asinex hostnames back — that is the whole rollback.
>
> Verify by measurement, not by reasoning, and tell me plainly if something does not work. Do
> not spawn workflows or subagent fleets.

Tanimoto, GROMACS, ADMET and glioblastoma move **after** docking is proven, not alongside it.

---

## Precedence, when two documents disagree

1. **[ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md)** — for *what to do and in what order*. It
   beats everything else on sequencing.
2. **[BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md)** — for *topology*: what runs where and why.
   Its §2–§3 sequencing is superseded; its topology is not.
3. **The code and config** — `deploy/83/systemd/*.service`, `deploy/box/compose.yml`,
   `server/index.js` — beat **all** prose. Every doc here has been wrong about the code at
   least once. Check the unit file, not the sentence about the unit file.
4. **`deploy/chem_beo/README.md` is stale on sequencing** — it predates the port-swap decision
   and gives direct HTTP box URLs. Its *patch* will never be applied (settled 2026-08-01);
   it is now a record of `chem_beo`'s defects, not a plan.

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
- **Parity between the two servers needs no rig.** `chem_beo` still listens on `:3000`, so the
  live server is its own right-hand side:
  ```bash
  cd /root/pyxis-new-standby-5174/server && RIG_URL=http://127.0.0.1:5174 node .parity/verify-server-swap-parity.mjs tester123
  ```
  Copy the script under `server/` first — ESM resolves `jsonwebtoken`/`mongodb` from the file's
  own directory upward, and they live in `server/node_modules`.
