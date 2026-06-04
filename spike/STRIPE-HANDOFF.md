# Stripe Webhook Bun Handoff

Phase 4 does not edit production Stripe code. It records the Phase 5 migration required before the server runs under Bun.

## Required Phase 5 Change

- `server/index.js:99` currently verifies webhooks with the synchronous `stripe.webhooks.constructEvent(...)` call inside an already-async Express handler.
- Under Bun, that call throws: `SubtleCryptoProvider cannot be used in a synchronous context`.
- Phase 5 must change the handler to await the async variant:

```js
event = await stripe.webhooks.constructEventAsync(
  req.body,
  req.headers['stripe-signature'],
  STRIPE_WEBHOOK_SECRET
);
```

## Test Update

`server/test/stripe-webhook.test.mjs` also exercises the sync webhook verification path through the live route. After the production handler changes, the test should continue to prove valid signatures, rejected forged signatures, and idempotent credit grants under the async path.

## Non-Solution

`createNodeCryptoProvider()` is not an escape hatch for Bun. Research found it is unavailable in Bun's non-Node runtime branch, so the supported migration path is `constructEventAsync`.

## Spike Evidence

`spike/04-stripe.ts` verifies a valid signed event with `constructEventAsync` and rejects a tampered signature under Bun. That proves the verification stays real; signature checking is not disabled or replaced with custom HMAC logic in production.
