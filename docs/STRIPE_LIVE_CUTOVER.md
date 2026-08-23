# Stripe Live-Payments Cutover Runbook

**Goal:** make real customer payments actually grant `simulationTokens` (credits) in production.

**Audience:** an AI agent or engineer with repo access and the ability to run
commands on the production box. This document is self-contained — you do not
need prior conversation context.

> ## Status (2026-08-23) — webhook registered
>
> Soft flip was already live. Owner-approved Stripe cutover **executed** on `84`:
> - Endpoint **`we_1U7Z6vAlVdO1Ab8fuM6HWROx`** →
>   `POST https://app.pyxis-discovery.com/stripe/webhook`
>   (`checkout.session.completed` only; single endpoint, no duplicate).
> - `STRIPE_WEBHOOK_SECRET` set in `/root/pyxis-LIVE-5174/server/.env` only
>   (never in git). `pyxis-web` restarted in-place; `/health` OK.
> - Unsigned POST → HTTP 400 (`No stripe-signature…`) = route wired + secret loaded.
> - **Still open:** live paid checkout + refund smoke (Step 4) — needs owner card;
>   agents must not charge without a clear yes.
>
> ## ⚠ Timing and hosts (owner 2026-08-21) — historical gate notes
>
> - Soft flip **executed 2026-08-23**. Register webhook into maintained `:5174`
>   (grill Q14=A). Stripe not critical near-term (Q18=B). Required explicit owner yes.
> - Public site is this repo’s `pyxis-web` on **`84.13.81.51`** (`:443` → `:5174`). HTTPS
>   exists; Step 1 (public URL) is moot for DNS/TLS.
> - Webhook path is `POST https://app.pyxis-discovery.com/stripe/webhook` into the
>   **maintained** server env on `84` (`/root/pyxis-LIVE-5174/server/.env`) —
>   **not** `~/medsaas/.env` on `oracleOld`, and **not** an assumed `/root/pyxis/`.
> - Run `stripe webhook_endpoints list` first — do not create a duplicate.
> - Body text below still describes 2026-06 Oracle/Docker topology; treat §0 facts as
>   historical. Authority: [`NEXT-SESSION.md`](./NEXT-SESSION.md),
>   [`POST-PROMOTION-HANDOFF.md`](./POST-PROMOTION-HANDOFF.md).

> **TL;DR of the original problem:** Checkout *creation* already worked (live key
> valid, charges-enabled). Credits failed because no webhook was registered, the
> box lacked HTTPS, and `STRIPE_WEBHOOK_SECRET` was missing/placeholder. HTTPS +
> soft flip landed earlier; **webhook + secret on maintained are done 2026-08-23**.
> Remaining proof is Step 4 (real Standard checkout + refund).

---

## 0. System facts (verified 2026-06-04)

| Thing | Value |
|---|---|
| Stripe account | `acct_1S6EnFAlVdO1Ab8f` (live key valid, `charges_enabled: true`) |
| Webhook route (in code) | `POST /stripe/webhook` → handles `checkout.session.completed` |
| Fulfillment | `fulfillCheckoutSession()` in `server/index.js` increments `users.simulationTokens` by `metadata.credits`, idempotent via `billing_events` (unique `stripeSessionId`) |
| Checkout endpoint used by UI | `POST /create-checkout-session-onetime`, `mode: 'payment'` (one-time), metadata `{ purchaseType: 'plan_tokens', plan, credits, username, companyId }` |
| Prod box | Oracle VPS `151.145.91.17`, app on port `3000`, **plain HTTP, no domain/reverse proxy** |
| Prod deploy | GitHub Actions `deploy.yml` (`workflow_dispatch`), ssh/scp source to box, then `docker compose -f docker-compose.box.yml up -d --build` |
| Prod secrets | live `.env` at `~/medsaas/.env` **on the box** (never committed; `env_file:` in compose) |
| Required env that gates webhooks | `STRIPE_WEBHOOK_SECRET` — code treats `whsec_replace_me`-style placeholders as unset and warns at startup |

Plan catalog & prices live in `PLAN_CATALOG` near the top of `server/index.js`
(Trial 0¢ / Standard 2000¢ / Academic 4000¢ / Professional 8000¢).

---

## Step 1 — Give the box a public HTTPS URL

Stripe **rejects non-HTTPS URLs for live-mode webhook endpoints**, and the box
currently serves plain `http://151.145.91.17:3000`. Pick ONE option.

### Option A — Cloudflare Tunnel (fastest, free, no domain required)
Runs a `cloudflared` container that exposes the app over HTTPS at a
`*.trycloudflare.com` URL (or a named hostname if you own a Cloudflare domain).

On the box (`ssh <user>@151.145.91.17`):
```bash
# Quick ephemeral tunnel (URL changes on restart — fine for a first test):
docker run -d --name cf-tunnel --restart unless-stopped \
  --network host cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://localhost:3000
docker logs cf-tunnel 2>&1 | grep -i trycloudflare   # note the https URL
```
For production use a **named tunnel** bound to a stable hostname (requires a
Cloudflare account + a domain in Cloudflare): `cloudflared tunnel login`,
`cloudflared tunnel create medsaas`, route a DNS hostname to it, then run with
a credentials file. The ephemeral URL is acceptable only for the first
end-to-end test because it changes on restart.

### Option B — Domain + Caddy reverse proxy (the "real" setup)
1. Point a domain's DNS A record at `151.145.91.17`.
2. Add a Caddy service in front of the app (auto-HTTPS via Let's Encrypt). Add to
   `docker-compose.box.yml`:
   ```yaml
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports: ["80:80", "443:443"]
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile
         - caddy-data:/data
   # and add `caddy-data:` under top-level volumes:
   ```
   `Caddyfile`:
   ```
   your-domain.com {
       reverse_proxy app:3000
   }
   ```
   (Remove the app's `ports: ["3000:3000"]` exposure once Caddy fronts it, or keep
   it internal. Caddy and app must share the compose network.)

> **Whichever option:** also set `FRONTEND_URL=https://<your-public-host>` in the
> box `.env` (see Step 3). The server uses it to build Stripe `success_url` /
> `cancel_url` redirects and for CORS — otherwise the post-payment redirect can
> break.

Record the final public HTTPS base URL — call it `PUBLIC_URL` below.

---

## Step 2 — Register the webhook with Stripe (get the signing secret)

Do this from anywhere that has the **live secret key** (it's in the repo-root
`.env` as `STRIPE_SECRET_KEY=sk_live_...`, and on the box `.env`). This is a
free, reversible API call. Returns a `whsec_...` signing secret **shown only at
creation** — capture it.

```bash
SK="$(grep -E '^STRIPE_SECRET_KEY=' .env | cut -d= -f2- | tr -d '\"'\''')"
PUBLIC_URL="https://<your-public-host>"   # from Step 1

curl -s https://api.stripe.com/v1/webhook_endpoints \
  -u "$SK:" \
  -d "url=${PUBLIC_URL}/stripe/webhook" \
  -d "enabled_events[]=checkout.session.completed" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('SECRET:',d.get('secret') or d)"
```

The printed `SECRET:` value is the `whsec_...` you need in Step 3.
(Equivalent via dashboard: **Developers → Webhooks → Add endpoint**, URL
`${PUBLIC_URL}/stripe/webhook`, event `checkout.session.completed`, then reveal
the **Signing secret**.)

To verify/list later:
```bash
curl -s https://api.stripe.com/v1/webhook_endpoints -u "$SK:" \
  | python3 -c "import sys,json;[print(w['url'],w['status']) for w in json.load(sys.stdin)['data']]"
```

---

## Step 3 — Put the secret on the box and restart

The webhook secret must live in the box `.env`, **not** in git.

```bash
ssh <user>@151.145.91.17
cd ~/medsaas
# Edit ~/medsaas/.env — set these (replace placeholders):
#   STRIPE_WEBHOOK_SECRET=whsec_...        # from Step 2
#   FRONTEND_URL=https://<your-public-host>  # from Step 1
# Confirm STRIPE_SECRET_KEY / VITE_STRIPE_PUBLISHABLE_KEY are the LIVE keys.

# Restart so the app picks up the new env (no rebuild needed for env-only change):
docker compose -f docker-compose.box.yml up -d
docker compose -f docker-compose.box.yml logs app | grep -i stripe   # should NOT warn about missing secret
```

If you changed `docker-compose.box.yml` (Option B/Caddy), use
`up -d --build` instead, or run the GitHub deploy workflow:
`gh workflow run deploy.yml --ref main`.

---

## Step 4 — Verify end to end (with a REAL but refundable payment)

There is no fully-free way to verify *live* mode — a real charge is required.
Use the cheapest plan (Standard = $20) and refund it after.

1. Log into the live app as a test user; note their current credits.
2. Buy the **Standard** plan → complete payment with a real card.
3. Within seconds, credits should jump by 50. Confirm:
   ```bash
   # On the box:
   docker compose -f docker-compose.box.yml exec -T mongo \
     mongosh -u "$MONGO_USER" -p "$MONGO_PASSWORD" --quiet medsaas \
     --eval 'db.users.findOne({username:"<that-user>"},{simulationTokens:1}); db.billing_events.findOne({},{},{sort:{createdAt:-1}})'
   ```
   The newest `billing_events` row should be `status: 'fulfilled'`.
4. In Stripe **Dashboard → Webhooks → your endpoint**, the delivery should show
   `200`. If it shows `400`, the signing secret is wrong (re-do Step 3 with the
   exact `whsec_` from Step 2's endpoint).
5. **Refund** the test charge in the Stripe dashboard (Payments → the charge →
   Refund). Refunds do not claw back credits — that's fine for a test user.

### Free pre-check (optional, no charge)
The credit-granting logic itself is already covered by an automated test that
needs no Stripe account and no money:
```bash
npm --prefix server run test:stripe   # boots real server + ephemeral Mongo, delivers a signed event
```
This proves grant + idempotency + signature rejection, but NOT Stripe's live
delivery — Step 4 is what proves the real round-trip.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Webhook delivery `400` in Stripe dashboard | `STRIPE_WEBHOOK_SECRET` on the box ≠ the endpoint's signing secret. Re-copy from Step 2, redo Step 3. |
| Webhook delivery `500` "not configured" | Secret still placeholder/empty. Set it in box `.env`, restart. |
| Delivery times out / connection refused | Public URL not reachable or not HTTPS. Re-check Step 1; `curl ${PUBLIC_URL}/health` should return `{"status":"OK"}`. |
| `200` but credits don't move | Metadata mismatch — the paying user's `username`/`companyId` must exist in `users`. Check `fulfillCheckoutSession` logs; `billing_events` may show `status: 'ignored_unpaid'` or an error. |
| Post-payment redirect lands on wrong host | `FRONTEND_URL` not set to `PUBLIC_URL` in box `.env`. |

## Rollback
- Delete the webhook endpoint: `curl -s -X DELETE https://api.stripe.com/v1/webhook_endpoints/<we_id> -u "$SK:"`.
- Revert env: blank `STRIPE_WEBHOOK_SECRET` in box `.env` and restart (webhooks return 500, no credits granted — back to current state).
- No data migration involved; `billing_events` rows are harmless to keep.

---

*Related: `memory/stripe-integration-status.md`, `memory/deploy-nonprod-setup.md`.
Code: `server/index.js` (`/stripe/webhook`, `fulfillCheckoutSession`,
`/create-checkout-session-onetime`, `PLAN_CATALOG`). Test:
`server/test/stripe-webhook.test.mjs`.*
