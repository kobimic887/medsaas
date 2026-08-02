# What to do next

> ## Post-promotion handoff
>
> If `oracleNew` (`84.13.81.51`) has already been promoted to production by DNS, stop using
> this file's pre-promotion host assumptions as the operating starting point. Read
> [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md) first: `84` is production,
> `83` is standby, `oracleOld` (`151.145.91.17`) remains the temporary Tanimoto source, and
> Amsterdam is compute-only. Do not blindly run the old §8 port swap, change DNS again, or
> delete anything from `oracleOld`.
>
> **Current as of 2026-08-01.** Everything older is recoverable from the git tag
`docs-archive-2026-08-01` — a ~1,130-line historical log used to live at the bottom of this
file and was deleted, not lost. Recover it with:

```bash
git show docs-archive-2026-08-01:docs/NEXT-SESSION.md
```

---

## The single most important fact

**The GPU box is ORDERED (2026-08-01) and has not been delivered.** Nothing on it has been
executed. The GPU question is closed — **4× RTX PRO 4000**.

**While waiting, three things are worth doing and none need the box:** confirm the ~€5.2k VAT
reverse charge landed on the invoice ([BOX-SPEC.md](./BOX-SPEC.md) §5), transfer the Tanimoto
dump off the owner's Mac (it is the **only copy** of a 2.9 M-molecule index and lives on one
laptop — [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §1b), and apply the `chem_beo` patch that
closes ~60 unauthenticated routes on the live site.

⚠ **This runbook may be run from a fresh clone on another machine.** Four things it needs are
not in git — the Tanimoto dump, `client/dist`, the `.env` files, and the DiffDock weights.
[ARRIVAL-RUNBOOK.md §1b](./ARRIVAL-RUNBOOK.md) lists how to get each.

---

## State of production

`app.pyxis-discovery.com` serves the **original Pyxis**, deliberately. The owner rolled back to
it on 2026-07-31 and it stays there until the box arrives.

| Port | Unit | What | Reachable |
|---|---|---|---|
| **5173** | `pyxis-vite-legacy` | the original Pyxis (`/root/material-tailwind-dashboard-react`, Vite dev) → `chem_beo` on `:3000` | **the public site**, via nginx |
| **5174** | `pyxis-web` | this repo (`/root/pyxis`, Bun 1.3.12 + `client/dist`) → **MongoDB Atlas** | loopback only |
| 3000 | `pyxis-api-legacy` | `chem_beo`, the legacy API | serves 5173; also its own HTTPS listener |
| 3001 | `pyxis-stripe` | `stripe-server.cjs`, the marketing contact form | part of the rollback path — **do not kill it** |

All four are under systemd (`deploy/83/systemd/`) and `enabled`, so a reboot no longer ends
production. Both frontends run together; `Conflicts=` was removed from `pyxis-web` because they
are on different ports now.

**Box day swaps the ports back** — [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §8. Owner's call,
2026-08-01: same day as the docking cutover, but only after the box services pass §7.

**Why `BIND_HOST=127.0.0.1` is on the standby:** 5174 is not behind nginx and shares the
**production Atlas** database. Bound to `0.0.0.0` it answered `http://83.229.87.94:5174/health`
from the open internet over plain HTTP — a second live copy of the app where any sign-in
crosses the network in clear text. Reach it deliberately instead:

```bash
ssh -N -L 5174:127.0.0.1:5174 root@83.229.87.94
```

**What the live product does not have while on legacy** — expected, not bugs to
re-investigate: mail of any kind (invites, password resets, contact form — `chem_beo/.env` and
`stripe-server.cjs` both have empty `EMAIL_*`), response compression, asset caching, the PubMed
literature page, the docked-pose overlay, the wrong-protein fix, and the RDKit loader fix. All
of those exist only in the 5174 version.

### Deploying the 5174 version

Three steps, and the second is easy to forget because it is not in git:

```bash
git archive HEAD | ssh root@83.229.87.94 'tar -x -C /root/pyxis'                   # source
tar -C client -cf - dist | ssh root@83.229.87.94 'tar -x -C /root/pyxis/client'    # built client
ssh root@83.229.87.94 'cd /root/pyxis/server && bun install; systemctl restart pyxis-web'
```

Then stamp `/root/pyxis/DEPLOYED_SHA` and verify with a real request, not with an exit code.
**Always read `DEPLOYED_SHA` before assuming what is running** — it is written by hand and has
been wrong before.

---

## The one job only the owner can do

**Rotate the mail password** for `contact@pyxis-discovery.com` at **yourhosting.nl**. It was
served publicly on 2026-07-29 and still authenticates. After changing it, update `EMAIL_PASS`
in **both** `/root/chem_beo/.env` and `/root/pyxis/server/.env`.

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
4. **Do NOT `pkill -f "bun index.js"` on 83.** It matches production's own process. Kill rigs
   by PID.
5. **Do NOT modify nginx, TLS, DNS or the firewall on 83.** Shared host, not ours.
6. **Do NOT delete `/root/material-tailwind-dashboard-react`.** It is the rollback and a
   different codebase from `client/`, not an older copy. Its start command is
   **`npm run dev-vite-only`** — never `npm run dev`, which also starts `stripe-server.cjs`,
   already holding `:3001`, and the loser dies on `EADDRINUSE`.
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
| 4 | **Stripe webhook registration** | ⚠ **wait for the port swap** | ⛔ **Corrected 2026-08-01 — do NOT do this now.** `STRIPE_WEBHOOK_SECRET` guards the handler in **this repo's** server, which runs on **:5174** and is *not* what `app.pyxis-discovery.com` resolves to. Production is the legacy stack (Vite :5173 → `chem_beo` :3000), so a webhook registered against that hostname today would not reach the handler being configured. Register it **after §8**, when this repo owns 5173. Run `stripe webhook_endpoints list` first — do not create a duplicate. ⚠ See the note below before repeating "purchases grant no credits" |
| 5 | ~~`chem_beo` hardening patch~~ | — | ⛔ **SETTLED 2026-08-01: it will never be applied.** Owner's decision — `chem_beo` is going away at the port swap, so patching it is work on a component with a known end date. **Do not re-raise this.** See the exposure note below, which does not go away with the decision |
| 6 | **Subresource Integrity on external tags** | no | Three external hosts left: jsdelivr (Bootstrap CSS), Google Fonts, unpkg/jsdelivr (RDKit, lazy). None carry SRI |
| 7 | **Bundle code-splitting** | no | `vendor-charts` is 515 KB and the build warns. Gzipped it is ~135 KB on the wire, so lower priority than it looks |
| 8 | **Arrival day** | yes | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) |

### ⚠ Can a customer buy credits right now and receive nothing?

**Unresolved, and worth five minutes before anyone assumes either way.** This repo's server
warns at boot when `STRIPE_WEBHOOK_SECRET` is unset (`server/index.js:88`) — *"credits will NOT
be granted"* — and its buy path is `/create-checkout-session-onetime` (`paidplans.jsx:159`,
`dashboard-navbar.jsx:324`).

But **this repo is not what serves the public site.** Production is the legacy stack, and
whether a purchase is even reachable there, and whether `chem_beo` grants credits on a
`checkout.session.completed`, lives in code this repository cannot see
(`eitangenis/chem_beo` on 83). **Do not repeat the flat claim that "real purchases grant no
credits"** — it was written about this repo's server and has never been checked against the
live one.

**How to settle it**, from a shell on 83:

```bash
grep -nE 'stripe|webhook|checkout' /root/chem_beo/index.js | head
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

1. **It stays on arrival day.** §8 has no dependency on the box, so it *could* have moved
   earlier — the owner was asked on 2026-08-01 and chose to keep it where it is. ⛔ **Do not
   re-raise this.** The exposure until then is therefore **knowingly accepted**, not an
   oversight; treat it as a decision with a stated cost rather than an open finding.
2. **⚠ Rolling back re-opens all of it.** [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §8's
   rollback path returns to `chem_beo`, permanently unpatched. That makes it an emergency
   measure with a real security cost, not a comfortable resting state — and it raises the value
   of getting §7 validation right *before* touching 5173, because a botched swap now costs more
   than a delayed one.

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
- **The server cannot boot from a dev machine.** Atlas enforces an IP allowlist and 83 is on
  it; a non-allowlisted IP is rejected with TLS alert 80, which reads as a confusing handshake
  failure rather than an access error. To measure real headers or behaviour, run a rig on a
  spare port **on 83** and kill it by PID afterwards.
- **`bun run ci` locally is weaker than CI.** The runtime smoke test sees the repo `.env`, so a
  dev machine supplies `FRONTEND_URL`/`BASE_URL` that CI does not have. Set anything a test
  depends on in `childEnvFinal`, not `.env`.
- **Parity between the two servers needs no rig.** `chem_beo` still listens on `:3000`, so the
  live server is its own right-hand side:
  ```bash
  cd /root/pyxis/server && RIG_URL=http://127.0.0.1:5174 node .parity/verify-server-swap-parity.mjs tester123
  ```
  Copy the script under `server/` first — ESM resolves `jsonwebtoken`/`mongodb` from the file's
  own directory upward, and they live in `server/node_modules`.
