# Staging

The `/staging/` app runs the normal application with a separate frontend build and
process. **It shares production accounts, database records, history, credits,
orders, checkout, and scientific providers. Actions can affect real data and
balances.** Browser storage separation does not provide data isolation.

## Modes

| Mode | Server flags | Behavior |
| --- | --- | --- |
| Normal application | Both flags unset or false | Standard Mongo-backed app |
| Full staging | `PYXIS_STAGING_MODE=true`, `PYXIS_DEMO_MODE=false` | Standard app with staging status/banner |
| Legacy demo | `PYXIS_DEMO_MODE=true`, `PYXIS_STAGING_MODE=false` | Separate fixture/demo router; not full staging |

The two flags cannot both be true. `GET /api/staging/status` is public and describes
the active mode. Full staging must report `demo:false` and
`sharedProductionData:true`.

## Frontend build

```bash
bun --cwd=client run build:staging
```

This writes `client/dist` with `/staging/` asset URLs, a matching router base, and
namespaced browser storage. Sign-in is separate in the browser even when the same
account is used. The consumer app does not redirect to staging.

A staging build and a normal build overwrite the same local output directory.
Before packaging a consumer release, restore the normal build:

```bash
bun --cwd=client run build
```

## Compound search

Staging offers Pyxis stock, combined real/virtual macrocycles, and open compounds.
Macrocycle filters can search both indexes or one source; matching structures keep
their source identity. Switching sources clears previous results.

Eligible stock and macrocycle packs use signed Pyxis offers and real Stripe
checkout; listed USD prices include shipping. Staging payments are not a sandbox.
See [compound shop](COMPOUND-SHOP.md) and the
[stock](DATA-STOCK-COMPOUNDS.md), [macrocycle](DATA-MACROCYCLES.md), and
[open-compound](DATA-OPEN-COMPOUNDS.md) contracts. Optional AI search requires
explicit provider configuration; a failed AI request must remain visible, with
unassisted search available as a separate choice.

## Verification and release

Use the focused checks for the change:

- `bun run test:staging-build` for asset URLs and build scoping.
- `bun run test:staging-demo` for the retained demo router contract.
- `bun run test:staging-simulation` for the demo Simulation provider contract.
- `bun run test:simulation-search` for source selection and result lifecycles.

These checks do not prove a live payment or scientific provider round trip.
Verify full staging status, sign-in, and the affected browser path separately,
using read-only actions unless mutations are authorized.

[Deployment notes](../deploy/staging/README.md) cover release boundaries and the
legacy scripts. Host details, observed release identities, and backup locations
belong in the [private operator record](OPERATIONS.md).
