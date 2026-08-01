# What to do next

**Current as of 2026-08-01.** Everything older is recoverable from the git tag
`docs-archive-2026-08-01` — a ~1,130-line historical log used to live at the bottom of this
file and was deleted, not lost. Recover it with:

```bash
git show docs-archive-2026-08-01:docs/NEXT-SESSION.md
```

---

## The single most important fact

**The GPU box has not been ordered.** Confirmed by the owner, 2026-08-01. Several documents
were written as though delivery were imminent; they have been corrected. Nothing about the box
is in the past tense, and nothing on it has been executed.

**So the critical path is a purchase, not a deployment:** [BOX-SPEC.md](./BOX-SPEC.md) §5 has
the four things to settle with Coreto, including ~€5.2k of reclaimable VAT that is not applied
automatically. The GPU question is closed — **4× RTX PRO 4000**, settled 2026-08-01.

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
| 1 | **Order the machine** | — | The critical path. [BOX-SPEC.md](./BOX-SPEC.md) §5 |
| 2 | **Two critical tenant-isolation bugs** | no | Found 2026-08-01, unfixed. [SECURITY-FINDINGS.md](./SECURITY-FINDINGS.md) §A1, §A2 |
| 3 | **Prove the Tanimoto dump restores** | no | `scripts/verify-tanimoto-restore.sh`. Needs any x86_64 Docker host. Asserts 2,951,975 rows |
| 4 | **Stripe webhook registration** | no | Register `https://app.pyxis-discovery.com/stripe/webhook`, put the signing secret in `STRIPE_WEBHOOK_SECRET`. Run `stripe webhook_endpoints list` first — do not create a duplicate. Until then real purchases grant no credits |
| 5 | **`chem_beo` hardening patch** | no | `deploy/chem_beo/01-fixes-and-config.patch`. Written, applies cleanly, rehearsed against real Atlas. **Unapplied** — and `chem_beo` is serving the public site right now, so its ~60 unauthenticated routes are live |
| 6 | **Subresource Integrity on external tags** | no | Three external hosts left: jsdelivr (Bootstrap CSS), Google Fonts, unpkg/jsdelivr (RDKit, lazy). None carry SRI |
| 7 | **Bundle code-splitting** | no | `vendor-charts` is 515 KB and the build warns. Gzipped it is ~135 KB on the wire, so lower priority than it looks |
| 8 | **Arrival day** | yes | [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) |

⚠ **Item 5 got more urgent when production rolled back.** The patch closes five money/data
routes including a credit-minting hole and the open `/api/generate-molecules` that is the
NVIDIA rate-limit cause. Those routes are reachable on the live site today.

---

## The prompt to paste on arrival day

Copy this verbatim into a fresh session once the box is powered, on the network and reachable
by SSH:

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
