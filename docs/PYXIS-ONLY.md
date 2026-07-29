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

**Resolved 2026-07-28:** Stripe stays exactly as is, **and** manual admin top-up is wanted
alongside it. Both are already in the code — see §5. Nothing to build.

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

### Branding — full Pyxis, and it is smaller than it looks

**Most of it is already correct.** Both `server/config/branding.js` and
`client/src/config/branding.js` resolve the brand as *company name first, platform name only as
fallback*. The one company record is named Pyxis Discovery, so **everything shown to a
logged-in user, and every email, already says Pyxis.** No code change needed there.

What is wrong is the **logged-out surface and two hardcoded fallbacks** — places that bypass
the branding config entirely:

| File | Current | Action |
|---|---|---|
| `client/index.html:7` | `<title>ChemBench</title>` | → `Pyxis Discovery` |
| `client/src/pages/auth/sign-in.jsx:298` | `<span className="cb-auth-logo">ChemBench</span>` | → drive from `getPlatformName()` |
| `client/src/widgets/layout/navbar.jsx:86` | `brandName: "MedSaaS"` (defaultProps) | → `Pyxis Discovery` |
| `client/src/widgets/layout/sidenav.jsx:132` | `brandName: "MedSaaS"` (defaultProps) | → `Pyxis Discovery` |
| `PLATFORM_NAME` / `VITE_PLATFORM_NAME` | `MedSaaS` | → `Pyxis Discovery` (env, both) |
| `client/src/pages/auth/sign-up.jsx:74`, `widgets/layout/main-navbar.jsx:57` | `ChemBench` | nothing — both files go with the signup/marketing removal |

Leave the `chembench-mcp` MCP server name alone. Renaming an MCP server is a client-visible
contract change for no benefit.

**Note the ordering trap:** setting `VITE_PLATFORM_NAME` fixes the client only at **build**
time, not runtime. It has to be set in the environment that builds the bundle destined for 83.

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
  Asinex and DiffDock URLs get repointed without a redeploy. The trap this used to warn about
  — `assertConfiguredUrlsArePublic` rejecting private and CGNAT addresses — **no longer
  applies**: the box is addressed by a public hostname (ARRIVAL-RUNBOOK Phase 3.1), and the
  guard has one call site on this path only, so the env-var route was never subject to it.
- **`consumeSimulationToken`, `simulationTokens`, `billing_events`, the Stripe webhook.**
  Unchanged, per the decision.
- **Audit logging.** More valuable single-tenant, not less.

---

## 3b. Who is admin, and how credits get topped up

Both already exist. Nothing to design and nothing to build.

### The role model, as it already works

- **`owner`** — assigned automatically to the *first* user in a company
  (`server/index.js:1790`: `existingCompanyUsers === 0 ? 'owner' : 'member'`). For Pyxis that
  is whoever signed up first. There is exactly one, and they cannot be demoted, deactivated or
  deleted (`:3652`, `:3662`, `:3717` all refuse).
- **`member`** — what every invited user gets by default.
- **`admin`** — granted by an existing admin/owner editing that member. Not automatic.
- **`requireCompanyAdmin`** (`:1221`) admits `owner` **or** `admin`, and gates **19 routes**:
  member management, invites, audit logs, branding, usage policy, the ligand-service URLs,
  RabbitMQ health, and token issuance.
- Separately, `adminOnly: true` on a route in `client/src/routes.jsx` hides the page from
  members — that is menu visibility, the server check is what actually enforces.

So "who will be admin" is an **operational choice, not a code change**, and it does not block
anything: the owner already exists, and can promote anyone at any time from the Company Admin
page. Worth deciding before inviting people, not before writing code.

### Admin top-up — three existing paths

| Route | Behaviour | Use for |
|---|---|---|
| `PATCH /api/company/members/:username` (`:3630`) | accepts `simulationTokens` in the body (`:3671`), sets that member's balance | **the normal top-up.** Already in the Company Admin UI |
| `PATCH /api/company/usage-policy` (`:3362`) | resets **every** member to `defaultSimulationTokensPerUser` (`:3408`) | bulk reset |
| `POST /api/issueSimulationTokens` (`:5307`) | see the warning below | — |

> **Footgun worth fixing.** `/api/issueSimulationTokens` is named like a grant but its
> implementation is `$set`, not `$inc` (`:5317`), and it **defaults to 50**. An admin calling
> it on a user who has 200 credits silently drops them to 50. The audit event is honestly
> named `company.tokens.user_reset`, so the *behaviour* is intentional — the **name is the
> lie**. Options: rename it to `resetSimulationTokens`, change it to `$inc` so it matches its
> name, or drop it since `PATCH /api/company/members/:username` already covers the case.
> Recommend renaming; it is the only one of the three that does not change existing behaviour.

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
3. Rebrand ChemBench → Pyxis Discovery: two env vars plus four hardcoded strings (§2).
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
- **`/api/issueSimulationTokens`** — rename, change to `$inc`, or drop? See §3b. Recommend
  rename. Not blocking; it is a small, isolated route.
- **Who gets `admin`** — operational, decide before inviting people. Not a code change.
- **What is answering the production API on 83 today?** Still unknown, still an inventory task
  on that box, and now more pressing: step 7 replaces the frontend that talks to it, so we need
  to know what we are cutting over *from*. See COMPUTE-BOX-MIGRATION.md §3.
- **Will there be a public marketing site at all** (`pyxis-discovery.com` as opposed to
  `app.`)? If yes, the deleted pages are the starting point and should be moved to their own
  repo rather than deleted.
