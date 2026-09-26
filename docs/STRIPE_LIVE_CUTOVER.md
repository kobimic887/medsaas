# Stripe integration

Pyxis creates checkout sessions on the server and processes signed Stripe webhook events.
This page describes the integration contract. Account identifiers, credentials, deployment
state and payment-verification records belong in [operations](OPERATIONS.md).

## Contract

- The app uses `/create-checkout-session-onetime` for credit packs and molecule carts.
  Credit packs are one-time payments. Both that plan branch and the admin-only
  `/create-checkout-session` route use `server/utils/planCheckout.js` for the catalog,
  prices, metadata, and `/dashboard/paid-plans` return URLs.
- Credit-pack quantities and prices are server-owned. Molecule checkout resolves catalog
  prices on the server; changed prices require explicit review before creating a session.
- `POST /stripe/webhook` receives signed events. Credit fulfillment is server-side and
  idempotent; a browser redirect or success query parameter does not grant credits.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the public application URL must match
  the intended Stripe mode and environment. Keep secret values out of client builds and logs.

See [the search and checkout contract](../.agents/skills/pyxis-feature-slice/references/search-and-checkout.md)
for catalog pricing and source restrictions.

## Verify a change

Run the focused checks from the repository root:

```bash
bun --cwd=server run test:stripe
bun --cwd=server run test:plans
bun run test:catalog-pricing
```

These tests use isolated fixtures to exercise signatures, duplicate delivery and checkout
rules. They do not prove live Stripe delivery or a completed payment.

A live verification requires an approved account, payment scope and recovery plan. Confirm
the deployed application and webhook configuration first. Record the initial balance,
complete the approved purchase, check the signed delivery and resulting entitlement,
and verify a repeated event cannot grant it again. Treat any refund and entitlement
adjustment as separate actions whose behavior must be checked.

## Configuration changes and rollback

Use the operator's secure process to configure signing secrets. Do not print returned
secrets into command output. Inspect existing endpoints before registering a new one,
and subscribe only to the events handled by the application.

Preserve the previous application artifact and endpoint configuration before a change.
Rolling back application code does not reverse a payment or database mutation. Do not
delete working webhook endpoints or restore billing records as an incidental code rollback.
