import { createStripe } from "./client.js";
import { connect } from "./connect.js";
import { payments } from "./payments.js";
import { tax } from "./tax.js";
import { billing } from "./billing.js";
import { invoicing } from "./invoicing.js";

/**
 * One entry point wiring the five products together.
 *
 * The split mirrors the two money flows rather than the five product names,
 * because that is the distinction that actually governs the code:
 *
 *   Flow A  buyer -> seller, you take a cut   connect + payments + tax
 *   Flow B  seller -> you                     billing + invoicing (+ tax)
 */
export function createStripeIntegration(overrides = {}) {
  const { stripe, config } = createStripe(overrides);
  return {
    stripe,
    config,
    connect: connect({ stripe, config }),
    payments: payments({ stripe, config }),
    tax: tax({ stripe, config }),
    billing: billing({ stripe, config }),
    invoicing: invoicing({ stripe, config }),
  };
}

export { createStripe, applicationFeeAmount, idempotencyKey } from "./client.js";
export { resolveStripeConfig, describeKey, STRIPE_API_VERSION } from "./config.js";
export { classifyStripeError, customerMessageFor } from "./errors.js";
export {
  verifyEvent,
  createWebhookRouter,
  InMemoryEventLog,
  RECOMMENDED_EVENTS,
} from "./webhooks.js";
export { EXPRESS_CONTROLLER, EXPRESS_SELLER_BEARS_LOSSES } from "./connect.js";
