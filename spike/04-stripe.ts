import crypto from "node:crypto";
import { createRequire } from "node:module";

const requireFromServer = createRequire(new URL("../server/package.json", import.meta.url));
const Stripe = requireFromServer("stripe");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "local_secret_key_unused_by_webhook_verify";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "local_webhook_secret_for_hmac_only";
const stripe = new Stripe(stripeSecretKey);

const payload = JSON.stringify({
  id: "evt_bun_spike",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_bun_spike",
      object: "checkout.session",
      metadata: {
        purchaseType: "plan_tokens",
        credits: "1",
      },
    },
  },
});

function buildSignatureHeader(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${body}`;
  const signature = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function mutateHeader(header: string): string {
  return header.replace(/v1=([0-9a-f])/, (_match, char: string) => {
    const replacement = char === "a" ? "b" : "a";
    return `v1=${replacement}`;
  });
}

const validHeader = buildSignatureHeader(payload, webhookSecret);
const event = await stripe.webhooks.constructEventAsync(payload, validHeader, webhookSecret);

if (event.type !== "checkout.session.completed") {
  console.error(`Unexpected event type: ${event.type}`);
  process.exit(1);
}

console.log(`valid signature parsed event type: ${event.type}`);

const tamperedHeader = mutateHeader(validHeader);
let rejectedTamper = false;

try {
  await stripe.webhooks.constructEventAsync(payload, tamperedHeader, webhookSecret);
} catch (error) {
  rejectedTamper = true;
  const message = error instanceof Error ? error.message : String(error);
  console.log(`tampered payload correctly rejected: ${message}`);
}

if (!rejectedTamper) {
  console.error("Tampered signature was accepted");
  process.exit(1);
}
