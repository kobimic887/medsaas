# Pyxis-web public flip checklist

**Status (2026-08-23):** Soft flip **executed** on `84` (nginx `:443` →
`127.0.0.1:5174`, procedure **A**). JWT rotated on maintained only. Public title =
**Pyxis Discovery**. Live `DEPLOYED_SHA` =
`c162b15…`. Rollback units **stopped** (still
**enabled**; trees stay — start before nginx rollback). Stripe webhook
**registered** (§4): `we_1U7Z6vAlVdO1Ab8fuM6HWROx` →
`https://app.pyxis-discovery.com/stripe/webhook`; secret only in maintained
`.env`. Owner live checkout + refund smoke still open
([`STRIPE_LIVE_CUTOVER.md`](./STRIPE_LIVE_CUTOVER.md) Step 4). Rollback =
start the three rollback units, then restore
`proxy_pass http://localhost:5173` + `nginx -t && reload`
(backup under `/root/pyxis-flip-backups-20260823T095238Z/`).

**Authority / related:** [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md),
[`NEXT-SESSION.md`](./NEXT-SESSION.md), [`ARRIVAL-RUNBOOK.md`](./ARRIVAL-RUNBOOK.md) §8
(adapted), [`STRIPE_LIVE_CUTOVER.md`](./STRIPE_LIVE_CUTOVER.md).

## Conflict with older “box-day only” wording — resolved

| Source | Old wording | Owner 2026-08-22 |
|---|---|---|
| Grill Q17/Q22, NEXT-SESSION | Flip on boss click-test **or** box arrival | Boss approved → **product flip now eligible** |
| ARRIVAL-RUNBOOK §8 (2026-08-01) | Keep port swap on arrival day; “do not re-raise” early flip | **Superseded for product/soft flip.** Soft flip may precede Amsterdam box. Box day remains for compute cutover (docking/DiffDock/Tanimoto), not a gate on making `pyxis-web` public |
| Unit file / §8 header | “Switching back on box-arrival day” | Same: treat as historical; product flip on `84` alone is allowed |

**Product flip ≠ box cutover.** After this flip, public still uses whatever scientific
backends `pyxis-web` already points at (e.g. Moscow/Asinex paths). Amsterdam work stays
on the arrival runbook and does not block this checklist.

---

## STOP (historical)

```
Flip mutation window closed 2026-08-23 (soft flip A executed).
Do not re-flip or rotate JWT again without a new owner ask.
Stripe webhook §4 **done** 2026-08-23 (endpoint registered + secret on maintained).
Rollback = nginx → localhost:5173 (ensure legacy units are running first).
```

Preparation language below is retained for rollback / audit.

---

## Measured baseline on `84` (2026-08-22 ~18:54 UTC) — re-measure before flip

| Check | Result |
|---|---|
| Host | `chem` / `84.13.81.51` (`oracleNew`) |
| DNS `app.pyxis-discovery.com` | `84.13.81.51` |
| Units | `pyxis-web`, `pyxis-vite-legacy`, `pyxis-api-legacy`, `pyxis-stripe` — all **active** |
| Listeners | `0.0.0.0:5173` (legacy Vite), `0.0.0.0:5174` (bun/`pyxis-web`), `:3000` chem_beo, `:3001` stripe, `:80`/`:443` nginx |
| nginx `:443` | `proxy_pass http://localhost:5173` → **public still legacy** |
| nginx `:8443` | `proxy_pass http://127.0.0.1:5174` → maintained already reachable on TLS side door |
| `BIND_HOST` | **Not set** on live `pyxis-web` unit; server code listens `0.0.0.0` (repo `BIND_HOST` in `deploy/83/systemd/pyxis-web.service` is **not** wired in `server/index.js`) |
| `DEPLOYED_SHA` | `a128e54…+molstar-bare-visit-20260821T204253Z` |
| Titles | Public `:443` → `Pyxis-Discovery \| Macrocycles` (legacy); `:5174` / `:8443` → `Pyxis Discovery` |
| `/api/health` on `:5174` | OK JSON |
| `/dashboard/literature` | HTTP 200 |
| `/api/simulation-logs` (no token) | HTTP 401 (expected) |
| Atlas | OK — `users≈55`, `companies≈1`, `simulation_logs≈21` |
| `JWT_SECRET` | Set on both stacks; **hashes differ** (dress rehearsal already isolated) |
| `STRIPE_WEBHOOK_SECRET` | **Missing** on maintained (and legacy) — register **after** flip |
| Maintained `.env` | `FRONTEND_URL`/`BASE_URL` already `https://app.pyxis-discovery.com`; `PLATFORM_NAME=Pyxis Discovery`; systemd `PORT=5174` overrides `.env` `PORT=5173` |
| FinSrv | Separate (`:4000`) — **out of scope** |

Re-run the preflight block below immediately before any mutation; do not trust this table alone.

---

## Preferred procedure: product-only soft flip on `84`

Two valid shapes. Prefer **A** for a soft flip without box day.

### A — Nginx only (recommended soft flip)

Leaves processes on current ports. Instant rollback = one nginx line.

1. Complete **Preflight** and **JWT rotation plan** (secret prepared, not necessarily applied until cutover minute).
2. Edit nginx for `server_name app.pyxis-discovery.com` on **`:443`**: change
   `proxy_pass http://localhost:5173` → `proxy_pass http://127.0.0.1:5174`.
3. `nginx -t && systemctl reload nginx` (owner-approved mutation window only).
4. Do **not** change DNS. Do **not** touch FinSrv server blocks.
5. Leave legacy Vite on `:5173`, `chem_beo` on `:3000`, `pyxis-stripe` on `:3001` **running** for rollback.
6. Optional hygiene (same window or immediately after smoke): firewall or stop publishing
   cleartext `0.0.0.0:5174` if still unwanted; `:8443` can stay as an alternate TLS entry or be
   retired later — owner call.

### B — Classic port swap (ARRIVAL §8 adapted for post-promotion / no box)

nginx stays on `:5173`; processes swap.

1. `pyxis-web`: `Environment=PORT=5173` (and do not rely on unused `BIND_HOST` unless code grows support).
2. `pyxis-vite-legacy`: append `-- --port 5174` to `ExecStart`.
3. `daemon-reload && restart pyxis-web pyxis-vite-legacy`.
4. Confirm `ss`: **bun on 5173**, **node on 5174**.
5. Smoke public `:443` (still → 5173, now maintained).

**Do not** perform §8 on `83` (imminent shutdown). **Do not** wait for Amsterdam for this product flip.

---

## What stays on legacy temporarily (soft flip)

| Component | Soft flip (A or B stage 1) | Later |
|---|---|---|
| Public UX + API | **Maintained `pyxis-web`** | — |
| `pyxis-vite-legacy` | **Stopped** 2026-08-23 (enabled; tree stays) | Start only for nginx rollback |
| `chem_beo` `:3000` | **Stopped** 2026-08-23 (enabled; tree stays) | Same |
| `pyxis-stripe` `:3001` | **Stopped** 2026-08-23 (enabled; tree stays) | Same |
| Scientific backends | Unchanged (Moscow/Asinex/etc. as already configured) | Amsterdam cutover on box day |
| Stripe webhook | **Registered** 2026-08-23 (`we_1U7Z6vAlVdO1Ab8fuM6HWROx`) | Owner live checkout smoke still open — [`STRIPE_LIVE_CUTOVER.md`](./STRIPE_LIVE_CUTOVER.md) Step 4 |
| FinSrv | Untouched | Untouched |

---

## Ordered checklist (execute only after “do the flip now”)

### 0. Preflight measure on `84` (read-only)

```bash
ssh ubuntu@84.13.81.51   # or ssh oracleNew / ssh 84
systemctl is-active pyxis-web pyxis-vite-legacy pyxis-api-legacy pyxis-stripe
ss -ltnp | grep -E ':(80|443|3000|3001|5173|5174)\s'
sudo cat /root/pyxis-LIVE-5174/DEPLOYED_SHA
curl -sS -m 5 http://127.0.0.1:5174/api/health
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/dashboard/literature
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/api/simulation-logs
# Atlas: estimated counts via maintained tree (sudo); expect companies=1
sudo nginx -T | grep -nE 'server_name app.pyxis|proxy_pass|listen 443|listen 8443'
getent hosts app.pyxis-discovery.com   # expect 84.13.81.51
```

Abort if Atlas fails, `pyxis-web` inactive, or `DEPLOYED_SHA` is missing/unexpected.

### 1. JWT_SECRET rotation plan (Q13=A)

- Generate a **new** secret (≥32 chars), distinct from both current hashes.
- Write only into `/root/pyxis-LIVE-5174/server/.env` (`JWT_SECRET=…`).
- Restart `pyxis-web` in the same flip window (after or with nginx/port change).
- **Effect:** every session invalid; all users (and demo) must **sign in again**.
- Do **not** copy the new secret into `chem_beo` (legacy rollback keeps its own secret).
- Never print the secret into chat, git, or docs.

### 2. Cutover (choose A or B above)

Owner picks A or B at go-time. Record which in the session notes.

### 3. Post-flip smoke (public `https://app.pyxis-discovery.com`)

1. HTML title / branding = **Pyxis Discovery** (not Creative Tim Macrocycles banner).
2. Sign in (or demo) — account menu session sticks; no surprise logout loop.
3. Dashboard home loads.
4. Simulation: search → dock **if Moscow/current path still works** → results → viewer handoff.
5. Control Panel / simulation history (dual-shape `simulation_logs`).
6. Literature: example query returns rows or honest empty.
7. Plans & Credits page renders (no live purchase required for smoke).
8. Hard refresh / one private-window sign-in after JWT rotate.

### 4. Stripe webhook **after** flip (Q14=A) — **done 2026-08-23**

- Followed [`STRIPE_LIVE_CUTOVER.md`](./STRIPE_LIVE_CUTOVER.md).
- Listed first — no duplicate; created
  `we_1U7Z6vAlVdO1Ab8fuM6HWROx` → `POST https://app.pyxis-discovery.com/stripe/webhook`.
- `STRIPE_WEBHOOK_SECRET` in maintained `/root/pyxis-LIVE-5174/server/.env`; restarted
  `pyxis-web` only.
- Remaining: optional owner Standard ($20) checkout + refund to prove live delivery.

### 5. Rollback

**If soft flip A (nginx):**

1. `systemctl start pyxis-vite-legacy pyxis-api-legacy pyxis-stripe` (units are
   enabled but **stopped** since 2026-08-23). Wait until `:5173`/`:3000`/`:3001` listen.
2. Restore `proxy_pass http://localhost:5173` on `:443`.
3. `nginx -t && systemctl reload nginx`.
4. Public is legacy again (Creative Tim). JWT on maintained is irrelevant to public.
5. ⚠ Rollback **re-opens** ~60 unauthenticated `chem_beo` routes on the public path.

**If port swap B:**

1. Reverse PORT assignments; restart both units; confirm `node` on 5173 / `bun` on 5174.
2. Same security cost as above.

Do **not** delete legacy trees. Do **not** DNS-flip anywhere as “rollback.”

---

## Blockers / watch-outs before saying go

| Item | Flip blocker? | Notes |
|---|---|---|
| Boss approval | Was | **Cleared 2026-08-22** — approved, not executed |
| Amsterdam box | **No** | Soft/product flip may precede box |
| `BIND_HOST=127.0.0.1` | **No** (docs were stale) | Live already `0.0.0.0:5174`; code ignores `BIND_HOST`. Hygiene issue, not a gate |
| JWT rotate procedure | Ready | Need new secret at go-time; already different across stacks |
| `STRIPE_WEBHOOK_SECRET` unset | **No** | Intentional until after flip |
| Atlas / `:5174` health / literature / simulation-logs | Must stay green at preflight | Measured OK 2026-08-22 |
| Stale `DEPLOYED_SHA` vs desired tree | Soft | Refresh `:5174` deploy if owner wants newer commits before flip |
| Mail password still exposed historically | Owner-only | Not a product-flip gate; rotate at yourhosting.nl when able |
| FinSrv | N/A | Do not touch |
| Owner go phrase | **Yes until spoken** | Without “do the flip now”, agents only prepare |

---

## Grill decisions that still apply on flip day

- Legacy intentionally unimproved until cutover.
- JWT rotate on flip; Stripe webhook after flip.
- Shared Atlas; no Mongo dump/replace.
- No DNS change for this product flip (already on `84`).
- `chem_beo` patch never applied — flip is the remediation; rollback re-exposes it.
