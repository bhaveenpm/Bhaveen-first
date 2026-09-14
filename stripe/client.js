import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { resolveStripeConfig } from "./config.js";

/**
 * One configured Stripe client, with the settings that are easy to omit and
 * expensive to omit:
 *
 *   apiVersion    pinned in config.js, not inherited from the account
 *   maxNetworkRetries  the SDK retries with the *same* idempotency key, which
 *                      is the only safe way to retry a write
 *   telemetry     off; it's harmless but this repo sends nothing it didn't mean to
 */
export function createStripe(overrides = {}) {
  const config = resolveStripeConfig(overrides);

  const stripe = new Stripe(config.secretKey, {
    apiVersion: config.apiVersion,
    maxNetworkRetries: overrides.maxNetworkRetries ?? 2,
    timeout: overrides.timeoutMs ?? 20_000,
    telemetry: false,
    appInfo: { name: "gp-api-lab/stripe", version: "0.1.0" },
    // Tests inject a stub transport here. Production leaves it undefined and
    // gets the SDK's own Node client.
    ...(overrides.httpClient ? { httpClient: overrides.httpClient } : {}),
  });

  return { stripe, config };
}

/**
 * An idempotency key must be stable for "the same logical attempt" and
 * different for "a genuinely new attempt". Deriving it from your own domain id
 * -- an order id, an invoice number -- is what makes a retry after a timeout
 * safe: Stripe returns the original result instead of charging twice.
 *
 * `randomUUID()` is the fallback, and it is a real fallback, not a default:
 * a random key makes the *SDK's* internal retries safe but does nothing for a
 * retry your own code initiates. Pass a scope you control wherever you can.
 */
export function idempotencyKey(scope) {
  return scope ? `gp-lab:${scope}` : `gp-lab:${randomUUID()}`;
}

/**
 * Basis points against a minor-unit amount, rounded once and explicitly.
 *
 * 2.5% of 1999 minor units is 49.975. Which way that rounds is a decision, so
 * make it visibly: we floor, so the platform never takes more than its stated
 * percentage. Letting a float reach the API instead produces fees like 49.975
 * and a 400.
 *
 * Also enforced: the fee can never exceed the charge, which Stripe rejects.
 */
export function applicationFeeAmount(amountMinor, bps) {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError(`amountMinor must be a non-negative integer, got ${amountMinor}`);
  }
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new TypeError(`bps must be an integer in 0..10000, got ${bps}`);
  }
  const fee = Math.floor((amountMinor * bps) / 10_000);
  return Math.min(fee, amountMinor);
}
