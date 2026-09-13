# Post-promotion operating handoff

**Use this document when the owner has already promoted `oracleNew` (`84.13.81.51`) to
production by changing DNS.** It is the authority for the period after that promotion.

This document does **not** change DNS or authorize any destructive action. Re-confirm DNS
and service identity with live checks at the start of every session. Every copy
(Mac / 84 / 151 / 83 / GitHub): [`WHERE.md`](./WHERE.md).

## Release 2026-09-13 (later): catalog-authoritative pricing, /api4/bas retired

Owner-approved deployment: public `pyxis-web :5174` now `916ea57`
(catalog-authoritative pricing; stock unpurchasable; zero `/api4/bas` runtime
callers). DNS `app.pyxis-discovery.com` → `84.13.81.51` rechecked immediately
before deploy. Deployed in place per the standing procedure (source `git archive`
+ fresh production `client/dist`, one `systemctl restart pyxis-web`, loopback
`/health` answered 200 after 4 s). `DEPLOYED_SHA=916ea5739cdf4141fa709053da31126772c24f83`.
Deployed `assets/simulation-BGR73lCz.js` SHA256 `9beb41b4…158840` matched the Mac
build byte-for-byte; the served bundle contains **zero** `stock-offers`
references and carries the catalog `PRICE_1MG` display path and the "not priced
or purchasable" stock banner. Public checks: home 200, `/health` 200,
`POST /api/stock-offers` unauthenticated → 401 (route is an auth-gated refusal;
authenticated answers 503 `STOCK_OFFERS_DISABLED`).

Pre-deploy gates (all green on the combined tree): `bun run check`, lint (14
pre-existing warnings), `bun run test:catalog-pricing` bun+node (38 unit + 23
route + 24 + 37 lifecycle), full server suite (incl. staging-simulation 40 with
the new zero-`/api4/bas` fixture counter), `test:simulation-search` 88.
Browser-verified by the display slice before integration: catalog browse rows
show the catalog's own prices (BAS 00132206 $28/$84/$224), basket add works,
zero offer calls and zero long tasks while scrolling.

Live pricing evidence (read-only upstream probes): `GET /api/all` and
`GET /api/id/BAS 00132206` both answer $28/$84/$224 (1/5/10 mg); `/api/id`
accepts BAS/ASN-prefixed and bare codes; unknown code = 200 + empty body.
`POST /api/api4/bas` (BAS search) now answers from `/api/id` lookups — the
upstream `/api4/bas` endpoint has no runtime callers. Payment completion
remains untested (unchanged); no payment, order, or enquiry was submitted.

Rollback: `/root/pyxis-rollback-0e932a1-20260913-catalog-pricing.tgz` on 84,
validated (17168 entries, dist included, `.env` excluded) before deployment.
Stop `pyxis-web`, extract in place into `/root/pyxis-LIVE-5174`, restart, wait
for `/health`, confirm restored `DEPLOYED_SHA=0e932a1…`. Server lockfiles did
not change; no nginx, DNS, database, or engine changes.

## Release 2026-09-13: authoritative prices and working hosted checkout

Owner-authorized deployment: public `pyxis-web :5174` now `0e932a1`
(superseded later the same day by `916ea57` — see the release section above)
(includes `4b285aa` pricing/review and removal of the unnecessary browser
publishable-key guard). DNS rechecked at `84.13.81.51`; source and built index
SHA256 matched the Mac artifact. Public health returned 200 after restart.
Mac and oracleOld source are synced; engine source remains `b36da33` and was not deployed.
Atlas and existing Stripe secrets were preserved.

Fresh Safari evidence as TESTER123: Internal catalog BAS 00132206 displayed
$170/$218/$242 for 1/5/10 mg. Existing basket retained BAS 00132206, 1 mg,
$170. Clicking Checkout issued public POST `/create-checkout-session-onetime`
HTTP 200 at 09:13:33 UTC and opened live Stripe hosted review showing
`BAS 00132206 · 1 mg`, `US$170.00`, formula `C12 H12 N4 O2`.
No payment details entered, Pay not clicked, no paid order or enquiry submitted.
Returned through Stripe's Back to Pyxis link; basket still contains one item.
Creating review creates an unpaid Stripe session and pending billing event.
Payment completion/webhook fulfillment is deliberately unproved.

Verification: stock offers 31 unit + 21 route + 64 lifecycle checks, including
actual navbar-handler execution without a publishable key; server compile and
production client build pass. Lint exits successfully with 13 existing warnings.
409 review and pack/quantity rejection covered by focused fixture-backed tests;
no live price drift was manufactured for this deployment.

Rollback: `/root/pyxis-rollback-b2d554f-20260913-checkout.tgz` on 84, archive
validated before deployment. Stop `pyxis-web`, extract in place into
`/root/pyxis-LIVE-5174`, start `pyxis-web`, wait for `/health` and confirm restored
`DEPLOYED_SHA=b2d554f...`. Archive excludes env files and node_modules;
server lockfiles did not change. No nginx, DNS, database, or engine changes.

## Earlier pre-deploy evidence 2026-09-13 (superseded by release above)

Verified and committed on `main`; **`84` still runs the 2026-09-12 release above**
(deploy is a separate owner-approved step). Contract: [`DATA-STOCK-COMPOUNDS.md`](./DATA-STOCK-COMPOUNDS.md)
§ Purchasable offers / Price review.

- **Identities re-measured this pass (not trusted from history):** DNS
  `app.pyxis-discovery.com` → `84.13.81.51`; the deployed tree on `84`
  content-matches the pack-offers runtime (`priceMoleculeCartFromOffers` in
  `server/index.js`, `/api/stock-offers` route, `stock-offers` string in the
  client bundle) — behaviorally the 2026-09-12 release; `151`
  `/home/ubuntu/sql/tonomitosql` is at `b36da33` with `tonomitosql-api-1` up.
- **New in the tree:** checkout answers **409 `MOLECULE_PRICES_CHANGED`** with
  re-priced rows before any Stripe session (one pack per row; explicit
  `quantity` ≠ numeric 1 → 400); the navbar adopts the refreshed basket through
  `client/src/utils/moleculeCart.js`; Simulation *Internal catalog* price
  columns are live-quote only (snapshot `PRICE_*MG` dropped, retry banner on
  failed quote batches — regression BAS 00132206 $170/$218/$242 supersedes
  stale $28/$84/$224).
- **Local verification (2026-09-13):** `bun run test:stock-offers`
  (31 unit + 21 route + 62 lifecycle — incl. real-server 409 route test with
  in-memory Mongo: no billing event written when review blocks),
  `bun run test:simulation-search` (89 invariants), `bun run test:brand`,
  `bun run check` (server compile + client build), full `bun run test` green.
- **Existing production evidence (unchanged, 2026-09-12):** live pack offers
  (BAS 30906909 $170/$194/$218/$242), basket-reload survival, earlier isolated
  checkout evidence; owner-card Standard payment smoke still open
  ([`NEXT-SESSION.md`](./NEXT-SESSION.md)).
- **Interactive checkout verification (2026-09-13, Safari, TESTER123 —
  accessibility-only, no screen recording):** session alive; the preserved
  basket showed **BAS 00132206 · 1 mg · $170.00** (untouched after); the
  catalog still displayed the stale snapshot $28/$84/$224 for that code
  (expected pre-deploy). Clicking *Checkout with Stripe* (twice, clean) sent
  **no API call at all**: nginx shows **zero `POST /create-checkout-session-onetime`
  on the live site since the 2026-08-23 promotion** (only a Sep 7 `/staging/`
  403 probe). Root cause, measured on `84`: the deployed `client/dist` bundle
  contains **no `VITE_STRIPE_PUBLISHABLE_KEY`** (no `pk_live`/`pk_test`
  anywhere in the assets), so `handleCheckout`'s first guard fails, shows the
  6-second "Checkout is temporarily unavailable" toast, and returns before the
  fetch. Server side is provisioned (`STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET` present in `/root/pyxis-LIVE-5174/server/.env`). So
  **hosted checkout is unreachable from the public UI as deployed — a
  build-configuration gap, not an API regression**; the earlier "isolated
  checkout evidence" above did not go through this client build. Fix is an
  owner decision to fold into the next deploy: build the client with
  `VITE_STRIPE_PUBLISHABLE_KEY` set, or relax the client guard (redirect-based
  Checkout does not need the publishable key server-side). No payment, order,
  or enquiry was made; the 409 guard is browser-verifiable only after deploy.

## Release measured 2026-09-12: stock selectors and pack pricing

- Public `pyxis-web :5174` deployed `b2d554f5c13ca177a60ead8442bba423a7746583`.
  This has the same application code as combined browser-tested `f5c8a11`; subsequent
  commits correct stock-engine documentation. Built on 151, installed with the frozen
  server lockfile on 84. Existing environment files were preserved.
- Live tonomitosql API on 151 `:8000` now runs `b36da33`: global similarity DESC / ID ASC
  before pagination, with parallel gather disabled. No 1,000-candidate cutoff.
  Only the API container was recreated; Postgres was not restarted/recreated, and its
  proposed 1 GB shared-memory setting has **not** been applied.
- Dataset 4 remains 630,646 rows; existing DATA dataset 3 remains 2,951,975 rows.
- Fresh public HTTPS authenticated verification: stock capabilities (six binary
  fingerprints / two metrics); Anna MACCS/Dice at 0.3 returned ten rows in 12.22 s;
  stock pack offers for BAS 30906909 returned 1/2/5/10 mg at $170/$194/$218/$242.
  Direct live engine: MACCS/Dice at 0.3 ~12.0 s; Morgan/Tanimoto at 0.1 ~6.28 s.
- Fresh Safari production evidence: existing sign-in survived; Internal catalog loaded;
  stock selectors rendered; benzoic-acid search returned BAS 30906909 at 1.000;
  5 mg / $218 basket entry survived reload with its stock ID and amount intact.
  The test item was removed. No checkout/payment or paid prediction was submitted
  in this deployment pass (the agents' earlier isolated checkout evidence is separate).
- Public root, health, folding route, and `/staging/` returned 200. This is not new
  live-NVIDIA evidence. Open compounds status reports AI disabled; no credentials changed.
- Other agents' verification services were not removed or promoted.

Rollback is two independent layers, not a rollback to legacy :5173:

1. App snapshot on 84: `/root/pyxis-rollback-7004271-20260912.tgz` (excludes `.env`).
   Stop `pyxis-web`, restore this archive into `/root/pyxis-LIVE-5174`, start
   `pyxis-web`, and verify `/health` plus `DEPLOYED_SHA=7004271...`.
   Original dependencies also remain at `/root/pyxis-server-node_modules-7004271-20260912`.
2. Engine rollback on 151: image `tonomitosql-api:rollback-1e71b0c-20260912`, rebuilt
   from commit 1e71b0c because the running image's old Docker layers were missing.
   In `/home/ubuntu/sql/tonomitosql`, tag that image `tonomitosql-api:latest`, then
   `docker compose up -d --no-deps --no-build api`. Never recreate the db for this
   rollback. This restores the prior shared-memory failure on broad queries, so use
   only if a worse regression is found. Do not use capped b0f168f.

## Measured 2026-08-21 evening; re-checked 2026-08-23 (re-check before acting)

| Check | Result |
|---|---|
| `app.pyxis-discovery.com` A | **`84.13.81.51`** (`oracleNew`) |
| `app.fin-srv.com` A | **`84.13.81.51`** |
| Public Pyxis product | **Maintained `pyxis-web`** on `:5174` (soft flip 2026-08-23) — title `Pyxis Discovery` (re-fetched 2026-08-23), `DEPLOYED_SHA` `d96a7a6…` |
| nginx on `84` | `proxy_pass http://127.0.0.1:5174` on `:443` (legacy `:5173` kept for rollback) |
| Side door | nginx **`:8443`** also → `:5174`. Checklist / rollback: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md) |
| Host `83` (`83.229.87.94`) | **Imminent shutdown** (owner 2026-08-21 — not long-lived standby). **Measured:** SSH OK, hostname `chem`, up ~50d, nginx active, listeners `:443`/`:80`, `:5173`, `127.0.0.1:5174`, `:3000`, `:3001`, `:4000`. **Not** on public DNS. Agents: read-only only; do not kill. See § “Before killing `83`”. |

### Paths on `84` (renamed 2026-08-23; do not expect `standby` / `OLD-LIVE` / `chem_beo`)

| Role | Path on `84` | Git remote / identity |
|---|---|---|
| Legacy rollback frontend | `/root/pyxis-ROLLBACK-frontend-5173` | `eitangenis/material-tailwind-dashboard-react` @ `60072cb` |
| Legacy rollback API | `/root/pyxis-ROLLBACK-backend-3000` | `eitangenis/chem_beo` @ `8d1d921` |
| Live maintained (public) | `/root/pyxis-LIVE-5174` | deploy tree (no `.git`); `DEPLOYED_SHA` stamped |
| FinSrv | `/opt/finsrv` | nginx → `:4000` |

`/home/ubuntu` exposes those trees as symlinks (`~/pyxis-ROLLBACK-frontend-5173`,
`~/pyxis-ROLLBACK-backend-3000`, `~/pyxis-LIVE-5174`, `~/finsrv-4000`). On `83` (until
kill) the legacy trees may still use older names (`/root/chem_beo`,
`/root/pyxis-OLD-LIVE-5173`); measure read-only only — do not mutate toward shutdown.

## Deploying the live tree on `84` (standing procedure)

**Do not rename or move the live tree under public traffic.** A `mv` + `systemctl restart`
leaves nginx `:443` with nothing on `:5174` → public **502** (the catalog looked like an
ASINEX failure at 2026-08-23 ~10:19 UTC; it was the restart gap). Extract **in place**,
restart once, then wait for health before calling the deploy done.

```bash
# In-place refresh on 84 (never mv/rename /root/pyxis-LIVE-5174 while public)
git archive HEAD | ssh ubuntu@84.13.81.51 'sudo tar -x -C /root/pyxis-LIVE-5174'
# only if client changed:
tar -C client -cf - dist | ssh ubuntu@84.13.81.51 'sudo tar -x -C /root/pyxis-LIVE-5174/client'
ssh ubuntu@84.13.81.51 'sudo bash -lc "
  set -e
  cd /root/pyxis-LIVE-5174/server && bun install
  systemctl restart pyxis-web
  # bun is down for a few seconds — poll loopback health, not nginx, until ready
  for i in \$(seq 1 30); do
    code=\$(curl -sS -m 2 -o /dev/null -w \"%{http_code}\" http://127.0.0.1:5174/health || echo 000)
    [ \"\$code\" = \"200\" ] && exit 0
    sleep 1
  done
  echo \"pyxis-web failed to answer /health after restart\" >&2
  exit 1
"'
git rev-parse HEAD | ssh ubuntu@84.13.81.51 'sudo tee /root/pyxis-LIVE-5174/DEPLOYED_SHA >/dev/null'
```

Stamp `/root/pyxis-LIVE-5174/DEPLOYED_SHA` and verify with a real request, not only an exit
code. **Always read `DEPLOYED_SHA` before assuming what is running** — it is written by hand
and has been wrong before.

Nginx notes (do **not** change without owner yes): default `proxy_pass` to a single upstream
has no retry while the sole backend is restarting. Prefer the health-wait above over editing
nginx. If ever adding an upstream block, `fail_timeout=0` / short `max_fails` still cannot
serve traffic with zero backends — the gap is process uptime, not proxy knobs alone.

## Owner decisions (2026-08-21 evening + 2026-08-22 flip approval)

See also [`NEXT-SESSION.md`](./NEXT-SESSION.md) § “Owner decisions” and the flip checklist
[`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md). Short form for agents landing here first:

- **Public product (2026-08-23):** maintained `:5174` via nginx soft flip. Legacy `:5173`
  trees stay; rollback units **stopped** (still **enabled**) 2026-08-23.
- **Do not polish legacy** — product energy stays on maintained. Emergencies on legacy only
  if rolling back.
- **Flip status:** **executed** (soft flip A + JWT rotate). Stripe webhook **registered** 2026-08-23; checkout smoke open.
  Details: [`PYXIS-WEB-FLIP.md`](./PYXIS-WEB-FLIP.md).
- **Flip triggers (historical grill):** boss click-test (may include broad scientific paths)
  **or** box arrival (Q17=A, Q22=A+B) — boss path is now the active path.
- **Atlas shared;** fix `simulation_logs` dual-shape in the reader in parallel.
- **On public flip:** rotate JWT (Q13=A); register Stripe webhook after flip (Q14=A). Stripe
  not critical near-term (Q18=B).
- **Legacy teardown:** boss-driven / flexible; no hard N (Q15≈D).
- **Box access:** choose from §1c probe on arrival (Q11=D). Do not buy Tailscale Pro by
  default; separate Tailscale account only if probe needs mesh (Q21 → wait). Park first-shell
  buyer 1-pager until IP/user known (Q12).
- **PubMed:** maintained only; `:5174` 404 ≠ legacy deleting git.
- **Bare Molstar:** empty visit with no handoff is intentional.

### Rollback trees are cleaned in git (2026-08-23)

`:5173` / `:3000` junk deletes + `vite.config.js` / `stripe-server.cjs` hardening are
**committed** on those remotes (`60072cb` / `8d1d921`). Host `.env` stays uncommitted.
Do not `git checkout .` / hard-reset those trees — that would still be wrong if a later
host-only edit appears.

## The role switch

| Host | Post-promotion role | What it must not be confused with |
|---|---|---|
| **`oracleNew` — `84.13.81.51`** | **Live production application host** for every hostname the operator has deliberately pointed at it. Validate this host first. Dual stack: public maintained `:5174`, legacy `:5173` rollback only. | `oracleOld`; it is not the Tanimoto source and is not the Amsterdam box |
| **`83.229.87.94`** | **Imminent shutdown** (owner 2026-08-21). Still measured up as a non-DNS host (nginx + Pyxis/FinSrv listeners) until teardown — **not** a long-lived standby. Keep inventory/runbooks as historical record; agents do not power it off. | The Amsterdam compute box; public production (DNS is on `84`); long-lived failover |
| **`oracleOld` — `151.145.91.17`** | Temporary source for the live Tanimoto/Postgres data and old non-production medsaas stack. | `oracleNew`; this is a different Oracle tenancy, key, workload and data role |
| **Amsterdam GPU box** | Compute-only host for docking, DiffDock, convertSTR, Tanimoto + Postgres/RDKit, GROMACS, ADMET and glioblastoma. Access method chosen from §1c probe on arrival — not Tailscale-by-default. | Neither application host; it does not receive the API or MongoDB Atlas |

The expected DNS promotion is normally:

- `app.pyxis-discovery.com` → `84.13.81.51` for Pyxis;
- `app.fin-srv.com` → `84.13.81.51` for FinSrv, **if that hostname was also promoted**.

Verify each hostname independently. Pyxis and FinSrv use different applications and different
MongoDB Atlas projects. A working Pyxis request does not prove FinSrv's Mongo connection, and
`/api/health` alone is only a process check.

## Before killing `83` (owner checklist)

Agents do **not** shut down or mutate `83`. Owner confirms these on **`84` first**, then kills
`83` out of band:

| Gate | Must be true | Notes (2026-08-21 measure) |
|---|---|---|
| **DNS** | `app.pyxis-discovery.com` and `app.fin-srv.com` A → **`84.13.81.51` only** | Already true for both |
| **Pyxis sole home** | Public `:5174` healthy on `84`; rollback trees on disk; units enabled but **stopped** (2026-08-23) | Already true — Pyxis is live on `84` |
| **FinSrv sole home** | `app.fin-srv.com` serves from `84` (`/opt/finsrv` → `:4000`); authenticated/DB-backed check OK **without** needing `83` | DNS on `84`; confirm FinSrv is not still depending on anything only on `83` |
| **Mirrors / rollback story** | Owner decides post-kill rollback target | After kill there is **no** host-level mirror on `83`. Likely: on-disk trees + timestamped snapshots on **`84` only**. Docs that still say “mirror/`sync`/`rollback` to `83`” need confirmation — see flags below |
| **Backups** | Env/secrets, nginx TLS material if not elsewhere, any FinSrv/Pyxis data that exists only as files on `83` (not Atlas) are copied or confirmed present on `84` / backup store | Atlas stays; host-local files do not |
| **Default URLs** | No production client/server default still points scientific traffic at `83` IPs/ports after kill | e.g. legacy `SDF_CONVERTER_URL` default in this repo historically cited `83` — verify live env on `84` |

**Post-shutdown open question for the owner:** what is the rollback target once `83` is gone —
on-disk legacy trees on `84`, a snapshot tarball, or something else? Do not assume a second VPS.

**Docs flagged** (still contain mirror/`sync`/`rollback`-to-`83` assumptions in body text;
banners updated — prefer this handoff over those sections):
`ARRIVAL-RUNBOOK.md`, `BOX-ARCHITECTURE.md`, `PRODUCTION-83-INVENTORY.md`,
`deploy/83/systemd/README.md`. Archived away from the agent path:
`docs/archive/FRONTEND-QUALITY-PLAN.md`, `docs/archive/NEUROSNAP-BENCHMARK.md`,
`docs/archive/ROLLBACK-BUN-NODE.md`.

## Database rules

- **Pyxis MongoDB Atlas stays exactly where it is.** Users, credits, billing, companies and
  simulation history are not dumped, moved or replaced during this work. The Pyxis services
  on `84` (and historically on `83` until shutdown) intentionally use the same Atlas database.
  Fix `simulation_logs` dual-shape in the **reader** in parallel with the maintained stack
  (owner, 2026-08-21).
- **FinSrv MongoDB is separate.** Validate its own Atlas project/cluster on the one
  application host (`84`); `83` is leftover and not DNS. Never substitute the Pyxis URI.
- **Tanimoto Postgres is different again.** It is the 2,951,975-molecule production index
  currently sourced from `oracleOld`. Restore it to Amsterdam and verify it before retiring
  the old Oracle stack.
- **`oracleOld`'s local `mongo:7` / `medsaas` database was non-production side-project data.**
  Never restore it over Pyxis Atlas. Measured 2026-08-23: no `medsaas`/`mongo` containers,
  no `:27017`; leftover volume only — do **not** start. Volume removal is only in the
  explicit, approved cleanup phase after all migration gates pass.

## What a fresh agent should do

When the owner says:

> Amsterdam box has arrived. Here is its connection information.

and confirms that `84` is already production, the agent should:

1. **Read instructions in this order:** this document, `ARRIVAL-RUNBOOK.md`,
   `BOX-ARCHITECTURE.md`, `CLAUDE.md`, and the current state file. Do not rely on an older
   prompt that says `83` is public.
2. **Ask once for missing operational inputs:** Amsterdam IP/user/domain, SSH access to
   `84`, `83` and `oracleOld`, the Tanimoto dump or a transfer plan, the tonomitosql source or
   image, and runtime secrets supplied securely. Never write secrets into git, chat logs, the
   state file or command output.
3. **Perform read-only identity checks first:** DNS resolution for each production hostname,
   active listeners, systemd state, deployed SHA/build identity, Atlas connectivity, and a
   real authenticated check for both Pyxis and FinSrv. Record which host is actually public.
4. **Do not run the pre-promotion port swap blindly.** The old §8 procedure was for the state
   where `83` was public and `84` was standby. In post-promotion mode, first measure the
   listeners and the reverse proxy on **`84`**. Never move DNS or swap ports merely because §8
   exists. ⚠ Steps that say “make `83` a usable rollback host” / “sync `83`” need **owner
   confirmation after `83` shutdown** — rollback target becomes whatever the owner picks on
   `84` (see § “Before killing `83`”).
5. **Probe Amsterdam before changing it:** architecture, GPU visibility, Docker, disk/RAM,
   outbound network, inbound `443` from the application host, firewall ownership and current
   listeners. Choose the runbook's Caddy branch or reverse-tunnel branch from the measured
   result; do not assume either one.
6. **Build and validate compute services natively on Amsterdam.** Start with real CPU Vina
   docking if AutoDock-GPU is still the documented stub; validate the real service with
   `scripts/verify-docking-response.mjs`. A replay fixture is not sufficient evidence.
7. **Repoint the live production path on `84` first, one service at a time:** docking, then
   DiffDock, then convertSTR, then Tanimoto after its data restore. Verify a real request and
   credit/refund behavior after each change.
8. **Do not plan a fresh “synchronize `83`” pass.** Older wording assumed `83` stayed a
   standby. With imminent shutdown, apply Amsterdam service-link env only on **`84`**. Avoid
   double-PATCHing shared Atlas `ligandServiceConfig`. ⚠ Any remaining “mirror to `83`”
   instruction is stale pending owner confirmation of the post-kill rollback target.
9. **Restore Tanimoto and verify it from the one application host (`84`) through the real Pyxis path.**
   `83` is leftover and not DNS. Check dataset count, similarity search and the Deep Similarity
   page before considering the old Oracle removable.
10. **Leave `oracleOld` intact** until every gate in runbook §12 is green and the owner gives a
    fresh, explicit approval for the exact cleanup. Do not remove its Tanimoto containers,
    leftover Mongo volume, or source during arrival setup. Measured 2026-08-23: no
    `medsaas`/`mongo` containers and no `:27017` — do **not** start Mongo. Leave CLIProxyAPI,
    Crafty and all unrelated owner tooling alone forever.

## Stop conditions

Stop and report the measurement instead of improvising if:

- DNS still points a production hostname at `83` or points different application hostnames at
  different machines unexpectedly;
- `84` cannot reach Pyxis Atlas or FinSrv cannot complete its own authenticated DB-backed check;
- `84` (the one application host) has a different production build/env fingerprint than
  expected; `83` is leftover and not DNS;
- Amsterdam's GPU, ingress, architecture or service health does not match the acceptance test;
- a Tanimoto restore does not return the expected dataset/row count;
- a proposed action would delete data, remove a container/volume, disable a service, alter DNS,
  or change a shared database without explicit approval.

## Canonical arrival prompt after promotion

Paste this into a fresh agent session after supplying connection information:

> `84.13.81.51` (`oracleNew`) is already the live production application host after DNS
> promotion. `83.229.87.94` is **scheduled for imminent shutdown** — still may be reachable
> until teardown, but is **not** a long-lived standby; agents must not shut it down or mutate
> it. `151.145.91.17` (`oracleOld`) is the old Oracle host and temporary Tanimoto source. Do
> not reverse these roles, do not change DNS, and do not touch `oracleOld` destructively.
>
> Read `docs/POST-PROMOTION-HANDOFF.md` (including § “Before killing `83`”), then
> `docs/ARRIVAL-RUNBOOK.md` and `docs/BOX-ARCHITECTURE.md`. Probe `84` and the Amsterdam box
> before changing anything. Choose box access from §1c probe (not Tailscale-by-default). Do not
> blindly execute the pre-promotion §8 port swap: measure `84` listeners first. Validate `84`
> only for application cutovers. Build and verify Amsterdam's compute services, repoint
> docking/DiffDock/convertSTR/Tanimoto one at a time, and keep Asinex URLs as rollback values.
> MongoDB Atlas for Pyxis stays in place; FinSrv uses a separate Atlas project. Soft flip
> executed 2026-08-23 — see `docs/PYXIS-WEB-FLIP.md`; do not re-flip without a new ask.
> Stripe webhook registered 2026-08-23. Do not remove anything from `oracleOld` until all migration
> checks pass and I explicitly approve the exact cleanup commands.
