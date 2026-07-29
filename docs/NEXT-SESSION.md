# What to do next

## ⏱ PICK UP HERE — session ended 2026-07-29

**Production is untouched and working.** Legacy Vite on 5173, `chem_beo` on 3000,
`stripe-server` on 3001, `pyxis-web` **disabled**, `https://app.pyxis-discovery.com` → 200.
Nothing was cut over. No rehearsal process left running.

**Release A is staged at `/root/pyxis` on 83, re-staged to `f9a2547` and re-rehearsed
2026-07-29 21:40 UTC.** Source, `client/dist`, deps, and `server/.env` whose `JWT_SECRET`
was generated on the box (backed up to `/root/pyxis-secrets/pyxis-web.env.bak`).

⚠ **It was stale when this note was first written.** The staged `server/index.js` hashed to
exactly **`5bc88ed`**, so it was missing `dcd0814` — meaning `/api/activity` there still
projected `email: 1` and *enabling it would have shipped the colleague-email leak*, plus the
dark-on-dark notifications. `client/dist` was worse than stale: built from an uncommitted
working tree at 18:02, so it matched no commit at all. **Both replaced.** All **346** tracked
files under `/root/pyxis` are now byte-identical to `f9a2547`, and `/root/pyxis/DEPLOYED_SHA`
records it so this never needs hand-investigating again.

Verify a re-stage took with one line — it must print `86fbfdf67080915b`:

```bash
ssh root@83.229.87.94 'sha256sum /root/pyxis/server/index.js | cut -c1-16'
```

### The one command that ships it

```bash
systemctl disable --now pyxis-vite-legacy && systemctl enable --now pyxis-web
```

Rollback is the same inverted. Only user-visible effect: everyone signs in once more,
because `JWT_SECRET` legitimately changes (that is the fix for `chem_beo` signing with the
literal string `secret`).

⚠ **Never `rm -rf /root/pyxis` to re-stage.** `server/.env` (the box-generated `JWT_SECRET`,
which exists nowhere else) and `server/node_modules` are untracked, so a wipe destroys them and
the one command above stops working. Stage **over the top** — `git archive HEAD | ssh … tar -x
-C /root/pyxis` touches neither — and replace `client/dist` wholesale. Build the dist with
`COPYFILE_DISABLE=1` when tarring from a Mac; the previous copy left 53 AppleDouble `._*` files
being served as static assets.

⚠ **A failed boot takes the site down and keeps it down.** `pyxis-web` has
`Conflicts=pyxis-vite-legacy` **and** `Restart=always`, so if it cannot start, 5173 is left
unowned and retried every 5s with nginx proxying to nothing. That is why the 5199 rehearsal is
the gate, not the cutover.

### Do these two first — they are small and they are the reason to hurry

1. **Cap `tester123`'s credits.** Still **99,998** (verified on Atlas 2026-07-29 21:39 UTC) and
   its password is still readable at
   `https://app.pyxis-discovery.com/src/pages/auth/sign-in.jsx` — verified 200, lines 23–24.
   The new server never reads that password, so rotating it breaks nothing.
2. **Enable the unit.** The re-stage is done.

### What the dashboard test found — all fixed, all committed

| Found | Status |
|---|---|
| Built frontend served a **blank white page** through a tunnel — CORS refusal threw, so every `/assets/*.js` 500'd | fixed, `5bc88ed` |
| Every page footer credited **"Outwize inc"** with four links to their site | fixed, `5bc88ed` |
| Notifications text was **dark-on-dark, unreadable** | fixed, `dcd0814` |
| Activity feed leaked **every colleague's email address** to any member, including the public demo account | fixed, `dcd0814` |

**Verified working against real Atlas:** sign-in, demo session, Control Panel (5 real records),
Simulation (Ketcher loads), Simulation Results (Molstar initialises), RDKit Visualiser
(renders ethanol), Deep Similarity (`/tanimoto/v1/search/exact` → 200 via Oracle), Protein
Folding, Generate Molecules, Dashboard (real counts, charts render), Profile, GROMACS,
Notifications. **No console errors on any page.**

`gromacs-md` and `glioblastoma-predict` are deliberately `hideFromMenu` — they are not
deployed yet and light up when the box arrives.

### Known cosmetic, not fixed, not blocking

- **Profile page** carries Creative Tim filler: fake contacts (Sophie B., Alexander, Ivanna)
  with stock photos and dead REPLY buttons, plus social-network toggles ("Email me when
  someone follows me"). Non-functional decoration on a chemistry product.
- **Dashboard** chart captions are template text — "Last Campaign Performance Graph2",
  "campaign sent 2 days ago".

Both are removals of dead content rather than layout changes, but they were left alone
because the standing instruction is not to move things users recognise. Worth a decision.

### Still open for the box, unchanged

DiffDock has no implementation (only a captured contract) — biggest gap. ADMET and
glioblastoma have never run. GROMACS is still a CPU-only apt build. Tanimoto restore proof
written (`scripts/verify-tanimoto-restore.sh`) but needs Docker, so run it on the box. Caddy
config not written. sm_120/cu128 wheel check not done.

---

Written 2026-07-29. Delete this file once the box has arrived and Release B is done —
it is a handoff note, not a document.

Read this first, then [`ARRIVAL-RUNBOOK.md`](./ARRIVAL-RUNBOOK.md).

---

## The plan, in one table

Everything ships as **v2, announced on box arrival day**. One item *deploys* earlier than it
is *announced*, and that is the only deviation from "deploy everything on arrival day".

| # | Item | Deploy when | Needs the box? |
|---|---|---|---|
| **A** | **Server swap** — this repo's `server/index.js` + `client/dist` take over port 5173 | **Before the box.** Any day. | **No** |
| B1 | Docking to the box | Arrival day | Yes |
| B2 | convertSTR to the box | Arrival day | Yes |
| B3 | Tanimoto to the box | Arrival day | Yes |
| B4 | GROMACS, CUDA build | Arrival day | Yes |
| B5 | ADMET worker, first ever deploy | Arrival day | Yes |
| B6 | Glioblastoma, first ever deploy | Arrival day | Yes |
| — | Announce **v2** | Arrival day | — |

### Why A moves earlier, and it is only this one reason

A has **no dependency on the box**. It is this repo, Atlas, and Asinex — all of which exist
today. It could have shipped a month ago.

If A ships on the same day as B1, and docking then looks broken, there are two suspects
producing one symptom: the new server, or the new docking service. Rollback becomes two
rollbacks in an order nobody established in advance.

Concretely: the "**The docking run returned no readable poses**" message added in `c9ce8d5`
lives in **this repo's** `client/`. Production currently serves a different codebase
(`/root/material-tailwind-dashboard-react`). That message therefore does not exist in
production until A ships. It is the clearest early warning that a box cutover produced a
malformed SDF — so shipping A and B1 together removes the warning light on the one day it is
most needed.

Nobody outside sees when A landed. The v2 announcement is still arrival day.

---

## What is left. Start here.

Everything below this section is context. These are the open items, in order.

> **Changed 2026-07-29 — the de-SaaS work is done, and it moved a gate.** The owner chose to
> rebrand **before** the cutover, and steps 1–5 of `PYXIS-ONLY.md` §5 are applied: marketing
> site and sign-up page deleted, signup 403 by default, accounts invite-only, plan checkout
> admin-only, product renamed to Pyxis Discovery. Ten commits, `387cbcd`..`01dd134`.
>
> **The consequence, and it is the item people will forget:** the route-parity and rollback
> evidence measured earlier on 2026-07-29 was gathered against the **pre-rebrand** frontend.
> It no longer describes what would ship. **It has to be gathered again before the cutover**,
> and `scripts/verify-server-swap-parity.mjs:45` reads `/root/pyxis-release-a/.env` — that rig
> was deleted after the last run, so this means standing it back up, not re-running a script.
> Two of the new differences are intended and predicted: `/api/signup` now answers 403 where
> `chem_beo` answers 200/400, and `/create-checkout-session` is admin-only.
>
> Also settled: the box is reached by **public hostname over HTTPS, no VPN** (ARRIVAL-RUNBOOK
> Phase 3.1), and the earlier claim that `assertConfiguredUrlsArePublic` blocks the cutover is
> **retracted** — one call site, admin-UI only. The Tanimoto cartridge image is pinned to a
> verified Postgres 17 tag, and `scripts/verify-tanimoto-restore.sh` proves the restore in one
> command (needs Docker; run it on the box).

0. ✅ **Re-staged and re-rehearsed 2026-07-29 21:40 UTC. Release A is ready to enable.**

   `/root/pyxis` holds the source at `f9a2547` (all 346 tracked files byte-identical),
   a `client/dist` rebuilt from that same clean tree, installed server deps, and
   `server/.env` — Atlas URI, Stripe and mail carried over from `chem_beo`,
   `JWT_SECRET` **freshly generated there and never transmitted** (64 chars),
   `DEMO_USERNAME=tester123`.

   Booted on spare port **5199** against real Atlas and checked:

   | Check | Result |
   |---|---|
   | `GET /health` | 200 `{"status":"OK"}`. **Note:** plain `/health` is static — `/health/db` is the one that reports Atlas. An earlier draft claimed `/health` returns `dbName: test`; it does not |
   | `GET /` | 200, built frontend titled *Pyxis Discovery* |
   | `POST /api/signup` | **403** — de-SaaS gate holds |
   | `GET /api/demo-session` | 200 `{"available":true}` — proves `DEMO_USERNAME` resolves at *runtime*, not just that the key is in the file |
   | `POST /api/demo-session` | 200, working token, keys `message,token,user`; no password and no hash (`mustChangePassword: false` is the only string matching `/password/`) |
   | `GET /api/activity` as the demo **member** | 200, 9,488 bytes, keys `users,projects,simulations`, **zero `"email"` fields and zero email-shaped strings** — the `dcd0814` fix, tested through the exact path that leaked |

   No errors in the boot log. Rehearsal torn down, 5199 released, 5173 still owned by
   pid 2166445 (legacy Vite), `pyxis-web` still `inactive`.

   **The unit's own environment was proven separately, and this is the distinction that
   matters.** The run above was an interactive shell with `PORT`/`FRONTEND_DIST` passed on the
   command line, which proves the *app* works, not the *unit*. `pyxis-web.service` has **no
   `EnvironmentFile`**, so its boot depends entirely on `server/index.js` finding `server/.env`
   via `WorkingDirectory`, under `NoNewPrivileges=true` and a stripped systemd environment.
   Re-run as a transient unit with the same properties, only the port changed:

   ```bash
   systemd-run --unit=pyxis-probe --collect \
     -p WorkingDirectory=/root/pyxis/server -p NoNewPrivileges=true -p Type=simple \
     -p Environment=PORT=5199 -p Environment=FRONTEND_DIST=/root/pyxis/client/dist \
     /usr/local/bin/bun index.js
   ```

   Result: bound 5199, `/health` 200, **`/health/db` 200 `{"database":"connected",
   "dbName":"test","collections":5}`**, `/` titled *Pyxis Discovery*, `/api/signup` 403,
   `/api/demo-session` `{"available":true}`. Probe stopped, 5199 released, `app.pyxis-discovery.com`
   still 200. **`Conflicts=` + `Restart=always` means a failed boot leaves 5173 unowned and
   retrying — so run this probe again after any re-stage, before enabling.**

   Atlas state at the same moment, read-only: 50 users, **0 without `companyId`**, 1 company,
   `simulation_logs` 5/5 carrying `companyId` **and** both nested and top-level `username` —
   so both migrations are genuinely applied and a rollback to `chem_beo` can still read them.

   Parity: **17 routes, 4 differences — the same four as the first run**, so the de-SaaS work
   added none. The check that actually matters passed: legacy and the new server derive the
   **identical docking cache key** and both returned the stored record, so no dock ran and no
   credit was spent. That is the double-charge / invisible-results failure mode, and it is clean.
   The two expected deltas sit outside those 17 and were checked directly — `/api/signup`
   200→403, `/create-checkout-session` 500→401.

   Rehearsal torn down. **`pyxis-web` is still `disabled`, the legacy Vite still owns 5173, and
   `https://app.pyxis-discovery.com` still answers 200.** Nothing user-facing has changed.

   **⚠ Two things found while doing this.**
   - The legacy `/api/signup` check returned **200 and created a real account** in production
     Atlas. It was deleted (back to 50 users, 1 company). Anyone can do this right now; it stays
     true until this ships.
   - **`tester123` holds 99,998 simulation credits**, and its password has been readable in the
     legacy page source for as long as that frontend has been up. Cap the balance and rotate
     the password. The new server never reads that password, so rotating it breaks nothing.

   **The cutover is now one command**, and its only user-visible effect is that everyone is
   signed out once, because `JWT_SECRET` legitimately changes:
   ```
   systemctl disable --now pyxis-vite-legacy && systemctl enable --now pyxis-web
   ```
   Rollback is the same command inverted; `deploy/83/systemd/README.md` has it.

   **Sign-in was compared against live production on 2026-07-29** — the one page every user
   sees, and the only part of the UX pass that does not need a login. Findings:

   | | Legacy (live) | This repo | Verdict |
   |---|---|---|---|
   | Pyxis wordmark | real inline-SVG logo | was gradient **text** | **fixed** — logo recovered, `29dd2c7` |
   | Forgot password | `href="#"` — **dead link** | working reset flow, covered by tests | **better** |
   | Create account | links to `/auth/sign-up` | removed | intended (invite-only) |
   | Proceed to Demo | public credentials, see §0c | **present**, server-side auth | **kept, and fixed** |
   | Newsletter checkbox | present | absent | accepted loss; nothing consumes it |
   | Theme | light | dark | different, not worse |

   **What was NOT checked: everything behind the login.** The thirteen dashboard pages, the
   compound cart, and the docking result view have not been compared. That needs an account
   and is the rest of this item.

   **Two things this comparison settled that were open questions.** There *is* a real public
   marketing site — `www.pyxis-discovery.com`, a separate WordPress with Discover Macrocycles
   / Services / About us / Insights / Pricing / Contact. So deleting this repo's marketing
   pages removed a **duplicate** of a better site, not the only copy, and PYXIS-ONLY.md §6's
   "will there be a public marketing site at all?" is answered: yes, and it already exists.
   Second, that site enters the app through its **web-shop** link, which points at
   `https://app.pyxis-discovery.com/auth/sign-in` — the exact route this repo kept, so the
   external entry point survives the cutover unchanged.
1. **Rotate `JWT_SECRET` on `chem_beo`.** Still signing with the literal string `secret` — §0.
   One `.env` line plus `systemctl restart pyxis-api-legacy`. It logs every user out, which is
   why it was not done unannounced.
2. **Rotate the mail password.** `EMAIL_PASS` was readable at
   `https://app.pyxis-discovery.com/.env` for roughly twenty minutes on 2026-07-29 (§0b).
   Also rotate `STRIPE_SECRET_KEY` in `/root/pyxis-secrets/stripe-server.env` — that one was a
   **test** key and was exposed far longer, since before this session.
3. **Grant credits.** 47 of 50 users now hold `simulationTokens: 0`. They had no such field
   before, so nothing changed for them — but they cannot run anything, and the new server says
   "No simulation tokens left" rather than explaining why.
4. **Apply `deploy/chem_beo/01-fixes-and-config.patch`.** Unchanged from before.
5. **Then cut over** — `systemctl disable --now pyxis-vite-legacy && systemctl enable --now
   pyxis-web`, after copying this repo and a locally-built `client/dist` to `/root/pyxis`.
   `deploy/83/systemd/README.md` has the exact commands and the rollback.
6. Hand `chem_beo` to systemd too (`systemctl start pyxis-api-legacy`) — it is the last process
   still hand-started in a `screen`, so a reboot still stops the API. Left alone here because it
   means restarting the live API.

Not started, and not blocking: DiffDock (`deploy/box/diffdock/` has only the captured contract),
ADMET, glioblastoma, Claude Science OAuth, and the marketing-copy half of the ChemBench→Pyxis
rename.

### What is still missing for arrival day — audited 2026-07-29

Everything here is doable **without the box** and every one of them is on arrival day's critical
path if it is not done first.

1. **How 83 reaches the box is undecided.** `compose.yml` binds `${BIND_ADDR:-127.0.0.1}` and
   no ingress exists. **Every cutover URL in `deploy/box/.env.example` depends on this.**

   **DECIDED 2026-07-29: no VPN, no tunnel.** Earlier comments floated "WireGuard/Tailscale";
   that was a suggestion in a code comment, never a decision, and it is rejected — it adds a
   third-party account and a daemon on both machines to solve a problem TLS already solves.

   **The box is reached exactly the way Asinex is reached today: a public hostname over
   HTTPS.** Production already calls `https://services.asinex.com:8000/docking` across the
   public internet; the box replacing it the same way is a true 1:1, and rollback is putting
   the Asinex hostname back.

   Shape: every service binds `127.0.0.1`, one Caddy/nginx on `:443` with a Let's Encrypt cert
   for a box hostname, and a host firewall allowing **only 83's IP** to reach `:443`. One open
   port, one certificate, one allowlist entry. The "⚠ NONE of these may be exposed to the
   internet" warning in `compose.yml` is satisfied by the firewall, not by a tunnel.
2. ~~`assertConfiguredUrlsArePublic` makes Release A the harder path.~~ **WRONG — retracted
   2026-07-29.** The guard at `server/index.js:1413` is called from **one** place (line 1325),
   on `company.ligandServiceConfig` — the admin-UI path. The environment variables that
   actually carry the cutover (`TANIMOTO_API_BASE`, `SDF_CONVERTER_URL`,
   `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL`, `server/index.js:80-88`) are read straight
   from `process.env` and never validated. Env-var cutover works identically on both servers.
   With the public-hostname decision in item 1 the question is moot regardless: a public
   address passes the guard anyway, so even the admin-UI path stays open.
3. **The Tanimoto dump is PostgreSQL 17.5, archive format 1.16.** Read straight out of the
   header of `~/backups/tanimoto/tonomitosql-20260729.dump`: `17.5 (Debian 17.5-1)`. Its
   `CREATE EXTENSION rdkit` needs the cartridge too. `informaticsmatters/rdkit-cartridge-debian`
   has historically shipped **older** majors, and an older `pg_restore` refuses a 1.16 archive
   outright — `unsupported version (1.16) in file header`. A verified sha256 is not a verified
   restore. Either pin a PG 17 cartridge image or re-dump `--format=plain`. Runbook §4.3 says
   "prove it restores"; that has not happened.
4. **sm_120 is the item most likely to miss the day, and it is checkable today.** RTX 5090 is
   Blackwell — CUDA 12.8+. AutoDock-GPU is a compile flag, tractable. **OSS DiffDock is a
   dependency-graph problem**: check whether cu128 wheels exist for the torch / torch-geometric
   versions it pins. If they do not, there is no build, and that is worth knowing weeks out.
5. **ADMET needs a decision, not a flag.** `services/admet/` is `amqpadmet.py` — RabbitMQ.
   `compose.yml` asserts it polls a Mongo job collection (BOX-ARCHITECTURE §5). One of the two
   has to change. Keeping CloudAMQP for the first deploy is legitimate: nothing regresses either
   way, because the worker has never run at all.
6. **`compose.yml`'s `x-gpu` anchor reserves no `device_ids`** — just `driver: nvidia,
   capabilities: [gpu]`, with `NVIDIA_VISIBLE_DEVICES` set per service. That combination is
   version-dependent; docking and diffdock can both end up seeing both cards. Use
   `device_ids: ['0']` / `['1']` in the reservation. Note `admet` is pinned to device 1 next to
   diffdock.
7. **GROMACS is still `apt-get install gromacs` on `ubuntu:22.04`** — CPU-only. Moving that image
   to the box buys nothing; it needs a `-DGMX_GPU=CUDA` source build to be worth the move.
8. ~~**`services/glioblastoma-predictor/chemtest_tech_private.key` is committed to git.**~~
   **Corrected 2026-07-29 — it is not, and never was.** `.gitignore:45` ignores
   `services/glioblastoma-predictor/*.key`, `git log --all` on the exact path is empty, and
   `git rev-list --all --objects` finds no `.key` blob on any branch or tag. So there is nothing
   leaked and nothing to rotate for that reason.

   **The real problem is the opposite one:** the key exists only as an untracked local file on
   the dev Mac, and `Dockerfile:14` does `COPY chemtest_tech_private.key /app/`. A build on the
   box therefore **fails outright** unless that key is transferred out of band first. That is a
   missing-artifact item on B6, not a security item. It still sits behind the
   `glioblastoma-key-rotated` profile so it cannot start by accident.

**Two of the six B-items have no 1:1 to hold, and that is fine.** DiffDock is *already broken in
production* (`SDF_CONVERTER_URL` → `83:8001`, nothing listening), so the box's convertstr is a
fix, not parity. ADMET and glioblastoma have **never run** — first deploy, not migration.

**The rungs that make arrival day short already exist.** `DOCKING_ENGINE=replay` returns the
committed reference payload with no GPU, and `vina` is real chemistry on CPU — both work today on
any x86_64 host. So the day is: bring the service up on `replay`, verify 83 → box → client end to
end through the real UI, flip to `vina`, then to `autodock-gpu`. `AutoDockGpuEngine` raising
`DockingUnavailable` until qualification is deliberate, and `/health` fails while it is selected,
so a half-built engine cannot silently take traffic.

---

## 0. Live vulnerabilities, found 2026-07-29. Read before anything else.

### 0c. "Proceed to Demo" hands anyone a working production session

The production sign-in page has a prominent **Proceed to Demo** button. Its handler signs in
with credentials hard-coded in the component:

```
const handleDemoLogin = async () => {
  setEmail("tester123");
  setPassword("Tester!23");
```

Production serves that frontend from a **Vite dev server**, so the file is fetchable
unminified at `https://app.pyxis-discovery.com/src/pages/auth/sign-in.jsx` — no button click
or bundle archaeology needed. The account is a real one on the real database, so anyone who
loads the page gets an authenticated session and whatever credits `tester123` holds.

It also fetches `https://api.ipify.org` on that path, which tells a third party the IP of
everyone who signs in this way.

**The button stays. It is a wanted feature — owner, 2026-07-29 — and removing it is exactly
the kind of change that makes returning users stop recognising the product.** An earlier draft
of this section recommended deleting it; that was wrong and is retracted.

**Fixed by moving the credential, not the button** (`server/index.js`, `POST /api/demo-session`).
The server looks the demo account up from `DEMO_USERNAME` and issues an ordinary session; the
browser never receives a password, and the demo account's password can now be rotated to
something nobody knows without touching the frontend. The `api.ipify.org` call is gone with it.
`GET /api/demo-session` reports whether a demo is configured, so the button hides itself rather
than erroring on a deploy that has no demo account.

Same label, same action, and it sits under the sign-in form instead of above the title — the
one placement change, so it stops competing with the sign-in that returning users came for.

**Two things still to do on production, neither of them code:**
1. **Set `DEMO_USERNAME`** in the new server's env, or the button will not appear after cutover.
2. **Rotate `tester123`'s password.** It has been readable in page source for as long as the
   legacy frontend has been up, so treat it as public. The new endpoint never reads it, so
   rotating it breaks nothing.

Until Release A ships, the legacy page still leaks it — that is an argument for shipping, not
for editing the legacy frontend.

### 0a. The two original ones

**Production JWTs are signed with the literal string `secret`.** `chem_beo:1049` is
`jwt.sign({username}, process.env.JWT_SECRET || 'secret', {expiresIn: '1d'})`, and `chem_beo`'s
`.env` sets no `JWT_SECRET`, so the fallback is what is live. Verified by minting a token with
`'secret'` and using it against the production API — it authenticated. **Anyone can forge a valid
token for any of the 50 accounts**, on an API that is internet-facing on `:3000`.

This reframes the "rotate `JWT_SECRET`" gate below. It is not cutover hygiene; it is the fix. And
Release A fixes it as a by-product, because this repo's server refuses to start without a real
one ≥32 characters.

### 0b. `https://app.pyxis-discovery.com/.env` served the file publicly — ✅ closed 2026-07-29

`/root/material-tailwind-dashboard-react/vite.config.js` set `server.fs.deny: ['.git',
'.git/**']`. **`fs.deny` replaces Vite's defaults rather than extending them**, and the defaults
are what block `.env` — so overriding it with only the `.git` patterns handed the file to anyone
who asked for it, through the public HTTPS site.

It held `STRIPE_SECRET_KEY` (a **test** key, exposed since long before this session) and, for
about twenty minutes, `EMAIL_PASS` — added while fixing the contact form, before this was known.
**Rotate the mail password**, and the Stripe test key.

Fixed three ways: every non-`VITE_` value moved to `/root/pyxis-secrets/stripe-server.env`
(mode 600, outside the webroot) and loaded via the unit's `EnvironmentFile`; `fs.deny` restored
to `['.env', '.env.*', '*.{crt,pem,key}', 'custom.secret', '.git', '.git/**']`; and backups of
the old file moved to `/root/pyxis-backups/`. Verified: all `.env` paths now return **403**.

Note Vite had the old contents cached in memory — its own `server.watch.ignored` covers
`**/.env*`, so editing the file on disk changed nothing until the process restarted. That
restart is what put `:5173` under systemd.

**`:3001` was an open mail relay — ✅ fixed 2026-07-29.** `stripe-server.cjs`, in *no* document
until now, running from `/root/material-tailwind-dashboard-react` since 2026-07-02 and reachable
from the public internet. Its unauthenticated `POST /api/send-email` took an arbitrary
`recipientEmail` and sent through the company mailbox. The three patches in `deploy/83/` pin the
destination server-side, rate-limit both mail routes per client IP plus globally, and make
`/api/test-email` answer only to localhost.

⚠ **Do not kill the process.** The live Vite dev server proxies `/api` → `127.0.0.1:3001`
(`vite.config.js`), so it is the contact form's backend *and* part of the rollback path. It now
runs under `systemd` as `pyxis-stripe`. Release A retires it properly: every route it serves
exists in this repo's server behind authentication and rate limiting, and
`/api/issueSimulationTokens` there requires a company admin.

Two things still open on it, neither reachable from the app (the deployed frontend calls
`chem_beo` on `:3000` for both): unauthenticated `POST /api/issueSimulationTokens`, which returns
success without touching the database, and Stripe session creation with a **client-supplied
`price`**. Both die with the process at Release A.

**And it had never worked.** The transport was hardcoded to `smtp.titan.email`. This account is
not on Titan — `EMAIL_HOST` is `server028.yourhosting.nl:587`, and Titan answers
`535 5.7.8 authentication failed` on 465 and 587 alike. **Every contact-form submission since the
page shipped failed**, and the visitor saw a generic error. Fixed and verified by sending a real
message. `server/utils/emailService.js` had the same hardcoding and only worked because the real
host appeared once, by accident, in its fallback list — also fixed, along with the `debug/logger:
true` that was writing the `AUTH PLAIN` line (the mailbox credentials) into the log on every send.

---

## Do these now — no box required

### 1. Ship Release A

Full steps: **`ARRIVAL-RUNBOOK.md` Phase 5**. Gate status as of **2026-07-29**, measured on
production, not assumed:

| Gate | State |
|---|---|
| Response shapes verified route by route, both servers live | ✅ **done** — 17 routes, 4 explained differences, none blocking. See below |
| Rollback proven to start | ✅ **done** — a second Vite booted on `:5199` from `/root/material-tailwind-dashboard-react`, served 200, production untouched |
| Rehearsal on a spare port against real Atlas | ✅ **done** — `/root/pyxis-release-a`, port 5199, `bun index.js` + `client/dist` |
| `scripts/migrate-legacy-users.mjs` | ✅ **applied.** 49 documents written; verify says 0 users without `companyId`, 0 with unusable tokens |
| `scripts/migrate-legacy-simulation-logs.mjs` | ✅ **applied.** 5 documents; `user.username` left in place on all 5, and `chem_beo` re-verified afterwards — history, activity and the cache hit all still work |
| Staged deploy matches HEAD | ✅ **done 2026-07-29 21:39 UTC** — 346/346 tracked files byte-identical to `f9a2547`, `client/dist` rebuilt from the same tree, `DEPLOYED_SHA` recorded |
| Rotate `JWT_SECRET` | ⏳ **not done, and it is a live vulnerability — see §0.** Re-verified: `/root/chem_beo/.env` has no `JWT_SECRET` key at all, and `chem_beo/index.js:1049` still reads `process.env.JWT_SECRET \|\| 'secret'` |
| Rotate `EMAIL_PASS` and the Stripe test key | ⏳ **not done.** `/root/chem_beo/.env` mtime is **2026-04-02** — a file untouched since April cannot hold a July-rotated secret. So either the credential exposed on 2026-07-29 is still live at the provider, or it *was* rotated there and `chem_beo`'s outbound mail is silently broken right now. Both need closing |
| Cap `tester123` credits | ⏳ **not done** — still 99,998 |
| Grant credits to the other users | ⏳ **not done** — 47 of 50 hold `simulationTokens: 0`, 3 hold > 0 |
| `chem_beo` patch applied | ⏳ **not applied** — `/root/chem_beo/index.js` mtime is **2026-03-26** and greps 0 occurrences of `ASINEX_DOCKING_API_URL` / `DOCKING_API_URL` |
| Cutover | ⏳ **not done.** `pyxis-web` `disabled`/`inactive`; `pyxis-vite-legacy` active on 5173; `https://app.pyxis-discovery.com/src/pages/auth/sign-in.jsx` still returns **200** with the demo credential in plain source |

**Both migrations ran on 2026-07-29**, users first, in one window, after a logical snapshot of
`users`, `companies` and `simulation_logs` — kept on 83 at `/root/pyxis-migrate/backup-<stamp>/`
with a `restore.mjs` beside it that replaces documents by `_id` rather than emptying the
collection. **47 of the 50 users now hold `simulationTokens: 0`**, which is deliberate: the
migration does not invent credits. They had no such field before, and `chargeSimulationToken`
filters `{$gt: 0}`, so nothing changed for them — but grant credits before telling anyone the new
server is live.

If they ever need re-running: **`node`, not `bun`** — `mongodb`'s bson calls
`node:v8 isBuildingSnapshot`, unimplemented in Bun 1.3.12, and the script dies on import. They
also need `mongodb` resolvable, which a bare checkout does not have; on 83 that was
`ln -s /root/chem_beo/node_modules node_modules`.

**Why the second migration exists.** `migrate-legacy-users.mjs` opens a gap it does not close.
The moment every user has a `companyId`, `buildTenantFilter` stops taking its legacy branch and
filters on `{companyId}` — but every `simulation_logs` document was written by `chem_beo`, which
nests `user.username` and writes no `companyId`. Verified on Atlas: 5 documents, 5 nested, 0 with
either field. So dock history vanishes and `/api/simulation`'s cache lookup
(`server/index.js:3165`) misses, **charging a credit again for a dock already paid for**. The new
script backfills both fields additively and leaves `user` in place, so `chem_beo` can still read
the documents after a rollback.

**The four parity differences, all benign:**

1. A garbage token gets **403 from `chem_beo`, 401 from this server**. 401 is the correct one —
   the client treats a same-origin 401 as a dead session and logs out, which is what a malformed
   token should cause.
2. `/api/activity` omits `createdAt` on users. Nothing in this repo's client reads it.
3. `/api/tanimoto/v1/*` (legacy) vs `/tanimoto/v1/*` (this repo). Each frontend calls its own
   server's path, and the halves ship together, so they cannot disagree.
4. `/api/asinex/exact/CCO` returns **500 on both** — `"Unexpected end of JSON input"`, Asinex
   answering with an empty body. Pre-existing, identical before and after, not a cutover risk.

The `/api/simulation` cache hit returned the **stored** `simulationKey` on both servers: no dock
ran and no credit was spent.

⚠ **The rollback command in the runbook is wrong.** `npm run dev` in
`/root/material-tailwind-dashboard-react` runs `concurrently "node stripe-server.cjs" "vite"` —
and `stripe-server.cjs` is *already running* on `:3001` from a different shell, so that half dies
on `EADDRINUSE`. There are two half-dead `concurrently` stacks on the box right now for exactly
this reason. **The rollback is `npm run dev-vite-only`.** Never delete that directory — it is a
different codebase from this repo's `client/`, not an older version.

Cutover is which process owns **port 5173**. nginx already proxies there; nothing in nginx,
TLS, DNS, or Stripe is touched. Check what holds it first: `ss -ltnp | grep 5173`.

### 2. Apply the `chem_beo` patch

`deploy/chem_beo/01-fixes-and-config.patch`. Written, applies cleanly, and verified by
running it against real Atlas on an isolated port. Not yet applied.

It lifts the five Asinex URLs and eight Tanimoto call sites into env vars **defaulting to
today's values**, makes the credit charge atomic and refundable, and closes five money/data
routes — including the open `/api/generate-molecules` that is causing the NVIDIA rate limit,
and the credit-minting hole at `chem_beo:3343`.

It is also what makes arrival day possible if Release A has not shipped: those env vars are
the only way to repoint docking on the legacy server. See `deploy/chem_beo/README.md` for the
~60 routes it deliberately leaves open.

### 3. Capture from Asinex while Moscow still answers

- [x] ~~**A DiffDock response.**~~ ✅ **Done 2026-07-29, and no call to Moscow was needed.**
      This item said the schema was "completely uncaptured". It was wrong: `chem_beo` has been
      logging every request and response to `/root/chem_beo/diffdock_api.log` since February —
      7.9 MB, 24 pairs, 8 successful. `deploy/box/diffdock/reference/` is the extracted contract,
      with a README covering the three things a reimplementation must get right: failure arrives
      as **HTTP 200** with `status: "failed"`, arrays are **padded to `num_poses`** with empty
      strings so length is not a pose count, and `position_confidence` is **ranked best-first and
      index-aligned** with `ligand_positions`.
- [x] ~~**A failed dock.**~~ ✅ **Done** — both distinct failure strings are in the same
      directory, along with the HTML error page DiffDock sometimes returns instead of JSON.
      Also `/root/chem_beo/output.json`, `output4.json` and `/root/output2.json` are three
      stored failed responses.
- [ ] **An apo-structure dock.** Still open. Every stored dock has a co-crystal ligand, which is
      where the search box centre comes from. A receptor without one has no centre by that rule,
      and nobody knows what Asinex does.
- [ ] **A failed `/api/simulation` dock** (AutoDock, not DiffDock). Still open — the platform
      only writes `simulation_logs` on success, so that engine's error shape is still unknown.

The same log settled `/convertSTR` too: `{"smiles": "..."}` → `{"sdf": "..."}`, and its last
line is a request at **2026-06-04T12:15:34Z with no response** — the exact moment `:8001` died,
carrying a leading space in the SMILES. `deploy/box/convertstr/` now trims and has a test for it.

### 4. `pg_dump` Oracle's Tanimoto Postgres — ✅ done 2026-07-29

2,951,975 molecules (and 2,951,975 fingerprints), confirmed by count. 14 GB on disk,
**1.21 GB** as `pg_dump -Fc -Z6`, with a `sha256` beside it.

| Copy | Where |
|---|---|
| on Oracle | `~ubuntu/tanimoto-backup/tonomitosql-20260729.dump` |
| off Oracle | `~/backups/tanimoto/` on the dev Mac |

Postgres 17 with the **`rdkit` 4.6.1** cartridge — the restore target needs that extension or
the schema will not load. This is a backup, not a migration: Tanimoto compute still moves to the
box (B3). The point is that until now the data existed in exactly one place, with an
unauthenticated `DELETE` route pointing at it, so there was nothing to migrate *from* if it went.

### 5. Rotate the glioblastoma key

`services/glioblastoma-predictor/chemtest_tech_private.key` is committed and `COPY`'d into the
image. It is in git history — treat as compromised. Blocks B6.

---

## In flight

Codex is building two things, in parallel, in disjoint directories:

| Brief | Building into | State on 2026-07-29 (re-checked 21:45 UTC) |
|---|---|---|
| `deploy/box/docking/BRIEF.md` | `deploy/box/docking/service/` | **41 files, tracked and committed** — no longer untracked or mid-build |
| `deploy/box/BRIEF-SERVICES.md` | `deploy/box/convertstr/`, `deploy/box/diffdock/`, `services/admet/` | `convertstr/` 7 files, `diffdock/` 7 files, both **tracked** |

Its docking plan was reviewed. Two corrections were pushed in `f426de2`, and **both are
honoured in the committed implementation** — verified, not assumed:

1. **SCORE sorts ascending** (`-4.547 → -4.345`, most negative first). ✅
   `serializer.py:22` sorts on `pose.score` ascending, and `:127` re-asserts it, raising
   `"docking serializer did not sort scores ascending"` if it ever drifts.
2. **Do not hard-fail on a pose count other than 5.** ✅ `service.py:94` compares against
   `EXPECTED_POSE_COUNT` (default 5, `settings.py:60`) and only `logger.warning`s plus a
   `pose_count_<n>` metric. The one hard failure is `serializer.py:20`,
   `"docking produced zero poses"` — exactly the intended policy.

Also from that review:

- **Apo receptors are handled now** — `receptor.py:316` logs `APO_RECEPTOR_FALLBACK` with a
  reason, so a receptor with no co-crystal ligand has a defined path. What is *still* open is
  the separate §3 item: nobody has captured what **Asinex** does with one, so there is no 1:1
  to compare the fallback against.
- **mmCIF is still unhandled.** `grep -i cif receptor.py` is empty, so an entry too large for
  PDB format still fetches `files.rcsb.org/download/{ID}.pdb`, gets a **404**, and reports it
  generically. Needs a message that names the cause. Not blocking.
- The plan rejects `;` in SMILES with 422. Defensible, but the frontend does
  `replace(',', ';')` with **no `/g` flag**, so it only rewrites the first comma — multi-SMILES
  input arrives as `A;B,C`. Whatever it does, log and count it.

**Scope note.** The docking service's `fcntl.flock` cross-process locking, multiprocess
cold-cache race tests, and versioned cache invalidation are sized for concurrency that does
not exist — production has done **four docks in three months**. Correct, ~120 LOC, harmless;
just past the load. The **cache itself is worth every line** — a warm receptor skips the RCSB
fetch and the OpenMM prep, and that is the one latency change a user will actually feel.

---

## Do not

- Do not deploy Release A and the docking repoint on the same day. See above.
- Do not touch **nginx, TLS, DNS, the firewall, or Stripe** on arrival day. Stripe works; the
  runbook needs no Stripe access.
- Do not move the **database**. Production Mongo is **Atlas** and stays. Runbook 4.1 and 4.2
  are dead permanently.
- Do not restore **Oracle's Mongo**. Discarded, never restored from. This is *Mongo only* —
  Oracle's **Postgres is production Tanimoto data and IS copied** (4.3).
- Do not put an API server or Mongo on the box. It runs **compute only**. The box has pick-up
  warranty and no on-site service in the Netherlands, so a fault costs 1–3 weeks: box dies,
  docking stops, product survives.
- Do not add tenant-facing or billing features. See `PYXIS-ONLY.md`.
- Do not edit `scripts/verify-docking-response.mjs`. It encodes the platform's real parsers
  verbatim, brittleness included. Loosening it to make a candidate pass defeats its purpose.

---

## Prompt for a fresh session

> Read `docs/NEXT-SESSION.md` and `CLAUDE.md`, then `docs/ARRIVAL-RUNBOOK.md` Phase 5.
> The box has not arrived. I want to ship Release A — the server swap — before it does.
> Start with the gates in NEXT-SESSION.md §1 and tell me which are done and which are not.
> SSH to production is `root@83.229.87.94`; I will give you the password.
