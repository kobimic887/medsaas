# Pyxis only — retiring the SaaS surface

**Status:** plan. Nothing applied.

**The decision (owner, 2026-07-28):** for now and for a long time, this is **not a SaaS**. It
is one product for one company — Pyxis Discovery. `app.pyxis-discovery.com` must work very
well, and it should carry nothing that exists to serve other tenants.

**Depth chosen:** remove the marketing site and the billing/self-signup surface. **Keep the
multi-tenancy plumbing underneath** (users, roles, the single company record, audit logging,
per-company branding) because auth and audit already key on it and ripping it out touches
~260 call sites for no user-visible gain. **Credits stay exactly as they are** — no change to
`consumeSimulationToken` or the Stripe grant path.

That last point is deliberate and worth stating plainly: the Stripe *webhook and credit-grant
logic stays wired* even though public signup and checkout pages go away. It is the admin
top-up path, and leaving it alone is one less thing to break.

> **Unresolved — do not treat the credits line as final.** The owner explicitly selected
> "leave credits exactly as is", and then said *"we can lose all the non pyxis all the saas
> part."* Credits-as-payment **are** SaaS surface, so those two may not agree. This document
> follows the explicit selection. If the broader statement wins, the change is: drop the
> Stripe grant path and keep `consumeSimulationToken` as a GPU quota with manual admin top-up
> — which matters more, not less, once folding runs on our own two cards. Confirm before
> touching anything in this area.

---

## 1. Which frontend — the comparison that was asked for

The owner's answer was *"look at both first, then decide"*, so this is the looking. **The
decision is still theirs.** Recommendation and evidence below.

| | `app.pyxis-discovery.com` (83) | `client/` (this repo, on Oracle) |
|---|---|---|
| `<title>` | `Pyxis-Discovery \| Macrocycles` | `ChemBench` |
| Lineage | `eitangenis/material-tailwind-dashboard-react` — the title is **byte-identical** to that repo's `index.html` | current, maintained, CI-built |
| Dashboard pages | 12 | **15** |
| Has that the other lacks | *nothing* | `glioblastoma-predict`, `gromacs-md`, `company-admin` |
| Recent work | none | dark mode, per-company brand colour, chart hardening |

**On the source, the new frontend is a strict superset of the old one** — switching loses no
page. The old bundle is the legacy lineage the owner described as buggy, and it is a dead end
that nobody maintains.

**Recommendation: `client/` from this repo becomes `app.pyxis-discovery.com`.**

**What this evidence does and does not prove.** The `<title>` match establishes *lineage*
beyond doubt. It does not prove the deployed 83 bundle matches that repo — a deployed build can
drift from its source, and the page fetch returned only the title, no navigation and no
feature list. So "loses no feature" is inferred from the source trees, not observed on the
running site. Before deleting anything on 83, open it and click through it. Cheap, and it is
the only step that can surface a feature nobody remembers shipping.

### The catch, and it is the interesting one

The two frontends are branded for **different products**:

- 83 is branded **Pyxis-Discovery** — the single company.
- `client/` is branded **ChemBench** — the multi-tenant platform. Same reason the MCP server
  is `chembench-mcp` and the `PLATFORM_NAME` fallback is `MedSaaS`.

So the deployed frontend is Pyxis-branded but obsolete, and the good frontend is
platform-branded. **Rebranding ChemBench → Pyxis Discovery is not cosmetic housekeeping — it
is the same job as retiring the SaaS.** Do them in one pass, not two.

---

## 2. What goes

### Marketing site — `client/src/pages/main/`

Delete the routes and the pages: `mainhome`, `services`, `about-us`, `contact-us`, `insights`,
`blog`, `paidplansdescription`. All are `hideFromMenu: true` in `client/src/routes.jsx`, so
they are reachable by URL only — public brochure pages for a product that no longer sells
itself.

Two things to check before deleting rather than after:

- **These pages contain the real Pyxis macrocycle copy.** `mainhome.jsx`, `about-us.jsx`,
  `insights.jsx` and `services.jsx` all mention macrocycles, carried over from the old
  frontend. If any of that text is wanted for a future public site, lift it out first — it is
  not reproducible from memory.
- `/api/send-email` (the contact form, rate-limited to 5/15 min) becomes unreachable from the
  UI. Leave the endpoint; it is also the fixed-recipient path and removing it is not free.

### Billing and self-signup

| Item | Where | Action |
|---|---|---|
| `paidplans` page | `client/src/pages/dashboard/paidplans.jsx` | remove route + page |
| Checkout endpoints | `POST /create-checkout-session`, `/create-checkout-session-onetime` (`server/index.js:1473`, `:1603`) | remove, or gate to admin only |
| `PLAN_CATALOG` | `server/index.js:91` | keep — `PLAN_CATALOG.Trial` seeds new accounts at `:5274`, and `:1345` resolves plans. Removing it breaks account creation |
| Public signup | `POST /api/signup` (`server/index.js:1715`) | **close it.** Accounts become invite-only |
| `/stripe/webhook` | `server/index.js:110` | **keep, untouched** — per the credits decision |
| `sign-up` route | `client/src/routes.jsx` | remove from the router; keep `sign-in` |

**Closing public signup is the single highest-value change here.** Right now anyone can create
an account, which creates a *company*, which makes them its `owner`. On a single-tenant
install that is not a feature — it is an open door onto a machine with two GPUs behind it.
Invite-only via the existing invite flow.

### Branding

| From | To |
|---|---|
| `<title>ChemBench</title>` (`client/index.html`) | `Pyxis Discovery` |
| `PLATFORM_NAME=MedSaaS` | `Pyxis Discovery` |
| `getBrandName(companyName)` (`server/config/branding.js`) | keeps working — the one company record is named Pyxis Discovery, so emails brand correctly with no code change |
| `chembench-mcp` server name | leave it. Renaming an MCP server name is a client-visible contract change for no benefit |

---

## 3. What stays, and why

- **`users`, roles (`owner`/`admin`/`member`), `requireCompanyAdmin`, `adminOnly` routes.**
  Still needed — Pyxis has more than one person, and they do not all get admin.
- **The `companies` collection and `companyId`.** One row. Auth, audit logging, branding and
  the ligand-service config all read it; collapsing it is a rewrite of the auth path for no
  visible gain. Leave it as an implementation detail.
- **`company-admin.jsx`.** Becomes the *Pyxis* admin page. It is where invites, member
  management and the ligand-service URLs live — all of which get *more* useful when the
  backend moves, because those URLs have to be repointed at the box.
- **`ligandServiceConfig`.** Now effectively global config with one row. Keep it; it is how the
  Asinex and DiffDock URLs get repointed without a redeploy. Note the trap:
  `assertConfiguredUrlsArePublic` rejects private and Tailscale addresses (see
  [COMPUTE-BOX-MIGRATION.md §8](./COMPUTE-BOX-MIGRATION.md#8-gotchas-found-in-the-trace)).
- **`consumeSimulationToken`, `simulationTokens`, `billing_events`, the Stripe webhook.**
  Unchanged, per the decision.
- **Audit logging.** More valuable single-tenant, not less.

---

## 4. Archive, do not delete

The owner's framing was *"as of right now and the next fairly long amount of time"* — which is
not "never". So this is a **retirement, not a demolition**:

1. **Tag before touching anything:** `git tag saas-surface-v1` on `main`, pushed. That is the
   recoverable snapshot, and it costs nothing.
2. **Remove routes first, code second.** Pulling entries out of `client/src/routes.jsx` makes
   the surface disappear from the product in one small, obviously-reversible diff. Deleting the
   page files is a separate commit that can be reverted independently.
3. **Never silently orphan an endpoint.** If a page goes but its endpoint stays, say so in the
   commit message — otherwise the next person reads a live route as a live feature.
4. **One commit per concern:** marketing pages · billing UI · signup closure · rebrand. A
   single "de-SaaS" mega-commit is unrevertable in practice.

---

## 5. Sequence, and how it meshes with the move

This work and the box migration touch the same files, so ordering matters.

**Do first, before the box arrives — it needs no new hardware:**

1. Tag `saas-surface-v1`.
2. Close public signup. Security win, one route, immediate.
3. Rebrand ChemBench → Pyxis Discovery.
4. Remove the marketing routes, then the pages (lifting the macrocycle copy out first).
5. Remove the paid-plans page and gate the checkout endpoints.
6. Verify the remaining product end to end on Oracle: sign in → every science page loads.

**Then, as part of the migration** ([COMPUTE-BOX-MIGRATION.md §7](./COMPUTE-BOX-MIGRATION.md#7-migration-sequence)):

7. Build `client/` with `VITE_API_BASE_URL` pointing at the box's API and deploy it to 83,
   replacing the legacy bundle at `app.pyxis-discovery.com`. **Keep the old bundle on disk**
   until the new one is confirmed working — that is the rollback.
8. Add CORS for the `app.pyxis-discovery.com` origin on the API.

Doing 1–6 first means the thing deployed to 83 in step 7 is already Pyxis-only, so users see
one change, not two.

---

## 6. Open

- **The macrocycle marketing copy** — keep it somewhere, or let it go? Blocks step 4.
- **What is answering the production API on 83 today?** Still unknown, still an inventory task
  on that box, and now more pressing: step 7 replaces the frontend that talks to it, so we need
  to know what we are cutting over *from*. See COMPUTE-BOX-MIGRATION.md §3.
- **Will there be a public marketing site at all** (`pyxis-discovery.com` as opposed to
  `app.`)? If yes, the deleted pages are the starting point and should be moved to their own
  repo rather than deleted.
